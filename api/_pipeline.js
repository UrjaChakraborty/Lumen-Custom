// Generation pipeline configuration.
//
// Two ideas from the brief live here.
//
// #92 Temperature is split by what a field is FOR. An answer key, a timing
// figure, a standards selection and a vocabulary definition are recall and
// assembly tasks where variation is simply error. A hook and a framing sentence
// are the only places invention helps. Generating both at one temperature means
// either the opener is flat or the answer key is creative, and the second of
// those is the one that reaches students.
//
// #115 Every prompt is versioned and every generation is logged with the version
// that produced it. Prompt edits regress silently: without a version stamp on
// the output there is no way to tell which change caused a drop, and no way to
// build the eval set in #116 to #118 out of real traffic.

// Bump when any prompt, schema, or grounding rule changes. The version travels
// with the generated document so a bad batch can be traced to a specific edit.
// Bumped again: assessments gained a typed `rubric` block, and section audience
// is now inferred from structure when the model omits it rather than always
// falling back to "teacher" (which produced empty student handouts).
export const PROMPT_VERSION = "2026-10-19.6";

// Stage names, used for logging and for the eval harness to score per stage.
export const STAGES = {
  // #90 The pipeline in order. Normalize and retrieve run in code, which is why
  // they have no temperature: canonicalizing a course name and looking up a
  // standard are lookups, and a model call would make both slower and less
  // predictable without making either more correct.
  NORMALIZE: "normalize",
  RETRIEVE: "retrieve",
  DRAFT: "draft",
  READABILITY_FIX: "readability-fix",
  VERIFY_MATH: "verify-math",
  TIMING_FIX: "timing-fix",
  REVISE: "revise",
};

// #92 Per-stage temperature. The draft call has to produce both kinds of field
// in one pass, so it sits low: a flat hook is a smaller problem than a wrong
// answer key, and the hook can be improved with a targeted rewrite afterwards.
export const TEMPERATURE = {
  [STAGES.DRAFT]: 0.2,
  // Correction passes are pure arithmetic. Any variation here is noise.
  [STAGES.TIMING_FIX]: 0,
  // A reading-level correction rewrites prose rather than numbers, so it needs
  // a little room to rephrase, but not enough to wander off the lesson.
  [STAGES.READABILITY_FIX]: 0.15,
  // A rewrite follows an explicit teacher directive, so it needs a little room
  // to rephrase, but not enough to drift from the document it is editing.
  [STAGES.REVISE]: 0.3,
};

// Fields that must never be generated at a creative temperature. Kept as data
// so a future staged split (one call per group) can read it directly rather
// than rediscovering the classification.
export const LOW_TEMPERATURE_FIELDS = [
  "standards",
  "materials",
  "vocabulary",
  "misconceptions",
  "differentiation",
  "safety",
  "sources",
  "minutes",
];

export const CREATIVE_FIELDS = ["title", "familyBlurb"];

// #115 One log line per generation, with the version that produced it. Goes to
// the function log rather than anywhere persistent: this is a serverless
// handler with no store attached, and inventing one would be a bigger decision
// than this brief covers. The shape is deliberately stable so it can be shipped
// to a real sink later without changing callers.
export function logGeneration({ stage, input, result, timing, completeness, ms }) {
  try {
    console.log(
      JSON.stringify({
        evt: "generation",
        promptVersion: PROMPT_VERSION,
        stage,
        ms,
        // Inputs that shape the output, never free text a teacher typed: this
        // line goes to a log, and the privacy rule is that classroom prose
        // stays out of it.
        input: {
          outputType: input?.outputType || null,
          subject: input?.subject || null,
          grade: input?.grade || null,
          periodLength: input?.periodLength || null,
          lessonStructure: input?.lessonStructure || null,
          hasCulturalContext: Boolean(
            (input?.studentInterests || "").trim() || (input?.communityContext || "").trim()
          ),
        },
        result: {
          sections: Array.isArray(result?.sections) ? result.sections.length : 0,
          standardsKept: Array.isArray(result?.standards) ? result.standards.length : 0,
          standardsRejected: result?.standardsRejected ?? 0,
          needsMoreInfo: Array.isArray(result?.needs_more_info)
            ? result.needs_more_info.length
            : 0,
          placeholders: result?.placeholders ?? 0,
          // The anti-hallucination counters. This log line is the only
          // per-prompt-version regression signal there is, and a check nobody
          // can trace over time is a check nobody can tell has stopped working.
          // Counts only — never the matched text, which is the teacher's prose.
          figuresAsserted: result?.figuresAsserted ?? 0,
          figuresBare: result?.figuresBare ?? 0,
          citationsFound: result?.citationsFound ?? 0,
          citationsRemoved: result?.citationsRemoved ?? 0,
          selfCertRemoved: result?.selfCertRemoved ?? 0,
          groupingState: result?.groupingState || null,
          printCountProblems: result?.printCountProblems ?? 0,
          nmiAdded: result?.nmiAdded ?? 0,
          audienceFallbacks: result?.audienceFallbacks ?? 0,
        },
        timing: timing ? { ok: timing.ok, total: timing.total, target: timing.target } : null,
        completenessProblems: Array.isArray(completeness) ? completeness.length : 0,
      })
    );
  } catch {
    // Logging must never take down a generation.
  }
}

// ── Per-request model-call budget ──────────────────────────────────────────
//
// One /api/generate can fan out to four upstream calls: the draft, a timing
// re-ask, a reading-level re-ask, and an independent solve for the answer key.
// Each is bounded today, but the fan-out is invisible from the rate limiter's
// point of view: a limit of 15 requests a minute is really up to 60 billable
// calls a minute per client, and the global ceiling is multiplied the same way.
//
// This makes the fan-out explicit and enforces it. A stage that would exceed
// the budget is skipped rather than queued, because the correct behaviour when
// the budget is gone is to ship the draft we already have, not to fail the
// teacher's request. Skipped verification is reported in the response so the UI
// can say a check did not run instead of implying it passed.
export const MAX_MODEL_CALLS_PER_REQUEST =
  Number(process.env.MAX_MODEL_CALLS_PER_REQUEST) || 4;

export function createCallBudget(max = MAX_MODEL_CALLS_PER_REQUEST) {
  let used = 0;
  const skipped = [];
  return {
    // Returns true and consumes one call, or returns false and records why.
    take(stage) {
      if (used >= max) {
        if (!skipped.includes(stage)) skipped.push(stage);
        return false;
      }
      used += 1;
      return true;
    },
    get used() {
      return used;
    },
    get skipped() {
      return skipped.slice();
    },
    summary() {
      return { used, max, skipped: skipped.slice() };
    },
  };
}

// ── Upstream timeout ───────────────────────────────────────────────────────
//
// Nothing bounded how long a model call could take. A serverless function that
// hangs on an upstream stall holds its slot until the platform kills it, and on
// the way there it holds an open connection from the teacher's browser that
// shows a spinner with no end. Found while running the security suite: one
// hostile payload produced a request that never returned headers.
//
// Bounding it here means a stall degrades to a clear error the UI can show,
// rather than to an indefinite wait.
export const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS) || 45_000;

export class ModelTimeoutError extends Error {
  constructor(ms) {
    super(`Model call exceeded ${ms}ms`);
    this.name = "ModelTimeoutError";
  }
}

// Races a model call against the clock. The underlying request is abandoned
// rather than cancelled: the SDK owns the socket, and the point here is to stop
// waiting, not to guarantee the upstream stops working.
export function withTimeout(promise, ms = MODEL_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ModelTimeoutError(ms)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
