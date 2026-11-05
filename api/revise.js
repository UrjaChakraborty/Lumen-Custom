// Vercel Serverless Function — POST /api/revise
//
// Takes the CURRENT resource plus a plain-language directive and asks Gemini to
// rewrite the ENTIRE document cohesively (not append to it). Returns the same
// { title, meta, sections } shape the Results screen renders, so the client can
// swap the whole canvas for the new version.
//
// Runs on the server only: the Gemini API key stays in process.env and is never
// shipped to the browser. Mirrors api/generate.js so both paths behave alike.

import { GoogleGenAI } from "@google/genai";
import { screenRequest, refusePII } from "./_pii.js";
import {
  runGuards,
  parseBody,
  sanitizeCurrent,
  cleanString,
  MAX_UPLOAD_BODY_BYTES,
} from "./_security.js";
import {
  PROSE_STYLE_RULES,
  GROUNDING_RULES,
  CONTRAST_CULTURAL,
  CONTRAST_NUMBERS,
  enforceProseStyle,
  SELF_CERT,
  stripSelfCertification,
} from "./_style.js";
import { stripCitations, deriveSources } from "./_sources.js";
import { scanFigures } from "./_figures.js";
import { reconcile, checkKeyAlignment } from "./_math.js";
import { PROMPT_VERSION, STAGES, TEMPERATURE, logGeneration,
  withTimeout,
  ModelTimeoutError,
} from "./_pipeline.js";
import { documentSchemaFor, blocksFor, normalizeSections, mergeBlocks } from "./_schema.js";
import { validateStandards } from "./_standards.js";
import { resolveSupportTags, formatCheckpointsForPrompt } from "./_udl.js";
import {
  verifyTiming,
  countPlaceholders,
  verifyCompleteness,
  checkReadability,
  verifyGrouping,
  verifyPrintCounts,
} from "./_verify.js";

const MODEL = "gemini-flash-lite-latest";

const SYSTEM_PROMPT = `You are an instructional co-designer for high school STEM teachers.
You revise materials grounded in Culturally Responsive Pedagogy (CRP), Culturally
Sustaining Pedagogy (CSP), and Universal Design for Learning (UDL).

Non-negotiable rules:
1. Treat students' cultures, languages, and communities as ASSETS to build on,
   never deficits to fix. Never use deficit language.
2. Anchor abstract STEM concepts in the SPECIFIC community context provided.
   Never rely on cultural stereotypes or generic "diverse" filler.
3. Apply UDL: offer multiple means of representation and multiple ways for
   students to demonstrate learning.
4. Honor accessibility constraints (reading level, language, low-tech/offline,
   neurodiverse supports) as stated.
5. Preserve rigor. Cultural relevance and accessibility never mean lowering
   expectations.

REVISION CONTRACT:
- You are given the current resource as JSON and a directive describing a change.
- REWRITE THE ENTIRE resource applying the directive. Do NOT simply append a new
  section. Adjust the title, timing, activities, supports, and assessments as
  needed so the whole document stays coherent.
- Keep the same overall kind of resource (a lesson stays a lesson, etc.).
- Return EVERY field, including the blocks you did not change. A block you omit
  is a block the teacher loses. If the directive does not touch materials,
  vocabulary, misconceptions, differentiation, safety, sources, the answer key,
  the exit ticket, homework, or grouping, return them exactly as given.
- If the directive DOES touch them, update them so they stay consistent. Changing
  a question means changing its answer key. Shortening the lesson means
  re-cutting the minutes. Adding a handout means adding what to print.
- "standards": return only codes that are already on the resource. Never add one
  from memory. Drop a code only if the rewrite genuinely removed that content.
- Keep discussionQuestions as 3-5 distinct, open-ended student questions at
  the end of the document. Update them when a revision changes the topic or
  selected activities, and do not repeat questions already in the resource.
- Respond with ONLY the JSON object described by the schema. No preamble, no
  markdown, no code fences.
- Each section has a "label" and EITHER a prose "body" OR an "items" array of
  bullet strings, never both. For list-style sections use "items" and set
  "body" to "". For prose sections use "body" and set "items" to [].

${PROSE_STYLE_RULES}

${GROUNDING_RULES}

${CONTRAST_CULTURAL}

${CONTRAST_NUMBERS}`;

