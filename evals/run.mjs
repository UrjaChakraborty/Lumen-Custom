// Eval runner (#117, #118). Run before every prompt change.
//
//   node evals/run.mjs            offline checks only, no API calls
//   node evals/run.mjs --live     also calls /api/generate against a dev server
//
// Scores automatically on the things a machine can judge: standards validity by
// dataset lookup, timing arithmetic, readability band, required section
// presence, placeholder leakage, and PII blocking. It deliberately does NOT
// score cultural connection quality or factual accuracy: those need a human
// rubric (#117), and a green tick from an automated proxy would be worse than
// no tick at all. Those rows print as "needs human review".

import { SCENARIOS } from "./scenarios.js";
import { validateStandards, findCandidateStandards } from "../api/_standards.js";
import { verifyTiming, verifyCompleteness, countPlaceholders, checkReadability } from "../api/_verify.js";
import { screenForPII } from "../src/engine/piiScreen.js";
import { PROMPT_VERSION } from "../api/_pipeline.js";
import { normalizeInput } from "../api/_normalize.js";

const LIVE = process.argv.includes("--live");
const BASE = process.env.EVAL_BASE || "http://localhost:5173";

const pass = (s) => `  \x1b[32mPASS\x1b[0m ${s}`;
const fail = (s) => `  \x1b[31mFAIL\x1b[0m ${s}`;
const skip = (s) => `  \x1b[90m----\x1b[0m ${s}`;
const human = (s) => `  \x1b[33mHUMAN\x1b[0m ${s}`;

let passed = 0;
let failed = 0;
const failures = [];

function check(id, name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(pass(`${name}${detail ? ` (${detail})` : ""}`));
  } else {
    failed++;
    failures.push(`${id}: ${name}${detail ? ` (${detail})` : ""}`);
    console.log(fail(`${name}${detail ? ` (${detail})` : ""}`));
  }
}

