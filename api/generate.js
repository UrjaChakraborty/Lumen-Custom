// Vercel Serverless Function — POST /api/generate
//
// Accepts the Resource Builder form data and asks Gemini (a free-tier flash
// model) to draft a culturally-responsive resource. Runs on the server only: the Gemini
// API key is read from process.env and is NEVER shipped to the browser.
//
// The response is forced into the same { title, meta, sections } shape the
// Results screen already renders (see src/pages/Generate.jsx), and structured
// output (responseMimeType JSON + responseSchema) keeps the model from
// returning prose/gibberish.

import { GoogleGenAI, Type } from "@google/genai";
import { runGuards, parseBody, sanitizeInput } from "./_security.js";
import { screenRequest, refusePII } from "./_pii.js";
import { PROSE_STYLE_RULES, GROUNDING_RULES, CONTRAST_EXAMPLES, enforceProseStyle,
  SELF_CERT, stripSelfCertification } from "./_style.js";
import { stripCitations, deriveSources } from "./_sources.js";
import { scanFigures } from "./_figures.js";
import {
  PROMPT_VERSION,
  STAGES,
  TEMPERATURE,
  logGeneration,
  createCallBudget,
  withTimeout,
  ModelTimeoutError,
} from "./_pipeline.js";
import {
  verifyCompleteness,
  verifyTiming,
  timingRetryInstruction,
  countPlaceholders,
  checkReadability,
  readabilityRetryInstruction,
  verifyGrouping,
  verifyPrintCounts,
  reconcileNeedsMoreInfo,
  verifyStudentCopy,
  verifyQuestionsReachStudents,
  verifySafetyEarned,
} from "./_verify.js";
import { formatCheckpointsForPrompt, resolveSupportTags } from "./_udl.js";
import { documentSchemaFor, blocksFor, normalizeSections, countAudienceFallbacks } from "./_schema.js";
import {
  reconcile,
  solveSchema,
  SOLVE_SYSTEM_PROMPT,
  collectVerifiable,
  scatterReconciled,
  checkKeyAlignment,
} from "./_math.js";
import { normalizeInput } from "./_normalize.js";
import {
  findCandidateStandards,
  formatCandidatesForPrompt,
  validateStandards,
} from "./_standards.js";

// Flash-lite tier keeps latency + cost lowest. "gemini-flash-lite-latest" is an
// alias that always resolves to the current stable free-tier flash-lite model,
// so it keeps working on the free tier even when a specific dated version is
// retired. For higher quality (but slower) use "gemini-flash-latest"; to pin a
// fixed version use e.g. "gemini-3.1-flash-lite".
const MODEL = "gemini-flash-lite-latest";

// ── System prompt: the "constitution" every generation inherits. ────────────
// Mirrors src/data/promptLibrary.js so the real LLM path matches the mock one.
const SYSTEM_PROMPT = `You are an instructional co-designer for high school STEM teachers.
You design materials grounded in Culturally Responsive Pedagogy (CRP), Culturally
Sustaining Pedagogy (CSP), and Universal Design for Learning (UDL).

Non-negotiable rules:
1. Treat students' cultures, languages, and communities as ASSETS to build on,
   never deficits to fix. Never use deficit language (e.g. "struggling,"
   "low-level," "these kids can't").
2. Anchor abstract STEM concepts in the SPECIFIC community context provided.
   Be specific and respectful; never rely on cultural stereotypes or generic
   "diverse" filler.
3. Apply UDL: always offer multiple means of representation and multiple ways
   for students to demonstrate learning.
4. Honor accessibility constraints (reading level, language, low-tech/offline,
   neurodiverse supports) as stated.
5. Preserve rigor. Cultural relevance and accessibility never mean lowering
   expectations.
6. You are a drafting assistant. Never invent facts about a specific community
   you weren't given.
7. Relevance comes before personalization. Use a stated student interest only
   when it genuinely helps teach the selected concept; never force an unrelated
   interest into a lesson. If it does not fit, teach from the topic, standard,
   subject, and provided context instead.
8. Use the supplied form as meaningful constraints, not as a checklist to echo.
   Address the grade, time, reading level, language, technology, learning needs,
   and selected customization tasks where they affect the resource. Be concrete
   enough to teach from, avoid generic filler, and do not invent missing facts.

OUTPUT CONTRACT:
- Respond with ONLY the JSON object described by the schema. No preamble, no
  markdown, no code fences.
- "title": a specific, human title for the resource.
- "meta": 2-3 short tag strings (e.g. grade + course, alignment).
- "sections": each has a "label" (the section heading), and EITHER a prose
  "body" OR an "items" array of bullet strings, never both. For list-style
  sections (activities, supports, questions) use "items" and set "body" to "".
  For prose sections use "body" and set "items" to [].
- Include "discussionQuestions" only when collaborative/full assistance is
  selected or the teacher explicitly selected discussion questions. When
  included, return 4-6 specific student-facing questions, with no duplicates.

${PROSE_STYLE_RULES}

${GROUNDING_RULES}

${CONTRAST_EXAMPLES}`;

