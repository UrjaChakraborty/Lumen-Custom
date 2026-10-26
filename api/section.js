// Vercel Serverless Function — POST /api/section
//
// #81 Regenerate ONE section. "Redo just the warm-up" is the thing teachers
// actually want, and doing it through /api/revise costs a whole-document rewrite:
// it spends a rewrite from a budget of ten, and it changes sections the teacher
// had already read and accepted. This regenerates the named section against the
// same class context and leaves every other word alone.
//
// It returns only the section. The merge happens on the client, so there is no
// path here that can touch anything else in the document.

import { GoogleGenAI, Type } from "@google/genai";
import { screenRequest, refusePII } from "./_pii.js";
import { runGuards, parseBody, sanitizeInput, sanitizeCurrent, cleanString } from "./_security.js";
import {
  PROSE_STYLE_RULES,
  GROUNDING_RULES,
  CONTRAST_EXAMPLES,
  enforceProseStyle,
  stripSelfCertification,
} from "./_style.js";
import { stripCitations } from "./_sources.js";
import { scanFigures } from "./_figures.js";
import { verifyTiming } from "./_verify.js";
import { PROMPT_VERSION, STAGES, TEMPERATURE, logGeneration,
  withTimeout,
  ModelTimeoutError,
} from "./_pipeline.js";
import { normalizeSections } from "./_schema.js";

const MODEL = "gemini-flash-lite-latest";

