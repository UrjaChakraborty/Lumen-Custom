// #99 Verify the numbers.
//
// An answer key is the highest-consequence text this product emits. A wrong
// cultural framing is visible to the teacher reading it; a wrong answer key is
// invisible until it has been marked against thirty students' work.
//
// Two mechanisms, in order of trust:
//
// 1. ARITHMETIC IS COMPUTED, not re-asked. Where the worked solution contains an
//    evaluable expression, it is evaluated here. The brief is explicit about
//    this: "for anything computational, verify with actual computation rather
//    than a second opinion." A model asked to check its own arithmetic will
//    frequently confirm it.
// 2. Anything not evaluable gets one independent solve, at temperature 0, given
//    ONLY the question. It never sees the proposed answer, because a model shown
//    an answer tends to agree with it. That is the whole reason the second call
//    is worth making.
//
// On mismatch nothing is silently corrected. Both values are surfaced and the
// entry is marked disputed, because picking a winner between two unverified
// numbers is how a wrong answer gets laundered into a confident one.

import { Type } from "@google/genai";
import { canonicalize, canonicalEqual } from "./_canonical.js";

// ── 1. Arithmetic evaluated in code ────────────────────────────────────────

// A deliberately small expression grammar. No identifiers, no calls, no member
// access, so there is nothing to escape into: the tokenizer rejects any
// character outside this set before parsing starts. This is a calculator, and
// it must not become an interpreter.
const TOKEN = /^\s*(\d+\.?\d*|[()+\-*/^%])/;

function tokenize(src) {
  const out = [];
  let rest = src;
  while (rest.trim()) {
    const m = TOKEN.exec(rest);
    if (!m) return null; // anything unexpected disqualifies the whole expression
    out.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  return out.length ? out : null;
}

// Precedence-climbing parser over the token list. Returns null on anything
// malformed rather than throwing, since a malformed expression here just means
// "not evaluable", not "error".
function parseExpr(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const eat = () => tokens[i++];

  function primary() {
    const t = eat();
    if (t === "(") {
      const v = addSub();
      if (eat() !== ")") return null;
      return v;
    }
    if (t === "-") {
      const v = primary();
      return v === null ? null : -v;
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function power() {
    const base = primary();
    if (base === null) return null;
    if (peek() === "^") {
      eat();
      const exp = power(); // right associative
      return exp === null ? null : base ** exp;
    }
    return base;
  }

  function mulDiv() {
    let v = power();
    if (v === null) return null;
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = eat();
      const r = power();
      if (r === null) return null;
      if ((op === "/" || op === "%") && r === 0) return null;
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }

  function addSub() {
    let v = mulDiv();
    if (v === null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = eat();
      const r = mulDiv();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const value = addSub();
  return i === tokens.length && Number.isFinite(value) ? value : null;
}

export function evaluateExpression(src) {
  const tokens = tokenize(String(src || "").replace(/[×x]/g, "*").replace(/÷/g, "/"));
  return tokens ? parseExpr(tokens) : null;
}

// Pulls "a + b = c" style claims out of a worked solution so each one can be
// checked. Only matches when both sides are present, because a lone expression
// asserts nothing to be wrong about.
// The left side is bounded to 80 characters. It used to be an unbounded lazy
// quantifier, which made this quadratic: on a string with no "=" the engine
// scanned from every digit to the end of the input, so cost grew with the
// square of the length. Measured at 40KB of "1+1+1...": 1156ms, and rising 4x
// per doubling. A worked solution's left-hand side is a short expression, so
// bounding it costs nothing real and makes the scan linear.
const EQUATION = /([0-9][0-9\s.()+\-*/^%×x÷]{0,80}?)\s*=\s*(-?\d+\.?\d*)/g;

// Hard ceiling on what is scanned at all. Worked solutions are short; anything
// past this is not a solution, and the cap keeps a pathological input from
// costing serverless CPU regardless of what the pattern does.
const MAX_SCAN = 20_000;

export function checkArithmetic(text) {
  const problems = [];
  let checked = 0;
  for (const m of String(text || "").slice(0, MAX_SCAN).matchAll(EQUATION)) {
    const [, lhs, rhs] = m;
    // A bare number on the left ("x = 5") is a statement, not a calculation.
    if (!/[+\-*/^%×x÷]/.test(lhs)) continue;
    const got = evaluateExpression(lhs);
    if (got === null) continue;
    checked++;
    const want = Number(rhs);
    // Tolerance covers legitimate rounding in a worked solution. Anything
    // outside it is an arithmetic error, not a presentation choice.
    if (Math.abs(got - want) > Math.max(0.01, Math.abs(got) * 0.001)) {
      problems.push({
        claim: m[0].trim(),
        stated: want,
        computed: Math.round(got * 10000) / 10000,
      });
    }
  }
  return { checked, problems };
}

// ── 2. Independent solve for anything not evaluable ────────────────────────

export const solveSchema = {
  type: Type.OBJECT,
  properties: {
    answers: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.INTEGER },
          answer: { type: Type.STRING },
          numeric: {
            type: Type.STRING,
            description:
              "Just the number, if the answer is a single numeric value. Empty otherwise.",
          },
          canonical: {
            type: Type.STRING,
            description:
              "Your answer in a normal form: a plain decimal (write 3/4 as 0.75), a percent as 25%, an equation with no spaces (y=-4x+10), a comma-separated list for multi-part answers (2,5), or one lowercase word for a categorical answer (positive, negative, zero, undefined). Empty string if it does not fit any of those.",
          },
          solvable: {
            type: Type.BOOLEAN,
            description: "False when the question has no single correct answer.",
          },
        },
        required: ["index", "answer", "numeric", "canonical", "solvable"],
        propertyOrdering: ["index", "answer", "numeric", "canonical", "solvable"],
      },
    },
  },
  required: ["answers"],
  propertyOrdering: ["answers"],
};

export const SOLVE_SYSTEM_PROMPT = `You are solving problems for a high school STEM class.

You are given questions ONLY. You are not given anyone's proposed answers, and
you must not ask for them. Solve each question from scratch.

Rules:
- Work each problem independently. Show no work, return only the answer.
- If a question has no single correct answer (an opinion, a reflection, an
  open-ended task, or anything depending on data you were not given), set
  solvable to false and leave the answer empty. Do not invent a defensible
  sounding answer for an open question.
- When the answer is a single number, put just that number in "numeric",
  with no units, no words, and no symbols.
- Return the index you were given for each question, unchanged.`;

// Only questions worth a second call: ones that look computational. Sending
// reflection prompts to a solver wastes tokens and produces noise to compare.
const NUMERIC_HINT = /\d/;
const OPEN_ENDED = /\b(reflect|discuss|explain why you|your opinion|do you think|how did you feel|describe your)\b/i;

export function selectVerifiable(answerKey) {
  return (Array.isArray(answerKey) ? answerKey : [])
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        NUMERIC_HINT.test(`${entry?.question || ""} ${entry?.answer || ""}`) &&
        !OPEN_ENDED.test(entry?.question || "")
    );
}