// Per-deliverable guidance on which sections to produce. Kept faithful to the
// prompt templates in src/data/promptLibrary.js.
const SECTION_GUIDES = {
  lesson: `Produce a complete, teachable lesson plan with clear, content-specific detail. Include:
1. Learning objective: measurable and rigorous, naming the knowledge/skill and what students will produce.
2. Prior knowledge and key concept: identify prerequisites, explain the central idea accurately in student-ready language, and address a likely misconception.
3. Cultural and community connection: use only the specific context provided, when genuinely relevant. Do not force student interests into the topic; unrelated interests may be offered as optional examples, not the lesson's premise.
4. Warm-up and hook: include a concise teacher launch, student task, and 2-3 diagnostic questions that reveal prior thinking.
5. Explicit instruction and model: explain the key concept with a worked example, think-aloud, or demonstration appropriate to the subject.
6. Guided practice: provide sequenced teacher/student moves, checks for understanding, likely responses, and a support prompt.
7. Main activity: use items[] with materials, student directions, expected product/evidence, and at least one choice of representation or response.
8. Independent practice or transfer: give students a distinct chance to apply the learning to a new example or context.
9. Differentiation supports: concrete adjustments for the stated reading levels and learning needs without reducing rigor; use items[].
10. Accessibility supports: specific language, reading, technology, and participation supports; use items[].
11. Assessment and check for understanding: include 4-6 varied, topic-specific questions/tasks from recall through reasoning/application, and explain what evidence indicates progress.
12. Teacher reflection question. Put it LAST, label it "Teacher reflection (optional)", set audience to "teacher", and give it 0 minutes. Ask about fit/evidence, not whether the plan is good.
For each instructional section, explain enough that a teacher can use or adapt it without inventing the missing steps. Avoid generic filler and repeated questions.`,

  activity: `Produce a hands-on, community-connected task with these sections:
1. Driving question (real, community-relevant)
2. Student roles / Collaboration Structure
3. Step by step task (works at the stated tech level; give a low-tech path): use items[]
4. Public product / Share-Out
5. Multiple ways to participate (UDL action & expression): use items[]
6. Materials (note low-cost / no-cost options): use items[]`,

  assessment: {
    quiz: `Produce a differentiated quiz:
1. Overview (DOK spread, tiering for the reading range)
2. Questions: use items[] (5-6 questions across DOK 1-3; for at least 2, offer write/diagram/explain-aloud options)
3. Answer key (with acceptable alternative responses): use items[]`,
    exit: `Produce a 3-question exit ticket:
1. Exit ticket questions: use items[] (Q1 recall, Q2 application in the community context, Q3 metacognition)
2. Low-Tech / Paper Version note`,
    rubric: `Produce a 4-level project rubric:
1. Overview (asset-based, growth-oriented language, no "poor/fails")
2. Criteria & Levels: use items[] (reward multiple valid ways to show mastery; include a community-connection criterion)`,
    multimodal: `Produce 3 alternative assessments measuring the SAME objective through different modes:
1. Overview
2. Assessment options: use items[] (e.g. build/model, oral explanation, visual, community interview; each with a quick scoring guide)`,
  },

  feedback: {
    strengths: `Produce strengths-based feedback:
1. Strengths (2 specific): use items[]
2. Growth Step (1 concrete, framed positively)`,
    growth: `Produce growth-oriented feedback:
1. What's Working
2. Your Next Power Move (achievable next step, warm and specific)`,
    reflection: `Produce 3 student reflection prompts that build agency and metacognition:
1. Reflection prompts: use items[]`,
    family: `Produce a short, warm, plain-language message to a family:
1. Message Home (no jargon, asset-based, printable)`,
  },
};

const LABELS = {
  lesson: "Lesson Plan",
  activity: "Activity",
  assessment: "Assessment",
  feedback: "Feedback",
};

const CUSTOM_TASKS = {
  brainstormIdeas: { label: "Brainstorm ideas", instruction: "offer concise idea starters, not a finished resource" },
  lessonOutline: { label: "Lesson outline", instruction: "give a concise, editable outline for the lesson" },
  draftActivities: { label: "Activity ideas", instruction: "draft classroom activities suited to the class context" },
  discussionQuestions: { label: "Discussion questions", instruction: "suggest open-ended discussion questions" },
  differentiationStrategies: {
    label: "Differentiation strategies",
    instruction: "suggest concrete differentiation strategies for the stated needs",
  },
  draftAssessment: { label: "Assessment draft", instruction: "draft an assessment aligned to the topic and class" },
};

function isCompleteDraft(input) {
  const tasks = input.customTasks || [];
  return tasks.includes("completeLesson") || (tasks.length === 0 && input.assistanceLevel === "full");
}

function wantsDiscussionQuestions(input) {
  return (
    input.assistanceLevel === "collaborative" ||
    input.assistanceLevel === "full" ||
    (input.customTasks || []).includes("discussionQuestions")
  );
}

function readable(readingLevel) {
  return (
    {
      "below-grade": "below grade level",
      "on-grade": "on grade level",
      "above-grade": "above grade level",
      mixed: "a mixed / wide range",
    }[readingLevel] || "on grade level"
  );
}

