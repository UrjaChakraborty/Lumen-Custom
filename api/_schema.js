// The document schema, in one place.
//
// This used to live inside generate.js while revise.js carried its own, much
// smaller one: { title, meta, sections[{label, body, items}] }. That meant every
// rewrite returned a document stripped of materials, vocabulary, misconceptions,
// differentiation, safety, sources, timing and audience tags, and the client
// spread that thinner object straight over the draft. A teacher who clicked
// "Shorten to 30 minutes" lost their answer key. Sharing the schema is what
// stops the two paths drifting apart again.
//
// Blocks are typed fields rather than free sections on purpose. The student copy
// is produced by dropping teacher-only fields structurally, so an answer key
// cannot reach a handout because the model mislabelled a section.

import { Type } from "@google/genai";
import { sectionId } from "../src/engine/sectionIds.js";

const strings = { type: Type.ARRAY, items: { type: Type.STRING } };

const pair = (a, b, aDesc, bDesc) => ({
  type: Type.OBJECT,
  properties: {
    [a]: { type: Type.STRING, ...(aDesc ? { description: aDesc } : {}) },
    [b]: { type: Type.STRING, ...(bDesc ? { description: bDesc } : {}) },
  },
  required: [a, b],
  propertyOrdering: [a, b],
});

export const DOCUMENT_PROPERTIES = {
  title: { type: Type.STRING },
  meta: strings,
  standards: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description:
      "Codes selected from the provided candidate list only. Empty array if none fit.",
  },
  needs_more_info: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description:
      "Names of specific teacher inputs that were missing or too thin to draft well.",
  },
  discussionQuestions: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description:
      "Four to six specific, open-ended, student-facing questions connected to the provided topic and selected resource/custom tasks. Include only when collaborative/full assistance is selected or the discussion questions task is checked. Do not invent missing context or repeat questions already in the resource.",
  },
  // #61 What to print, how many copies, what to gather before the bell.
  materials: {
    type: Type.OBJECT,
    properties: { print: strings, gather: strings, setup: strings },
    required: ["print", "gather", "setup"],
    propertyOrdering: ["print", "gather", "setup"],
  },
  // #64 Key terms, cognates, sentence frames.
  vocabulary: {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        term: { type: Type.STRING },
        definition: { type: Type.STRING },
        // An explicit sentinel, and no longer required. A required field that
        // looks empty when honest is standing pressure to invent a plausible
        // cognate; "NONE" gives the model a way to say no that still fills the
        // shape. Mapped back to "" in code.
        cognate: {
          type: Type.STRING,
          description: "A true Spanish cognate for this term, or exactly NONE if no real cognate exists.",
        },
        frame: { type: Type.STRING },
      },
      required: ["term", "definition", "frame"],
      propertyOrdering: ["term", "definition", "cognate", "frame"],
    },
  },
  // #65 The section that proves subject expertise.
  misconceptions: {
    type: Type.ARRAY,
    items: pair("misconception", "response"),
  },
  // #66 Concrete variants, phrased to map onto common IEP language.
  differentiation: {
    type: Type.OBJECT,
    properties: { below: strings, on: strings, above: strings, accommodations: strings },
    required: ["below", "on", "above", "accommodations"],
    propertyOrdering: ["below", "on", "above", "accommodations"],
  },
  // #57/#95 Each support cites a CAST checkpoint, validated in code.
  accessibilitySupports: {
    type: Type.ARRAY,
    items: pair(
      "text",
      "checkpoint",
      undefined,
      "A UDL checkpoint id from the provided list, e.g. 2.4. Never invent one."
    ),
  },
  safety: strings,
  familyBlurb: { type: Type.STRING },
  // `sources` is deliberately ABSENT from this schema.
  //
  // It used to be a bare ARRAY<STRING> the model wrote, with no description and
  // no validation anywhere. Lumen has no search tool and no corpus, so every
  // specific citation the model could produce was invented by construction — and
  // an invented citation is worse than an invented number, because it makes the
  // number look checked. The block is now derived in code from placeholders,
  // traced teacher inputs and the lesson's own timing (api/_sources.js). The
  // model cannot fabricate a field it never writes.

  // #67 Answer key and worked solutions, teacher only.
  answerKey: {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        question: { type: Type.STRING },
        answer: { type: Type.STRING },
        // A second statement of the same answer, in a form code can compare.
        // Not trusted: the server canonicalises `answer` independently and a
        // disagreement between the two is itself a dispute. See
        // src/engine/canonical.js.
        canonical: {
          type: Type.STRING,
          description:
            "The same answer in a normal form: a plain decimal (write 3/4 as 0.75), a percent as 25%, an equation with no spaces (y=-4x+10), a comma-separated list of values for multi-part answers (2,5), or one lowercase word for a categorical answer (positive, negative, zero, undefined). Empty string when the answer is prose, open-ended, or does not fit any of those.",
        },
        work: {
          type: Type.STRING,
          description: "The worked solution step by step. Empty when there is no computation.",
        },
      },
      required: ["question", "answer", "canonical", "work"],
      propertyOrdering: ["question", "answer", "canonical", "work"],
    },
  },
  // #69 Exit ticket as its own printable, with its own key.
  exitTicket: {
    type: Type.OBJECT,
    properties: {
      prompt: { type: Type.STRING },
      questions: strings,
      key: strings,
      minutes: { type: Type.INTEGER },
    },
    required: ["prompt", "questions", "key", "minutes"],
    propertyOrdering: ["prompt", "questions", "key", "minutes"],
  },
  // A scoring guide for anything that is not a right-or-wrong answer.
  //
  // `rubric` already existed as a whole assessment FORMAT, so a teacher could
  // generate a standalone rubric — but a quiz or a project assessment came back
  // with an answer key and no way to grade an open response, which is the half of
  // an assessment that actually takes a Sunday afternoon.
  //
  // Typed rather than prose so it renders and prints as a table and cannot drift
  // between the screen, the Word export and the Markdown one.
  rubric: {
    type: Type.OBJECT,
    properties: {
      criteria: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "What is being judged, in a few words." },
            levels: {
              type: Type.ARRAY,
              description:
                "Descriptors from strongest to developing, same count for every criterion. Describe what the work shows, never the student.",
              items: { type: Type.STRING },
            },
          },
          required: ["name", "levels"],
          propertyOrdering: ["name", "levels"],
        },
      },
      levelNames: {
        type: Type.ARRAY,
        description: "Column headings, strongest first. Asset-based language: never 'poor' or 'fails'.",
        items: { type: Type.STRING },
      },
    },
    required: ["criteria", "levelNames"],
    propertyOrdering: ["levelNames", "criteria"],
  },
  // #70 Homework or extension.
  homework: pair("task", "extension"),
  // #71 Grouping plan, sized against the actual class.
  //
  // The three integers are what make this checkable. The prompt always demanded
  // arithmetic ("how many groups, of what size, what to do with the remainder")
  // and nothing ever added it up, because the answer arrived as prose. Typed
  // fields let verifyGrouping do what verifyTiming does for minutes: recompute
  // and dispute, never rewrite.
  grouping: {
    type: Type.OBJECT,
    properties: {
      formation: {
        type: Type.STRING,
        description: "How to form groups for this class size, in one or two sentences.",
      },
      groupCount: { type: Type.INTEGER, description: "How many groups." },
      groupSize: { type: Type.INTEGER, description: "How many students in a full group." },
      leftover: {
        type: Type.INTEGER,
        description:
          "Students not in a full group. 0 when it divides evenly. groupCount * groupSize + leftover must equal the class size.",
      },
      roles: { type: Type.ARRAY, items: pair("role", "does") },
    },
    required: ["formation", "groupCount", "groupSize", "leftover", "roles"],
    propertyOrdering: ["formation", "groupCount", "groupSize", "leftover", "roles"],
  },
  sections: {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING },
        body: { type: Type.STRING },
        items: strings,
        // #53/#56 Paired moves rather than prose. A real plan template has two
        // columns, and the pairing is the information: what the teacher does is
        // only meaningful beside what students do at that same moment.
        steps: { type: Type.ARRAY, items: pair("teacher", "students") },
        minutes: {
          type: Type.INTEGER,
          description: "Whole minutes. Must sum across sections to the period length.",
        },
        audience: {
          type: Type.STRING,
          description:
            "'student' if it appears on a student handout, 'teacher' for notes, rationale, and keys, 'both' otherwise.",
        },
      },
      required: ["label", "body", "items", "steps", "minutes", "audience"],
      propertyOrdering: ["label", "body", "items", "steps", "minutes", "audience"],
    },
  },
};