// The exit ticket's key was never verified. `selectVerifiable` was called on
// `answerKey` alone, so the one artifact a teacher marks in a hurry at the end
// of a period — often the only thing they grade that day — was the one with no
// arithmetic check on it.
//
// This zips the ticket's questions and key into the same entry shape and returns
// a flat list, so the whole thing rides the EXISTING solve call rather than
// buying a second one. MAX_MODEL_CALLS_PER_REQUEST is 4 and the draft, timing
// retry and readability retry already claim three; a fifth call would mean the
// verification silently stops happening on any draft that needed a retry.
//
// `origins` preserves where each entry came from so the results can be written
// back to the right block.
export function collectVerifiable(doc) {
  const combined = [];
  const origins = [];

  for (const entry of Array.isArray(doc?.answerKey) ? doc.answerKey : []) {
    combined.push(entry);
    origins.push("answerKey");
  }

  const ticket = doc?.exitTicket;
  const questions = Array.isArray(ticket?.questions) ? ticket.questions : [];
  const key = Array.isArray(ticket?.key) ? ticket.key : [];
  for (let i = 0; i < Math.min(questions.length, key.length); i += 1) {
    combined.push({ question: questions[i], answer: key[i], work: "" });
    origins.push("exitTicket");
  }

  return { combined, origins, selected: selectVerifiable(combined) };
}

// Writes a reconciled flat list back into the two blocks it came from, keeping
// index alignment. The answer key keeps its existing per-entry `disputed` shape
// (already rendered by DocBlocks); the exit ticket gets a parallel array, since
// its key is a plain string list with nowhere to hang a flag.
export function scatterReconciled(doc, reconciledList, origins) {
  const nextKey = [];
  const ticketDisputes = [];
  reconciledList.forEach((entry, i) => {
    if (origins[i] === "answerKey") {
      nextKey.push(entry);
    } else {
      ticketDisputes.push(
        entry?.disputed ? { index: ticketDisputes.length, note: entry.disputeNote || "" } : null
      );
    }
  });
  if (nextKey.length) doc.answerKey = nextKey;
  if (doc?.exitTicket && ticketDisputes.some(Boolean)) {
    doc.exitTicket.keyDisputes = ticketDisputes;
  }
  return doc;
}