function sectionGuide(input) {
  const tasks = input.customTasks || [];
  if (tasks.length && !tasks.includes("completeLesson")) {
    const sectionTasks = tasks.filter((task) => task !== "discussionQuestions");
    const selected = sectionTasks.length
      ? sectionTasks.map((task) => `- ${CUSTOM_TASKS[task].label}: ${CUSTOM_TASKS[task].instruction}`).join("\n")
      : `- Question focus: give one concise sentence identifying the central topic students will discuss.`;
    return `The teacher explicitly selected these outputs. Produce one section for each output that belongs in the resource body, in the same order, using the exact section labels shown:
${selected}
Do not add unselected sections. Keep every section specific to the topic and selected ${LABELS[input.outputType] || "resource"} type. Give usable detail and concrete examples when supported by the supplied inputs.${wantsDiscussionQuestions(input) ? "\nAlso fill discussionQuestions with 4-6 distinct, open-ended student questions tailored to the chosen outputs. Do not repeat questions from a selected Discussion questions section." : ""}`;
  }
  if (input.assistanceLevel === "minimal" && !tasks.includes("completeLesson")) {
    return `The selected resource type is ${LABELS[input.outputType] || "resource"}. Produce only these brainstorming sections, in order:
1. Brainstorm ideas: 3 concise idea starters, not a complete resource
2. Standards connections: use only teacher-selected or candidate standards${wantsDiscussionQuestions(input) ? "\nAlso fill discussionQuestions with 4-6 distinct, open-ended student questions that extend the selected topic." : ""}`;
  }
  if (input.assistanceLevel === "collaborative" && !tasks.includes("completeLesson")) {
    const outlineLabel = input.outputType === "lesson" ? "Lesson outline" : "Resource outline";
    return `The selected resource type is ${LABELS[input.outputType] || "resource"}. Produce only these concise planning sections, in order:
1. ${outlineLabel}: an editable, sequenced outline with objective, key concept, teaching/modeling moves, guided and independent practice, and a clear close.
2. Activity ideas: concrete options with task directions, expected student thinking/product, and materials where relevant.
3. Differentiation suggestions: practical adaptations for stated needs, keeping the same learning goal and rigor.
4. Assessment ideas: multiple specific questions/tasks and what evidence to look for.
5. Standards connections: use only teacher-selected or candidate standards.${wantsDiscussionQuestions(input) ? "\nAlso fill discussionQuestions with 4-6 distinct, open-ended student questions that extend these planning ideas." : ""}`;
  }
  const guide = SECTION_GUIDES[input.outputType] || SECTION_GUIDES.lesson;
  if (typeof guide === "string") {
    return `${guide}${wantsDiscussionQuestions(input) ? "\n\nAlso fill discussionQuestions with 4-6 specific, open-ended student questions connected to the topic and resource. Do not repeat questions already in the resource." : ""}`;
  }
  // assessment / feedback are keyed by format
  return `${guide[input.format] || Object.values(guide)[0]}${wantsDiscussionQuestions(input) ? "\n\nAlso fill discussionQuestions with 4-6 specific, open-ended student questions connected to the topic, selected format, and resource. Do not repeat questions already in the resource." : ""}`;
}

// One entry per block, keyed by the same names the schema uses. Emitting these
// from BLOCKS_BY_TYPE means a block can never be described in the prompt while
// being absent from the schema, or required by the schema while never being
// explained. Those two drifting apart is precisely how every resource type came
// to be asked for a grouping plan.
function blockText(input) {
  return {
    materials: [
      `- materials: what to PRINT with copy counts for ${input.classSize || "the class"}, what to`,
      `  GATHER, and what to SET UP before the bell. Be specific enough to act on.`,
      `  Copy counts are compared against the class size in code. Say "one per group"`,
      `  when a handout is shared, so the smaller number reads as deliberate.`,
    ],
    vocabulary: [
      `- vocabulary: key terms with student-friendly definitions. Give a Spanish cognate`,
      `  ONLY where a real one exists. Where none does, write exactly NONE. Do not`,
      `  invent a cognate to fill the field. Give one sentence frame per term.`,
    ],
    misconceptions: [
      `- misconceptions: what students actually get wrong on this specific topic, and how`,
      `  to respond. Be concrete about the wrong idea, not generic about "struggling".`,
    ],
    differentiation: [
      `- differentiation: concrete below, on, and above grade variants of the task, plus`,
      `  accommodations phrased the way they appear in an IEP.`,
    ],
    accessibilitySupports: [
      `- accessibilitySupports: each support with the UDL checkpoint it serves,`,
      `  selected ONLY from this list. If no checkpoint fits, leave checkpoint empty.`,
      formatCheckpointsForPrompt(),
    ],
    safety: [
      `- safety: required for any lab or hands-on activity. Empty array if none apply.`,
      `  Do not invent hazards for a paper-and-pencil lesson.`,
    ],
    familyBlurb: [
      `- familyBlurb: two sentences a teacher can paste into a newsletter, no jargon.`,
    ],
    answerKey: [
      `- answerKey: the ANSWERS only. The questions themselves belong in sections[]`,
      `  where students can read them; this block mirrors them for the teacher, in`,
      `  the same order. Never put a question here instead of in a section: a quiz`,
      `  whose questions live only in the answer key hands students a blank page.`,
      `  Include the worked solution where there is computation to show, and leave`,
      `  work empty otherwise. Empty array only if the resource asks nothing.`,
      `  canonical: the SAME answer restated in a normal form so it can be checked`,
      `  mechanically. A plain decimal (write 3/4 as 0.75), a percent as 25%, an`,
      `  equation with no spaces (y=-4x+10), a comma-separated list for multi-part`,
      `  answers (2,5), or one lowercase word for a categorical answer (positive,`,
      `  negative, zero, undefined). It must restate the answer, not replace it or`,
      `  improve on it: the two are compared to each other in code, and a mismatch`,
      `  is reported to the teacher as the draft contradicting itself. Empty string`,
      `  for prose or open-ended answers.`,
    ],
    exitTicket: [
      `- exitTicket: a short end-of-period check with its own questions and its own key.`,
      `  Keep it to something a student can finish in the minutes you assign it.`,
      `  key must have exactly one entry per question, in the same order. Its numeric`,
      `  answers are re-solved independently in code, like the answer key.`,
    ],
    rubric: [
      `- rubric: how to grade the parts of this that do not have a single right`,
      `  answer. levelNames are the column headings, strongest first, in`,
      `  asset-based language: never "poor", "fails", or "unsatisfactory".`,
      `  Every criterion must have exactly as many levels as there are levelNames,`,
      `  in the same order. Each descriptor says what the WORK shows, never what`,
      `  the student is. Empty criteria array if everything here is right or wrong.`,
    ],
    homework: [
      `- homework: the task, plus one extension for students who want to go further.`,
      `  Leave both empty if homework does not fit this resource.`,
    ],
    grouping: [
      `- grouping: how to form groups for a class of ${input.classSize || "unknown size"}.`,
      `  Give groupCount, groupSize and leftover as numbers. They are checked in code:`,
      `  groupCount * groupSize + leftover must equal the class size, and leftover must`,
      `  be smaller than groupSize. The formation sentence must agree with those`,
      `  numbers, because that is the version the teacher reads.`,
      `  Give each role a name and what that student actually does.`,
      `  Leave formation empty and the numbers 0 if this resource is not group work.`,
    ],
  };
}