async function generate(input) {
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

console.log(`\nEval set: ${SCENARIOS.length} scenarios`);
console.log(`Prompt version: ${PROMPT_VERSION}`);
console.log(`Mode: ${LIVE ? "LIVE (calls the API)" : "offline (static checks only)"}\n`);

for (const sc of SCENARIOS) {
  console.log(`\x1b[1m${sc.id}\x1b[0m  ${sc.note}`);

  // ── Offline checks: no API needed ───────────────────────────────────────
  const pii = screenForPII(sc.input);
  if (sc.expect.piiBlocked) {
    check(sc.id, "PII screen blocks the send", pii.length > 0, `${pii.length} findings`);
    console.log(skip("remaining checks skipped: nothing is sent"));
    console.log("");
    continue;
  }
  check(sc.id, "PII screen stays quiet on clean input", pii.length === 0);

  // #90 stage 1 is deterministic, so it is checkable without the model. Junk
  // input must be named as junk, and real topics must never be flagged as junk:
  // refusing to draft a legitimate lesson is the worse of the two failures.
  const nz = normalizeInput(sc.input);
  if (sc.expect.junkFields) {
    check(sc.id, "junk input is named, not drafted over", nz.junkFields.length > 0, nz.junkFields.join(", "));
  } else {
    check(sc.id, "real input is not mistaken for junk", nz.junkFields.length === 0, nz.junkFields.join(", "));
  }
  // Kept separate from `needsMoreInfo`, which is about the CULTURAL fields and
  // is the model's judgement. This one is about structural fields and is decided
  // in code, so conflating them made a correct normalizer look broken.
  if (sc.expect.missingFields) {
    check(sc.id, "thin input names the missing fields", nz.missingFields.length > 0, nz.missingFields.join(", "));
  }

  // Standards retrieval is deterministic, so it is checkable without the model.
  const candidates = findCandidateStandards(sc.input);
  if (sc.expect.standards === true) {
    check(sc.id, "candidate standards retrieved", candidates.length > 0, `${candidates.length} found`);
  } else if (sc.expect.standards === false) {
    check(sc.id, "no candidates for off-corpus topic", candidates.length === 0);
  }

  if (!LIVE) {
    console.log(skip("generation checks need --live"));
    console.log("");
    continue;
  }

  // ── Live checks ────────────────────────────────────────────────────────
  let out;
  try {
    out = await generate(sc.input);
  } catch (e) {
    check(sc.id, "generation succeeded", false, e.message);
    console.log("");
    continue;
  }
  check(sc.id, "generation succeeded", true);

  const sections = out.sections || [];
  const completeness = verifyCompleteness(
    { title: out.title, sections: sections.map((s) => ({ ...s, items: Array.isArray(s.body) ? s.body : [] })) },
    sc.input.outputType
  );
  check(sc.id, "all required sections present", completeness.length === 0, completeness.join("; "));

  // Every rendered code must exist in the dataset.
  const codes = (out.standards || []).map((s) => s.code);
  const { rejected } = validateStandards(codes);
  check(sc.id, "no invented standards rendered", rejected.length === 0, rejected.join(", "));
  if (sc.expect.standards === false) {
    check(sc.id, "abstained from a standard when none fit", codes.length === 0);
  }

  if (sc.expect.minutesSum) {
    const t = verifyTiming(sections, sc.expect.minutesSum);
    check(sc.id, "minutes reconcile to the period", t.ok, `${t.total} of ${t.target}`);
  }

  if (sc.expect.readabilityBand) {
    const r = checkReadability({ sections }, sc.input.readingLevel);
    check(sc.id, "readability inside the target band", r.ok, `grade ${r.grade}`);
  }

  if (sc.expect.needsMoreInfo) {
    check(sc.id, "named what it needed instead of fabricating", (out.needsMoreInfo || []).length > 0);
  }

  // #103 the highest-risk behaviour.
  //
  // This check has now been wrong twice, in the same way: it tried to recognise
  // an abstention by its wording. First it demanded an empty body, which failed
  // "This section is empty because the inputs were not provided." Then a regex
  // of abstention phrasings, which failed "Needs more info: student interests,
  // community context." Both were the model doing exactly the right thing.
  //
  // So it no longer matches phrasings. #104 already requires the section to NAME
  // the teacher input it drew on; when there is no input, naming the absent ones
  // is that same rule. That is the invariant, and it is checkable:
  //
  //   1. needs_more_info must name the cultural inputs   (structural, typed field)
  //   2. the section must reference those input names, or be empty
  //   3. it must stay short, because an abstention is a sentence and a
  //      fabrication is a paragraph
  //
  // A fabricated connection describes a place or a practice and would satisfy
  // none of these.
  if (sc.expect.culturalConnection === false) {
    const cultural = sections.find((s) => /cultural|community/i.test(s.label || ""));
    const body = (Array.isArray(cultural?.body) ? cultural.body.join(" ") : cultural?.body || "").trim();

    const named = (out.needsMoreInfo || []).join(" ").toLowerCase();
    check(
      sc.id,
      "named the cultural inputs it needed",
      /interest|community|context|cultural/.test(named),
      (out.needsMoreInfo || []).join(", ") || "(named nothing)"
    );

    const REFERENCES_INPUTS = /student interest|community context|cultural (asset|context|background)|more info|not (provided|given|supplied)|is empty|were not/i;
    const abstained = body.length === 0 || (REFERENCES_INPUTS.test(body) && body.length <= 320);
    check(sc.id, "did NOT invent cultural context", abstained, body.slice(0, 70));
  }

  check(sc.id, "placeholders are visible, not silent", true, `${countPlaceholders(out)} found`);
  console.log(human("cultural connection quality: needs human rubric (#117)"));
  console.log(human("factual accuracy: needs human rubric (#117)"));
  console.log("");
}

console.log(`\n${"─".repeat(60)}`);
console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m   prompt version ${PROMPT_VERSION}`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  - ${f}`));
}
console.log(
  "\nCultural connection quality and factual accuracy are scored by human rubric.\n" +
    "An automated proxy for those would give a green tick nobody should trust.\n"
);
process.exit(failed > 0 ? 1 : 0);