const KEYS = Object.keys(DOCUMENT_PROPERTIES);

// The document itself, required for every resource type. These are not blocks
// hanging off a lesson; they are what makes the thing a document at all.
const CORE = ["title", "meta", "standards", "needs_more_info", "sections"];

// Which blocks each resource type actually needs.
//
// This used to be "all of them, always". `required` was every key in the schema,
// and structured output treats required as a contract, so a two-paragraph
// strengths-based note about one student's work was obliged to come back with a
// grouping plan sized to the class, an exit ticket, homework, safety notes and
// materials with copy counts. Every bit of it invented, because none of it
// exists for that resource.
//
// The offline engine never had this bug: mockBlocks() is spread only into
// generateLesson. Only the live path fabricated, which is why it went unnoticed.
//
// Two judgement calls worth naming. `answerKey` stays on ACTIVITY even though an
// activity is not a test, because the math verification in #99 only runs on
// answer keys and an activity involving calculation is exactly where a wrong
// number reaches students. `misconceptions` stays on ASSESSMENT because knowing
// what students get wrong is what makes a distractor worth writing.
export const BLOCKS_BY_TYPE = {
  lesson: [
    "materials",
    "vocabulary",
    "misconceptions",
    "differentiation",
    "accessibilitySupports",
    "safety",
    "familyBlurb",
    "answerKey",
    "exitTicket",
    "homework",
    "grouping",
  ],
  activity: [
    "materials",
    "vocabulary",
    "misconceptions",
    "differentiation",
    "accessibilitySupports",
    "safety",
    "answerKey",
    "homework",
    "grouping",
  ],
  assessment: [
    "rubric",
    "materials",
    "vocabulary",
    "misconceptions",
    "differentiation",
    "accessibilitySupports",
    "answerKey",
  ],
  // A note about one student's work. Almost nothing hangs off it, and the
  // family-friendly format is the one case that needs a paste-able blurb.
  feedback: ["familyBlurb"],
};