function blockInstructions(input) {
  if (!isCompleteDraft(input)) return [];
  const wanted = blocksFor(input.outputType);
  if (!wanted.length) return [];
  const text = blockText(input);
  const lines = [`ALSO PRODUCE THESE BLOCKS (they are separate fields, not sections):`];
  for (const name of wanted) lines.push(...(text[name] || []));
  return lines;
}

function buildUserPrompt(input, candidates) {
  const deliverable = LABELS[input.outputType] || "resource";
  const hasCulturalInput = Boolean(
    (input.studentInterests || "").trim() || (input.communityContext || "").trim()
  );
  const lines = [
    `Draft a ${deliverable} for a high school STEM class.`,
    ``,
    `CLASS CONTEXT`,
    `- Subject: ${input.subject || "STEM"}`,
    `- Course: ${input.course || "(unspecified)"}`,
    `- Grade / level: ${input.grade || "high school"}`,
    `- Period length: ${input.periodLength || 50} minutes (section minutes MUST sum to this)`,
    `- Class size: ${input.classSize || "(unspecified)"}`,
    `- Lesson structure to follow: ${input.lessonStructure || "(teacher has no preference)"}`,
    `- What students did last class: ${input.lastClass || "(not given)"}`,
    `- Topic / standard: ${input.topic || "(unspecified)"}`,
    ``,
    `STUDENTS & COMMUNITY`,
    `- Student interests: ${input.studentInterests || "(none given)"}`,
    `- Community context: ${input.communityContext || "(none given)"}`,
    `- Cultural / linguistic assets: ${input.culturalAssets || "(none given)"}`,
    ``,
    `ACCESSIBILITY & DIFFERENTIATION`,
    `- Reading level: ${readable(input.readingLevel)}`,
    `- Language support: ${input.language || "English"}`,
    `- Learning needs: ${
      (input.learningNeeds || []).join(", ") || "varied learner needs"
    }`,
    `- Neurodiverse supports: ${input.neurodiverseSupport ? "yes" : "not specified"}`,
    `- Tech level: ${input.resourceLevel || "medium"}${
      input.lowTech ? " (provide a low-tech / offline path)" : ""
    }`,
  ];

  if (input.outputType === "feedback" && input.workSummary) {
    lines.push(``, `STUDENT WORK SUMMARY`, `- ${input.workSummary}`);
  }

  lines.push(
    ``,
    ...(Array.isArray(input.standards) && input.standards.length
      ? [
          ``,
          `THE TEACHER ALREADY CHOSE THESE STANDARDS: ${input.standards.join(", ")}.`,
          `Return exactly these in the standards field and write the lesson to them.`,
          `Do not substitute a different code.`,
        ]
      : []),
    ``,
    `CANDIDATE STANDARDS (select only from these; return [] if none fit)`,
    formatCandidatesForPrompt(candidates),
    ``,
    `WHAT TO PRODUCE`,
    sectionGuide(input),
    ``,
    ...blockInstructions(input),
    ``,
    `PROCEDURE STEPS: for any section where the class is DOING something (warm-up,`,
    `main activity, the task, the share-out), fill steps[] with paired moves: what`,
    `the teacher does, and what students do at that same moment. This is how a real`,
    `plan template is laid out and the pairing is the point. Order matters, so put`,
    `them in the order they happen. Do not repeat the steps in body or items.`,
    `Leave steps empty for sections that are not a sequence of moves.`,
    ``,
    `AUDIENCE: mark every section. "student" if it belongs on a handout a student`,
    `reads, "teacher" for notes, rationale, and answer keys, "both" otherwise.`,
    `Pedagogical rationale is ALWAYS "teacher" so it can never leak onto a handout.`
  );

  // Stated at the point of use as well as in the system rules: this is the
  // instruction models are most likely to helpfully override.
  if (!hasCulturalInput) {
    lines.push(
      ``,
      `NO CULTURAL CONTEXT WAS PROVIDED.`,
      `The teacher left both student interests and community context empty.`,
      `Do not infer, guess, or generalise from the grade, course, or location.`,
      `Leave the cultural connection section body empty and list`,
      `"student interests" and "community context" in needs_more_info.`
    );
  }

  // #106 Name what is thin rather than drafting over it. The model is told which
  // fields were missing or unusable so its abstention is specific ("I need the
  // period length") instead of a generic hedge.
  if (input.missingFields?.length) {
    lines.push(
      ``,
      `THESE INPUTS WERE NOT PROVIDED: ${input.missingFields.join(", ")}.`,
      `List each one in needs_more_info. Do not invent a value for any of them.`
    );
  }
  if (input.junkFields?.length) {
    lines.push(
      ``,
      `THESE FIELDS DO NOT READ AS REAL VALUES: ${input.junkFields.join(", ")}.`,
      `Do not draft confident content around them. Say in needs_more_info that`,
      `you could not tell what was meant, and name the field.`
    );
  }

  lines.push(
    ``,
    `Avoid deficit language. Keep rigor high. Return only the JSON object.`
  );

  if (input.customTasks?.length && !input.customTasks.includes("completeLesson")) {
    lines.push(
      ``,
      `CUSTOM OUTPUTS: Produce only the tasks selected in the checklist, with no unselected sections.`,
      `The assistance level (${String(input.assistanceLevel || "full").toUpperCase()}) guides the amount of detail, not which tasks are included.`
    );
  } else if (input.customTasks?.includes("completeLesson")) {
    lines.push(
      ``,
      `CUSTOM OUTPUT: The teacher selected a complete lesson. Produce the complete first version of this ${LABELS[input.outputType] || "resource"} and its relevant teacher materials.`
    );
  } else if (input.assistanceLevel === "minimal") {
    lines.push(
      ``,
      `ASSISTANCE LEVEL: MINIMAL. Do not write a complete ${LABELS[input.outputType] || "resource"} or teacher materials. Only brainstorm ideas, discussion questions, and standards connections. Leave every typed teacher-material block empty.`
    );
  } else if (input.assistanceLevel === "collaborative") {
    lines.push(
      ``,
      `ASSISTANCE LEVEL: COLLABORATIVE. Provide only a short outline and concise ideas for this ${LABELS[input.outputType] || "resource"}, differentiation, and assessment. Do not write a complete resource or polished major sections. Leave every typed teacher-material block empty so the teacher can fill it in.`
    );
  } else {
    lines.push(
      ``,
      `ASSISTANCE LEVEL: FULL DRAFT. Create a complete first version of the ${LABELS[input.outputType] || "resource"}, including relevant activities, assessment, and teacher materials. The teacher reviews it before use.`
    );
  }

  return lines.join("\n");
}