function currentToPromptJson(current) {
  // Collapse the UI's body: string | string[] contract back into { body, items }
  // so the model sees the same structure it must emit. The structured blocks go
  // with it: a rewrite that cannot see the answer key cannot keep it consistent
  // with the questions it just changed.
  const sections = Array.isArray(current?.sections)
    ? current.sections.map((s) => ({
        label: s.label || "",
        body: Array.isArray(s.body) ? "" : s.body || "",
        items: Array.isArray(s.body) ? s.body : [],
        steps: s.steps || [],
        minutes: s.minutes ?? 0,
        // Fail closed, matching normalizeSections and sanitizeCurrent.
        // Unreachable today (sanitizeCurrent already coerced it), but "both"
        // here defaulted an unlabelled section ONTO the student handout — the
        // one direction that can hand a class the answers.
        audience: ["student", "teacher", "both"].includes(s.audience) ? s.audience : "teacher",
      }))
    : [];
  return JSON.stringify(
    {
      title: current?.title || "",
      meta: current?.meta || [],
      // It was always told "return only codes that are already on the resource"
      // and never shown them. sanitizeCurrent dropped the field, so this line had
      // nothing to send even before anyone noticed the instruction was empty.
      standards: current?.standards || [],
      discussionQuestions: current?.discussionQuestions || [],
      materials: current?.materials,
      vocabulary: current?.vocabulary,
      misconceptions: current?.misconceptions,
      differentiation: current?.differentiation,
      safety: current?.safety,
      familyBlurb: current?.familyBlurb,
      sources: current?.sources,
      answerKey: current?.answerKey,
      exitTicket: current?.exitTicket,
      homework: current?.homework,
      grouping: current?.grouping,
      sections,
    },
    null,
    2
  );
}

function buildRevisePrompt(current, directive) {
  return [
    `Here is the current resource as JSON:`,
    ``,
    currentToPromptJson(current),
    ``,
    ...(blocksFor(current?.kind).includes("accessibilitySupports")
      ? [
          `UDL CHECKPOINTS. Every accessibilitySupports entry must cite one of these`,
          `ids and nothing else. Leave checkpoint empty rather than inventing an id.`,
          formatCheckpointsForPrompt(),
          ``,
        ]
      : []),
    ...(current?.userUploaded
      ? [
          `UPLOADED PLAN PRESERVATION. This is the teacher's existing lesson plan, not a blank`,
          `template. Preserve its section headings, section order, sequence, and organization.`,
          `Make the requested change in the relevant existing section(s), and update only`,
          `other sections that must change to stay consistent. Keep all unaffected content`,
          `and useful details. Do not collapse separate sections into a single paragraph,`,
          `replace the plan with a generic template, or add a new section unless the request`,
          `requires one. Keep the uploaded plan's line breaks and list structure where practical.`,
          ``,
        ]
      : []),
    `DIRECTIVE. Apply this change by rewriting the WHOLE resource:`,
    directive,
    ``,
    `Return only the rewritten JSON object.`,
  ].join("\n");
}