export function blocksFor(outputType) {
  return BLOCKS_BY_TYPE[outputType] || BLOCKS_BY_TYPE.lesson;
}

// The schema for one resource type. Both `properties` and `required` are
// subset, so a block that does not apply is not merely optional — the model is
// never shown that it exists.
export function documentSchemaFor(outputType, { includeDiscussionQuestions = true } = {}) {
  const core = includeDiscussionQuestions
    ? [...CORE, "discussionQuestions"]
    : CORE;
  const keys = [...core, ...blocksFor(outputType)];
  // Preserve the declaration order of DOCUMENT_PROPERTIES rather than the order
  // of the lists above, so propertyOrdering stays stable across types.
  const ordered = KEYS.filter((k) => keys.includes(k));
  const properties = {};
  for (const k of ordered) properties[k] = DOCUMENT_PROPERTIES[k];
  return {
    type: Type.OBJECT,
    properties,
    required: ordered,
    propertyOrdering: ordered,
  };
}

// The lesson-shaped default, kept for callers that have no type to hand.
export const documentSchema = documentSchemaFor("lesson");

// A stable id per section. Defined in src/engine so the client can share the
// one definition — see the note there.
export { sectionId } from "../src/engine/sectionIds.js";

// Collapse the model's { body, items } into the UI's body: string | string[]
// contract, and normalize everything the client renders.
// Where a section belongs when the model did not say.
//
// `items[]` is where SECTION_GUIDES routes questions, so a section made of items
// is student-facing by construction — that is the single most reliable signal
// available, and it is exactly the section a blank handout is missing.
//
// Everything else still falls back to "teacher", because the cost of the two
// mistakes is not symmetric: a teacher note shown to a teacher is clutter, an
// answer key shown to a class is the failure the typed-block design exists to
// prevent.
const TEACHER_LABEL = /\b(teacher|reflection|rationale|notes?|answer key|scoring|grading|prep)\b/i;