// Structured-output schema. Forcing this shape is what prevents gibberish.
//
// `standards` and `needs_more_info` are typed fields rather than prose so they
// can be validated in code: a standards code gets checked against the dataset
// before it renders, and an abstention is a first-class result the UI can act
// on instead of a sentence buried in a paragraph.
// Built per request rather than once at module load: the shape depends on the
// resource type, and asking a feedback note for a grouping plan is what this
// replaces.
const schemaFor = (input) => {
  const includeQuestions = wantsDiscussionQuestions(input);
  const schema = documentSchemaFor(input.outputType, {
    includeDiscussionQuestions: includeQuestions,
  });
  if (isCompleteDraft(input)) return schema;
  const keys = [
    "title",
    "meta",
    "standards",
    "needs_more_info",
    "sections",
    ...(includeQuestions ? ["discussionQuestions"] : []),
  ];
  return {
    ...schema,
    properties: Object.fromEntries(keys.map((key) => [key, schema.properties[key]])),
    required: keys,
    propertyOrdering: keys,
  };
};

function completenessFor(data, input) {
  const questionProblems =
    wantsDiscussionQuestions(input) &&
    (!Array.isArray(data.discussionQuestions) || data.discussionQuestions.length < 4)
      ? ["discussionQuestions must contain at least four questions"]
      : [];
  if (isCompleteDraft(input)) {
    return [...verifyCompleteness(data, input.outputType), ...questionProblems];
  }
  if (input.customTasks?.length) {
    const expected = input.customTasks
      .filter((task) => task !== "discussionQuestions")
      .map((task) => CUSTOM_TASKS[task]?.label)
      .filter(Boolean);
    const labels = (data.sections || []).map((section) => String(section?.label || "").toLowerCase());
    return [
      ...verifyCompleteness(data, "feedback"),
      ...questionProblems,
      ...expected
        .filter((label) => !labels.includes(label.toLowerCase()))
        .map((label) => `missing a section: "${label}"`),
    ];
  }
  const expected =
    input.assistanceLevel === "minimal"
      ? ["Brainstorm ideas", "Standards connections"]
      : [
          "Resource outline",
          "Activity ideas",
          "Differentiation suggestions",
          "Assessment ideas",
          "Standards connections",
        ];
  const labels = (data.sections || []).map((section) => String(section?.label || "").toLowerCase());
  return [
    ...verifyCompleteness(data, "feedback"),
    ...questionProblems,
    ...expected
      .filter((label) => !labels.includes(label.toLowerCase()))
      .map((label) => `missing a section: "${label}"`),
  ];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Security: same-origin check + per-IP rate limit + baseline headers.
  // Runs BEFORE any Gemini call so abusive traffic never costs a request.
  if (!runGuards(req, res, { limit: 15, windowMs: 60_000 })) return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Never leak details; just signal a config problem.
    return res.status(500).json({ error: "Server is not configured for generation." });
  }

  const parsed = parseBody(req);
  if (parsed.error === "too_large") {
    return res.status(413).json({ error: "Request body too large." });
  }
  if (parsed.error === "invalid_json") {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  // Strict allowlist sanitization: cap lengths, drop unknown/oversized fields,
  // coerce types. Bounds what we ever forward to the model.
  const input = sanitizeInput(parsed.data);

  // Defence in depth: the browser screens too, but a browser check is not a
  // control. This is the gate that actually holds.
  const pii = screenRequest({ input });
  if (pii.length) return refusePII(res, pii);

  if (!input.subject?.trim() && !input.topic?.trim()) {
    return res.status(400).json({ error: "Provide at least a subject or a topic." });
  }

  try {
    // #90 stage 1: normalize. Canonicalizes course, subject and grade so
    // retrieval matches on "bio" and "Alg 1", and names any field that is
    // missing or is keyboard mash so the draft can abstain on it by name.
    const normalized = normalizeInput(input);

    // #90 stage 2: retrieve. Standards come from the local dataset before the
    // call, so the model only ever chooses from a real slate and never writes a
    // code from memory. Retrieval uses the canonical values.
    const candidates = findCandidateStandards({
      ...normalized,
      subject: normalized.subjectForRetrieval || input.subject,
      course: normalized.canonicalCourse || input.course,
    });

    const startedAt = Date.now();
    // #92 Bounds the upstream fan-out for this one request. See _pipeline.js.
    const budget = createCallBudget();
    const ai = new GoogleGenAI({ apiKey });
    budget.take(STAGES.DRAFT);
    const response = await withTimeout(ai.models.generateContent({
      model: MODEL,
      contents: buildUserPrompt(normalized, candidates),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: TEMPERATURE[STAGES.DRAFT],
        responseMimeType: "application/json",
        responseSchema: schemaFor(input),
        maxOutputTokens: 4096,
      },
    }));

    let data;
    try {
      data = JSON.parse(response.text);
    } catch {
      return res.status(502).json({ error: "The model returned malformed output. Try again." });
    }
    data.discussionQuestions = wantsDiscussionQuestions(input) && Array.isArray(data.discussionQuestions)
      ? data.discussionQuestions
          .filter((question) => typeof question === "string" && question.trim())
          .slice(0, 6)
      : [];
    if (wantsDiscussionQuestions(input) && data.discussionQuestions.length < 4) {
      return res.status(502).json({
        error: "The draft did not include enough relevant discussion questions. Please try again.",
      });
    }

    // #98 Timing is checked by adding it up, then re-asked ONCE with the
    // measured delta. Re-asking with the number works where repeating the
    // original constraint does not: the model already believes it complied.
    let timing =
      !isCompleteDraft(input)
        ? { ok: true, reason: "not_applicable", total: null, target: input.periodLength }
        : verifyTiming(data.sections, input.periodLength);
    if (!timing.ok && budget.take(STAGES.TIMING_FIX)) {
      try {
        const retry = await withTimeout(ai.models.generateContent({
          model: MODEL,
          contents: `${buildUserPrompt(normalized, candidates)}\n\n${timingRetryInstruction(timing)}`,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: TEMPERATURE[STAGES.TIMING_FIX],
            responseMimeType: "application/json",
            responseSchema: schemaFor(input),
            maxOutputTokens: 4096,
          },
        }));
        const retried = JSON.parse(retry.text);
        const recheck = verifyTiming(retried.sections, input.periodLength);
        // Only accept the retry if it is actually better.
        if (Math.abs(recheck.delta) < Math.abs(timing.delta)) {
          data = retried;
          timing = recheck;
        }
      } catch (e) {
        console.warn("Timing retry failed, keeping first draft:", e?.message || e);
      }
    }

    // #100 Reading level is measured, then re-asked ONCE with the measured
    // score when it lands outside the band. Asking a model to "write at grade
    // level" does not work because it cannot check itself; handing it the
    // number it actually scored does.
    //
    // Same acceptance rule as the timing retry: the second draft is kept only
    // if it is genuinely closer to the band. Without that a retry can drift
    // further out and still be accepted for having tried.
    let readability = checkReadability(data, input.readingLevel);
    if (
      isCompleteDraft(input) &&
      !readability.ok &&
      readability.band &&
      budget.take(STAGES.READABILITY_FIX)
    ) {
      const distance = (r) =>
        r.grade == null ? Infinity : Math.max(0, r.band[0] - r.grade, r.grade - r.band[1]);
      try {
        const retry = await withTimeout(ai.models.generateContent({
          model: MODEL,
          contents: `${buildUserPrompt(normalized, candidates)}\n\n${readabilityRetryInstruction(readability)}`,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: TEMPERATURE[STAGES.READABILITY_FIX],
            responseMimeType: "application/json",
            responseSchema: schemaFor(input),
            maxOutputTokens: 4096,
          },
        }));
        const retried = JSON.parse(retry.text);
        const recheck = checkReadability(retried, input.readingLevel);
        // A retry that fixes the reading level by dropping half the lesson is
        // not a fix, so completeness has to survive too.
        const stillComplete =
          completenessFor(retried, input).length <= completenessFor(data, input).length;
        if (distance(recheck) < distance(readability) && stillComplete) {
          data = retried;
          readability = recheck;
          // The timing check was run against the draft we just replaced.
          timing = verifyTiming(data.sections, input.periodLength);
        }
      } catch (e) {
        console.warn("Readability retry failed, keeping first draft:", e?.message || e);
      }
    }
    if (!readability.ok) {
      console.warn(
        `Readability grade ${readability.grade} outside band ${readability.band?.join("-")}`
      );
    }

    // #99 Verify the numbers before anything renders. Arithmetic is computed
    // here; anything not evaluable gets ONE independent solve that never sees
    // the proposed answer. A disputed entry is marked, never quietly replaced.
    // The exit ticket's key rides this SAME call rather than buying a second
    // one. Its answers were never verified before, which meant the artifact a
    // teacher marks fastest was the one with no arithmetic check on it.
    let mathSummary = { checked: 0, disputed: 0, confirmed: 0 };
    const { combined, origins, selected: verifiable } = collectVerifiable(data);
    if (verifiable.length && budget.take(STAGES.VERIFY_MATH)) {
      let solved = [];
      try {
        const solveRes = await withTimeout(ai.models.generateContent({
          model: MODEL,
          contents: [
            `Solve each question. Return the index you were given for each.`,
            ``,
            ...verifiable.map(({ entry, index }) => `${index}. ${entry.question}`),
          ].join("\n"),
          config: {
            systemInstruction: SOLVE_SYSTEM_PROMPT,
            // Zero: this is recall and computation, and variation here is error.
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: solveSchema,
            maxOutputTokens: 1024,
          },
        }));
        solved = JSON.parse(solveRes.text)?.answers || [];
      } catch (e) {
        // A failed verification must not fail the draft. It means unverified,
        // which the UI shows as unverified rather than as checked.
        console.warn("Math verification call failed:", e?.message || e);
      }
      const rec = reconcile(combined, solved);
      scatterReconciled(data, rec.answerKey, origins);
      mathSummary = {
        checked: verifiable.length,
        disputed: rec.disputed,
        confirmed: rec.confirmed,
        // How many were comparable at all via the normal form. Before this
        // existed the answer to "why was this not checked" was invisible.
        canonicalChecked: rec.canonicalChecked,
        selfContradictions: rec.selfContradictions,
        includesExitTicket: origins.includes("exitTicket"),
      };
      if (rec.disputed) {
        console.warn(`Math verification disputed ${rec.disputed} answer key entries`);
      }
    }

    // #101 Completeness. Reported rather than silently patched, so a gap is
    // visible to the teacher instead of looking like a design choice.
    const completeness = completenessFor(data, input);
    if (completeness.length) {
      console.warn("Completeness problems:", completeness.join("; "));
    }

    // Belt and braces on the prose contract: the prompt asks, this enforces the
    // mechanical parts (dashes, curly quotes) the model sometimes still emits.
    data = enforceProseStyle(data);

    // Gate the standards: anything not in the local dataset is dropped rather
    // than rendered. A plausible invented code is worse than no code.
    const { valid: standards, rejected } = validateStandards(data.standards);
    const { supports: accessibilitySupports, rejected: badCheckpoints } = resolveSupportTags(
      data.accessibilitySupports
    );
    if (badCheckpoints.length) {
      console.warn("Dropped UDL checkpoints not in the dataset:", badCheckpoints.join(", "));
    }
    if (rejected.length) {
      console.warn("Dropped standards codes not present in dataset:", rejected.join(", "));
    }

    // The model must not certify its own compliance. The meta tags are dropped
    // wholesale; inside prose only a sentence that is nothing BUT a
    // certification is cut, and the rest is flagged (see stripSelfCertification).
    const meta = (Array.isArray(data.meta) ? data.meta : []).filter((m) => !SELF_CERT.test(m));
    const selfCert = stripSelfCertification(data);

    // Citations are removed before anything else looks at the prose, because a
    // citation attached to a figure makes that figure look sourced. Lumen has no
    // retrieval, so any citation here was invented.
    const citations = stripCitations(data);

    // Recompute timing once more now the document is final, this time counting
    // the exit ticket. It was excluded entirely before, so a 50 minute period
    // plus a 10 minute ticket reported a clean pass and then ran past the bell.
    // The overrun is reported separately from `delta` on purpose: `delta` drives
    // the retry, and the fix for "the ticket does not fit" is not "shrink the
    // lesson".
    timing =
      !isCompleteDraft(input)
        ? { ok: true, reason: "not_applicable", total: null, target: input.periodLength }
        : verifyTiming(data.sections, input.periodLength, [
            { label: "Exit ticket", minutes: data.exitTicket?.minutes },
          ]);

    // The arithmetic the prompt demanded, finally added up. None of these rewrite
    // a number: a disputed count is marked and shown, like a disputed answer.
    const groupingCheck = verifyGrouping(data.grouping, input.classSize);
    if (groupingCheck.state === "warn" && data.grouping) {
      data.grouping.disputed = true;
      data.grouping.disputeNote = groupingCheck.note;
    }
    const printCheck = verifyPrintCounts(data.materials, input.classSize, data.grouping);
    const keyAlignment = checkKeyAlignment(data.exitTicket);

    // A cognate the model had to invent is worse than none. NONE is the sentinel
    // the schema offers for "no real cognate exists"; map it back to empty.
    if (Array.isArray(data.vocabulary)) {
      for (const v of data.vocabulary) {
        if (/^\s*none\s*$/i.test(String(v?.cognate || ""))) v.cognate = "";
      }
    }

    // Figures that assert something about the real world with no source, and the
    // derived provenance block that replaces the model-written `sources` field.
    const figures = scanFigures(data, input);
    const sources = deriveSources(data, input, figures);

    // The model's own list of gaps, unioned with the ones the normalizer actually
    // measured. A gap it failed to name is an abstention failure worth showing.
    const nmi = reconcileNeedsMoreInfo(
      data.needs_more_info,
      normalized,
      Boolean(String(input.studentInterests || "").trim() || String(input.communityContext || "").trim())
    );

    // Collapse { body, items } into the UI's body: string | string[] contract.
    // Count the fallbacks BEFORE normalising, since that is what resolves them.
    const audienceFallbacks = countAudienceFallbacks(data.sections);
    const sections = normalizeSections(data.sections);

    // What students actually receive. Both of these produce blank paper when they
    // fail, which is the one outcome that must never be the quiet one.
    const studentCopy = verifyStudentCopy(sections, audienceFallbacks);
    const questionsReach = verifyQuestionsReachStudents({ ...data, sections });
    const safetyEarned = verifySafetyEarned(data);

    logGeneration({
      stage: STAGES.DRAFT,
      input,
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
        nmiAdded: nmi.added.length,
      },
      timing,
      completeness,
      ms: Date.now() - startedAt,
    });

    return res.status(200).json({
      promptVersion: PROMPT_VERSION,
      kind: input.outputType || "lesson",
      title: data.title || "Draft",
      meta,
      standards,
      ...(wantsDiscussionQuestions(input)
        ? { discussionQuestions: data.discussionQuestions }
        : {}),
      standardsRejected: rejected.length,
      needsMoreInfo: nmi.list,
      materials: data.materials || null,
      vocabulary: Array.isArray(data.vocabulary) ? data.vocabulary : [],
      misconceptions: Array.isArray(data.misconceptions) ? data.misconceptions : [],
      differentiation: data.differentiation || null,
      accessibilitySupports,
      safety: Array.isArray(data.safety) ? data.safety : [],
      familyBlurb: data.familyBlurb || "",
      // Derived in code, never model-written. See api/_sources.js.
      sources: sources.rows,
      // #67/#69/#70/#71 Typed blocks rather than sections, so the student copy
      // strips the answer key by structure and not by trusting a label.
      answerKey: Array.isArray(data.answerKey) ? data.answerKey : [],
      exitTicket: data.exitTicket?.questions?.length ? data.exitTicket : null,
      rubric: data.rubric?.criteria?.length ? data.rubric : null,
      homework: data.homework?.task ? data.homework : null,
      grouping: data.grouping?.formation ? data.grouping : null,
      // Verification results travel with the draft so the UI can show what was
      // checked rather than implying everything was.
      verification: {
        timing,
        completeness,
        placeholders: countPlaceholders(data),
        readability,
        math: mathSummary,
        keyAlignment,
        grouping: groupingCheck,
        printCounts: printCheck,
        figures: {
          scanned: figures.scanned,
          asserted: figures.asserted,
          bare: figures.bare,
          traced: figures.traced.length,
        },
        citations: { found: citations.findings.length, removed: citations.removed },
        selfCert: { flagged: selfCert.flagged.length, removed: selfCert.removed },
        needsMoreInfo: { added: nmi.added },
        studentCopy,
        questionsReach,
        safetyEarned,
        audienceFallbacks,
        // Which route produced this and when. Replaces sniffing _label/_changed
        // on the client: a check knows whether IT is stale, and most of these are
        // pure functions of the document and never go stale at all.
        stage: STAGES.DRAFT,
        checkedAt: new Date().toISOString(),
        // #108 Which checks actually ran. A check that was skipped for budget
        // must not read as a check that passed.
        budget: budget.summary(),
      },
      sections,
    });
  } catch (err) {
    // The @google/genai SDK surfaces the upstream HTTP status on err.status.
    // A stalled upstream is a distinct failure from a rejected one, and the
    // teacher should be told to retry rather than left guessing.
    if (err instanceof ModelTimeoutError || err?.name === "ModelTimeoutError") {
      res.setHeader("Retry-After", "5");
      return res.status(504).json({
        error: "Generation took too long to respond. Please try again.",
      });
    }
    const status = err?.status;
    console.error("Gemini generate failed:", err?.message || err);
    if (status === 429) {
      res.setHeader("Retry-After", "20");
      return res
        .status(429)
        .json({ error: "Rate limit or quota exceeded. Check your Gemini plan and billing, then retry." });
    }
    if (status === 401 || status === 403) {
      return res.status(502).json({ error: "The generation service rejected the API key." });
    }
    return res.status(500).json({ error: "Generation failed. Please try again." });
  }
}