const SYSTEM_PROMPT = `You are an instructional co-designer for high school STEM teachers.
You are rewriting ONE section of an existing lesson resource.

Non-negotiable rules:
1. Treat students' cultures, languages, and communities as ASSETS, never deficits.
   Never use deficit language.
2. Anchor the concept in the SPECIFIC community context given. Never rely on
   cultural stereotypes or generic "diverse" filler. If no cultural context was
   provided, do not invent any.
3. Apply UDL: multiple means of representation and multiple ways to show learning.
4. Honor the stated accessibility constraints.
5. Preserve rigor.

SECTION CONTRACT:
- You are given the whole resource for context and ONE section to rewrite.
- Rewrite ONLY that section. Do not return the others.
- Keep the same section label unless the directive explicitly asks to change it.
- Keep the same minutes unless the directive is about timing. The other sections
  are not being regenerated, so changing this one's minutes breaks the total.
- Use EITHER prose "body" OR an "items" array, never both, matching how the
  section is currently written.
- Fill steps[] with paired teacher and student moves if the section is a sequence
  of moves in the classroom. Otherwise leave it empty.

${PROSE_STYLE_RULES}

${GROUNDING_RULES}

${CONTRAST_EXAMPLES}`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING },
    body: { type: Type.STRING },
    items: { type: Type.ARRAY, items: { type: Type.STRING } },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { teacher: { type: Type.STRING }, students: { type: Type.STRING } },
        required: ["teacher", "students"],
        propertyOrdering: ["teacher", "students"],
      },
    },
    minutes: { type: Type.INTEGER },
    audience: { type: Type.STRING },
  },
  required: ["label", "body", "items", "steps", "minutes", "audience"],
  propertyOrdering: ["label", "body", "items", "steps", "minutes", "audience"],
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!runGuards(req, res, { limit: 20, windowMs: 60_000 })) return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is not configured for generation." });
  }

  const parsed = parseBody(req);
  if (parsed.error === "too_large") return res.status(413).json({ error: "Request body too large." });
  if (parsed.error === "invalid_json") return res.status(400).json({ error: "Invalid JSON body." });

  const current = sanitizeCurrent(parsed.data.current);
  const input = sanitizeInput(parsed.data.input || {});
  const label = cleanString(parsed.data.sectionLabel, 300);
  const directive = cleanString(parsed.data.directive, 1200);

  if (!current || !current.sections.length) {
    return res.status(400).json({ error: "Provide the current resource." });
  }
  if (!label) {
    return res.status(400).json({ error: "Name the section to regenerate." });
  }

  const pii = screenRequest({ input, directive });
  if (pii.length) return refusePII(res, pii);

  const target = current.sections.find((s) => s.label === label);
  if (!target) {
    return res.status(400).json({ error: "That section is not part of this resource." });
  }

  try {
    const startedAt = Date.now();
    const contents = [
      `CLASS CONTEXT`,
      `- Subject: ${input.subject || "STEM"}`,
      `- Course: ${input.course || "(unspecified)"}`,
      `- Grade / level: ${input.grade || "high school"}`,
      `- Class size: ${input.classSize || "(unspecified)"}`,
      `- Student interests: ${input.studentInterests || "(not given)"}`,
      `- Community context: ${input.communityContext || "(not given)"}`,
      ``,
      `THE WHOLE RESOURCE, for context only. Do not rewrite any of it except the`,
      `section named below. Do not repeat content that already appears elsewhere:`,
      JSON.stringify(
        {
          title: current.title,
          sections: current.sections.map((s) => ({ label: s.label, minutes: s.minutes })),
        },
        null,
        2
      ),
      ``,
      `THE SECTION TO REWRITE:`,
      JSON.stringify(target, null, 2),
      ``,
      directive
        ? `The teacher asked for this specifically: ${directive}`
        : `The teacher asked for a different version of this section. Produce a genuinely
different approach, not a reworded copy of what is there.`,
      ``,
      `Return only the JSON object for that one section.`,
    ].join("\n");

    const response = await withTimeout(ai(apiKey).models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        // A section redo is a redraft, so it gets the draft temperature rather
        // than the lower correction one.
        temperature: TEMPERATURE[STAGES.DRAFT],
        responseMimeType: "application/json",
        responseSchema,
        maxOutputTokens: 1600,
      },
    }));

    let data;
    try {
      data = JSON.parse(response.text);
    } catch {
      return res.status(502).json({ error: "The model returned malformed output. Try again." });
    }

    // Constructed per request rather than at module scope: a serverless instance can
    // outlive a key rotation, and this keeps the client from being captured once.
    function ai(apiKey) {
      return new GoogleGenAI({ apiKey });
    }

    data = enforceProseStyle(data);
    stripSelfCertification({ sections: [data] });
    const citations = stripCitations({ sections: [data] });
    const [section] = normalizeSections([data]);
    if (!section || (!section.body?.length && !section.steps.length)) {
      return res.status(502).json({ error: "The rewrite came back empty. Try again." });
    }

    // The minutes are a stated contract, not a suggestion. The prompt asks the
    // model to keep them unless the directive is about timing, and it does not
    // always comply — and because a section redo touches one section, nothing
    // else absorbs the difference, so the period total silently stops adding up.
    // Restoring the number enforces an arithmetic contract; it does not rewrite
    // any content.
    const aboutTiming = /\b(minute|min\b|time|timing|shorter|longer|shorten|extend|quick)/i.test(
      directive || ""
    );
    let minutesOverridden = false;
    if (!aboutTiming && target.minutes != null && section.minutes !== target.minutes) {
      section.minutes = target.minutes;
      minutesOverridden = true;
    }

    // What the redo did to the period as a whole. Returning this is the point:
    // a section redo could break the total and nothing ever recomputed it.
    const nextSections = current.sections.map((s) => (s.label === label ? section : s));
    const timing = verifyTiming(nextSections, current.periodLength || input.periodLength, [
      { label: "Exit ticket", minutes: current.exitTicket?.minutes },
    ]);
    const figures = scanFigures({ sections: [section] }, input);

    logGeneration({
      stage: "section",
      input,
      result: {
        sections: 1,
        figuresAsserted: figures.asserted.length,
        figuresBare: figures.bare.length,
        citationsFound: citations.findings.length,
        citationsRemoved: citations.removed,
      },
      timing,
      ms: Date.now() - startedAt,
    });

    return res.status(200).json({
      promptVersion: PROMPT_VERSION,
      section,
      minutesOverridden,
      timing,
      figures: { asserted: figures.asserted, bare: figures.bare },
    });
  } catch (err) {
    // A stalled upstream is a distinct failure from a rejected one, and the
    // teacher should be told to retry rather than left guessing.
    if (err instanceof ModelTimeoutError || err?.name === "ModelTimeoutError") {
      res.setHeader("Retry-After", "5");
      return res.status(504).json({
        error: "Section redo took too long to respond. Please try again.",
      });
    }
    const status = err?.status;
    console.error("Gemini section regenerate failed:", err?.message || err);
    if (status === 429) {
      res.setHeader("Retry-After", "20");
      return res.status(429).json({ error: "Rate limit or quota exceeded. Try again shortly." });
    }
    return res.status(500).json({ error: "Could not redo that section. Please try again." });
  }
}