export function resolveAudience(section) {
  const stated = section?.audience;
  if (["student", "teacher", "both"].includes(stated)) return stated;
  if (TEACHER_LABEL.test(String(section?.label || ""))) return "teacher";
  const hasItems = Array.isArray(section?.items) && section.items.some((x) => String(x || "").trim());
  if (hasItems) return "student";
  return "teacher";
}

// How many sections had no usable audience and had to be resolved. logGeneration
// already reads this and has always received undefined, so the one signal that
// would have surfaced the blank-handout bug in the logs read zero forever.
export function countAudienceFallbacks(raw) {
  return (Array.isArray(raw) ? raw : []).filter(
    (s) => !["student", "teacher", "both"].includes(s?.audience)
  ).length;
}

export function normalizeSections(raw) {
  return Array.isArray(raw)
    ? raw.map((s, i) => ({
        id: sectionId(s?.label, i),
        label: s?.label || "",
        body: Array.isArray(s?.items) && s.items.length ? s.items : s?.body || "",
        steps: Array.isArray(s?.steps)
          ? s.steps
              .map((t) => ({
                teacher: String(t?.teacher || "").trim(),
                students: String(t?.students || "").trim(),
              }))
              .filter((t) => t.teacher || t.students)
          : [],
        minutes: Number.isFinite(Number(s?.minutes)) ? Math.round(Number(s.minutes)) : null,
        // Fails CLOSED — see the matching note in sanitizeCurrent. "both" put an
        // unlabelled section on the student handout, which is the one direction
        // that can hand a class the answers.
        //
        // But failing closed on EVERY section produces an empty student copy, and
        // that shipped: a model response omitting `audience` throughout yielded
        // "0 of 3 sections on the student copy" with nothing said anywhere. So
        // before falling back, read the structure, which is unambiguous in the
        // cases that matter. Only a MISSING value is inferred; an explicit one is
        // never overridden.
        audience: resolveAudience(s),
      }))
    : [];
}

// The blocks a rewrite may legitimately return. Anything the model omits falls
// back to what the draft already had, so a rewrite can never blank a block by
// simply not mentioning it.
// `outputType` filters the result to the blocks that type actually has.
//
// Without it a rewritten feedback note came back carrying
// `materials: {print:[],gather:[],setup:[]}` and an empty differentiation
// object. Nothing rendered, because every renderer guards on content — but the
// response shape claimed a feedback note has a materials list, and the next
// consumer to write `if (output.materials)` would have believed it.
// sanitizeCurrent() builds those empty shells unconditionally, so the filter
// belongs here, where the document's type is known.
export function mergeBlocks(next, prev, outputType) {
  const keep = (a, b) => (Array.isArray(a) && a.length ? a : Array.isArray(b) ? b : []);
  const all = {
    materials: next?.materials?.print || next?.materials?.gather ? next.materials : prev?.materials || null,
    vocabulary: keep(next?.vocabulary, prev?.vocabulary),
    misconceptions: keep(next?.misconceptions, prev?.misconceptions),
    differentiation: next?.differentiation?.below ? next.differentiation : prev?.differentiation || null,
    safety: keep(next?.safety, prev?.safety),
    familyBlurb: String(next?.familyBlurb || "").trim() || prev?.familyBlurb || "",
    answerKey: keep(next?.answerKey, prev?.answerKey),
    exitTicket: next?.exitTicket?.questions?.length ? next.exitTicket : prev?.exitTicket || null,
    rubric: next?.rubric?.criteria?.length ? next.rubric : prev?.rubric || null,
    homework: next?.homework?.task ? next.homework : prev?.homework || null,
    grouping: next?.grouping?.formation ? next.grouping : prev?.grouping || null,
  };

  // No type given: behave as before rather than silently dropping blocks.
  if (!outputType) return all;
  const allowed = new Set(blocksFor(outputType));
  const out = {};
  for (const [k, v] of Object.entries(all)) if (allowed.has(k)) out[k] = v;
  return out;
}