// Free check, no model call: a key that does not line up with its questions is
// answering something that was never asked.
export function checkKeyAlignment(ticket) {
  const q = Array.isArray(ticket?.questions) ? ticket.questions.length : 0;
  const k = Array.isArray(ticket?.key) ? ticket.key.length : 0;
  if (!q && !k) return { state: "unchecked", reason: "no exit ticket" };
  if (q !== k) {
    return { state: "warn", questions: q, answers: k };
  }
  return { state: "pass", questions: q, answers: k };
}

// Compares the independent solve against what the draft claimed. Returns the
// answerKey with disputed entries marked, plus a summary for logging.
export function reconcile(answerKey, solved) {
  const byIndex = new Map((solved || []).map((s) => [Number(s.index), s]));
  let disputed = 0;
  let confirmed = 0;
  let canonicalChecked = 0;
  let selfContradictions = 0;

  const next = (Array.isArray(answerKey) ? answerKey : []).map((entry, i) => {
    // Arithmetic first: a computed contradiction outranks a second opinion.
    const arith = checkArithmetic(entry?.work);
    if (arith.problems.length) {
      disputed++;
      return {
        ...entry,
        disputed: true,
        disputeKind: "arithmetic",
        disputeNote: `The working does not add up: ${arith.problems[0].claim} evaluates to ${arith.problems[0].computed}.`,
      };
    }

    // The draft's own two statements must agree before anyone else is consulted.
    //
    // `canonical` is model output, and model output is not evidence here. So the
    // prose answer is canonicalised independently in code and compared to what
    // the model claimed its normal form was. A mismatch means the entry
    // contradicts itself inside one response, which is worth more than a second
    // opinion: it needs no solver, and it cannot be explained away as notation.
    const ownForm = canonicalize(entry?.answer);
    const claimed = String(entry?.canonical || "").trim();
    if (claimed && ownForm.kind) {
      const claimedForm = canonicalize(claimed);
      if (claimedForm.kind && claimedForm.form !== ownForm.form) {
        disputed++;
        selfContradictions++;
        return {
          ...entry,
          disputed: true,
          disputeKind: "self-contradiction",
          disputeNote: `The answer and its short form disagree: "${entry.answer}" against "${claimed}".`,
        };
      }
    }

    const s = byIndex.get(i);
    if (!s || s.solvable === false) return entry;

    // Canonical comparison first. This is what lets an equation, a fraction, a
    // multi-part answer or a categorical answer be checked at all — the old
    // numeric-only path silently skipped every one of them.
    const solvedText = s.canonical || s.numeric || s.answer;
    const agree = canonicalEqual(entry?.answer, solvedText);
    if (agree === true) {
      confirmed++;
      canonicalChecked++;
      return { ...entry, verified: true };
    }
    if (agree === false) {
      disputed++;
      canonicalChecked++;
      return {
        ...entry,
        disputed: true,
        disputeKind: "second-solve",
        disputeNote: `A second, independent solve got ${solvedText}. Check this before you mark it.`,
      };
    }

    // agree === null: the two are not expressed in comparable terms. Fall back
    // to the original numeric path rather than losing a check that used to work.
    const a = normalizeNumber(entry?.answer);
    const b = normalizeNumber(s.numeric || s.answer);
    if (a === null || b === null) return entry; // not comparable, so no claim made

    if (Math.abs(a - b) > Math.max(0.01, Math.abs(a) * 0.001)) {
      disputed++;
      return {
        ...entry,
        disputed: true,
        disputeKind: "second-solve",
        disputeNote: `A second, independent solve got ${s.numeric || s.answer}. Check this before you mark it.`,
      };
    }
    confirmed++;
    return { ...entry, verified: true };
  });

  return { answerKey: next, disputed, confirmed, canonicalChecked, selfContradictions };
}

// Pulls a single number out of an answer string. Returns null when the answer
// is not a single number, which means it is not something this can adjudicate.
function normalizeNumber(v) {
  const matches = String(v ?? "").match(/-?\d+\.?\d*/g);
  if (!matches || matches.length !== 1) return null;
  const n = Number(matches[0]);
  return Number.isFinite(n) ? n : null;
}