// Keyed on the kind of document being revised. Without this a rewrite of a
// feedback note would be handed the lesson-shaped schema and would dutifully
// invent the grouping plan the draft was deliberately never asked for.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Security: same-origin check + per-IP rate limit + baseline headers.
  if (!runGuards(req, res, { limit: 15, windowMs: 60_000 })) return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is not configured for generation." });
  }

  const parsed = parseBody(req, {
    maxBytes: MAX_UPLOAD_BODY_BYTES,
    allowLarger: (body) => body?.current?.userUploaded === true,
  });
  if (parsed.error === "too_large") {
    return res.status(413).json({ error: "Request body too large." });
  }
  if (parsed.error === "invalid_json") {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  // Sanitize every attacker-controlled part before it reaches the model.
  const current = sanitizeCurrent(parsed.data.current);
  const directive = cleanString(parsed.data.directive, 1200);

  if (!current || current.sections.length === 0) {
    return res.status(400).json({ error: "Provide the current resource to revise." });
  }
  if (!directive) {
    return res.status(400).json({ error: "Provide a revision directive." });
  }

  // Last gate before the text reaches Google. See api/_pii.js — this route used
  // to accept a directive naming a student and their IEP status and return 200.
  const uploadedLesson = current.userUploaded
    ? [
        current.title,
        ...current.sections.flatMap((section) => [
          section.label,
          ...(Array.isArray(section.body) ? section.body : [section.body]),
        ]),
      ].join("\n")
    : "";
  const pii = screenRequest({ input: parsed.data.input, directive, uploadedLesson });
  if (pii.length) return refusePII(res, pii);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await withTimeout(ai.models.generateContent({
      model: MODEL,
      contents: buildRevisePrompt(current, directive),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: TEMPERATURE[STAGES.REVISE],
        responseMimeType: "application/json",
        responseSchema: documentSchemaFor(current.kind),
        maxOutputTokens: 4096,
      },
    }));

    let data;
    try {
      data = JSON.parse(response.text);
    } catch {
      return res.status(502).json({ error: "The model returned malformed output. Try again." });
    }

    data = enforceProseStyle(data);

    // A rewrite must not reintroduce a compliance claim the draft was stripped of.
    const revisedMeta = (Array.isArray(data.meta) ? data.meta : current.meta || []).filter(
      (m) => !SELF_CERT.test(m)
    );
    const selfCert = stripSelfCertification(data);
    const citations = stripCitations(data);

    const sections = normalizeSections(data.sections);
    const discussionQuestions =
      Array.isArray(data.discussionQuestions) && data.discussionQuestions.length >= 3
        ? data.discussionQuestions.slice(0, 5)
        : current.discussionQuestions || [];

    // Standards get a STRICTER gate here than on a draft. On a draft the model
    // picks from a retrieved candidate list; a rewrite was given no list at all,
    // so "valid" meant "exists somewhere in the dataset" — and a rewrite that
    // swapped in a different real code passed unchallenged. A rewrite may keep or
    // drop what the draft had. It may not add.
    const allowed = new Set(current.standards || []);
    const { valid: validAny, rejected } = validateStandards(data.standards);
    const standards = validAny.filter((c) => allowed.has(c));
    const addedCodes = validAny.filter((c) => !allowed.has(c));
    if (addedCodes.length) {
      console.warn("Revise tried to add standards not on the draft:", addedCodes.join(", "));
    }
    const { supports: accessibilitySupports } = resolveSupportTags(data.accessibilitySupports);

    // Anything the rewrite left out falls back to the draft, so a directive that
    // never mentions vocabulary cannot delete the vocabulary.
    const blocks = mergeBlocks(data, current, current.kind);

    // The checks a rewrite used to skip entirely. All of these are free except
    // readability, which is a measurement rather than a model call.
    //
    // Timing in particular was not merely missing here, it was DEAD: current
    // carried no periodLength, so verifyTiming got undefined, returned
    // "no timing data", and reported ok:true on a rewrite that overran the bell.
    const timing = verifyTiming(sections, current.periodLength, [
      { label: "Exit ticket", minutes: blocks.exitTicket?.minutes },
    ]);
    const completeness = verifyCompleteness({ ...data, ...blocks }, current.kind);
    const readability = checkReadability({ ...data, sections }, current.readingLevel);
    const groupingCheck = verifyGrouping(blocks.grouping, current.classSize);
    if (groupingCheck.state === "warn" && blocks.grouping) {
      blocks.grouping.disputed = true;
      blocks.grouping.disputeNote = groupingCheck.note;
    }
    const printCheck = verifyPrintCounts(blocks.materials, current.classSize, blocks.grouping);
    const keyAlignment = checkKeyAlignment(blocks.exitTicket);

    // Zero API calls: reconcile runs checkArithmetic on each `work` string before
    // it ever consults a solver, so a rewrite that broke its own worked solution
    // is caught here for free.
    const mathRec = reconcile(blocks.answerKey || [], []);
    if (blocks.answerKey) blocks.answerKey = mathRec.answerKey;

    const figures = scanFigures({ ...data, sections }, current);
    const sources = deriveSources({ ...data, sections }, current, figures);

    logGeneration({
      stage: STAGES.REVISE,
      input: current,
      result: {
        ...data,
        standardsRejected: rejected.length,
        placeholders: countPlaceholders(data),
        figuresAsserted: figures.asserted.length,
        figuresBare: figures.bare.length,
        citationsFound: citations.findings.length,
        citationsRemoved: citations.removed,
        selfCertRemoved: selfCert.removed,
        groupingState: groupingCheck.state,
        printCountProblems: printCheck.problems?.length || 0,
      },
      timing,
      completeness,
      ms: 0,
    });

    return res.status(200).json({
      promptVersion: PROMPT_VERSION,
      kind: current.kind || "lesson",
      userUploaded: current.userUploaded === true,
      title: data.title || current.title || "Draft",
      meta: revisedMeta,
      standards,
      discussionQuestions,
      standardsRejected: rejected.length,
      needsMoreInfo: Array.isArray(data.needs_more_info) ? data.needs_more_info : [],
      // Omitted entirely for types that never carry it, rather than returned as
      // an empty array that implies the document has UDL supports with none in.
      ...(blocksFor(current?.kind).includes("accessibilitySupports")
        ? { accessibilitySupports }
        : {}),
      ...blocks,
      sources: sources.rows,
      // A rewrite now reports the same shape a draft does. It used to return two
      // fields, which is why the client had to assume everything else was stale.
      verification: {
        timing,
        completeness,
        placeholders: countPlaceholders(data),
        readability,
        math: { checked: mathRec.confirmed + mathRec.disputed, disputed: mathRec.disputed,
          confirmed: mathRec.confirmed, arithmeticOnly: true },
        keyAlignment,
        grouping: groupingCheck,
        printCounts: printCheck,
        figures: { scanned: figures.scanned, asserted: figures.asserted, bare: figures.bare,
          traced: figures.traced.length },
        citations: { found: citations.findings.length, removed: citations.removed },
        selfCert: { flagged: selfCert.flagged.length, removed: selfCert.removed },
        stage: STAGES.REVISE,
        checkedAt: new Date().toISOString(),
      },
      sections,
    });
  } catch (err) {
    // A stalled upstream is a distinct failure from a rejected one, and the
    // teacher should be told to retry rather than left guessing.
    if (err instanceof ModelTimeoutError || err?.name === "ModelTimeoutError") {
      res.setHeader("Retry-After", "5");
      return res.status(504).json({
        error: "Revision took too long to respond. Please try again.",
      });
    }
    const status = err?.status;
    console.error("Gemini revise failed:", err?.message || err);
    if (status === 429) {
      res.setHeader("Retry-After", "20");
      return res
        .status(429)
        .json({ error: "Rate limit or quota exceeded. Check your Gemini plan and billing, then retry." });
    }
    if (status === 401 || status === 403) {
      return res.status(502).json({ error: "The generation service rejected the API key." });
    }
    return res.status(500).json({ error: "Revision failed. Please try again." });
  }
}
