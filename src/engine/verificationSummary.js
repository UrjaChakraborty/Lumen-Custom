// What the tool actually checked, turned into rows a teacher can read.
//
// Every generation measures reading level, reconciles the minutes, counts the
// unfilled placeholders, and independently re-solves any numeric answer key.
// None of that reached the screen. What sat in its place was a hardcoded
// five-line checklist that said the same thing whether the timing was perfect
// or twelve minutes over.
//
// The rule this module exists to enforce: THREE states, never two.
//
//   pass       we checked it and it is fine
//   warn       we checked it and it is not
//   unchecked  we did not check it, or the check is stale
//
// Collapsing "unchecked" into "pass" is the failure mode worth guarding
// against, because it is invisible and it is exactly the kind of false comfort
// this product should not sell. A teacher who sees "not checked" can decide;
// a teacher who sees a green tick that was never earned cannot.
//
// Pure and JSX-free so the rules can be unit tested without rendering anything.

// Placeholders and minutes are recomputed here rather than trusted from the
// server payload, because both survive a rewrite: /api/revise returns a new
// document, and a stale count would describe the draft the teacher just
// replaced. Everything model-dependent (reading level, math) cannot be
// recomputed client side and is reported as stale instead of guessed at.
const PLACEHOLDER = /\[insert current data:/gi;

function countPlaceholders(output) {
  try {
    return (JSON.stringify(output || {}).match(PLACEHOLDER) || []).length;
  } catch {
    return 0;
  }
}

function sumMinutes(sections) {
  return (Array.isArray(sections) ? sections : []).reduce(
    (n, s) => n + (Number(s?.minutes) > 0 ? Math.round(Number(s.minutes)) : 0),
    0
  );
}

const BAND_LABEL = {
  "below-grade": "below grade",
  "on-grade": "on grade",
  "above-grade": "above grade",
  mixed: "a mixed range",
};

// A revision returns a document with only the checks that survive a rewrite.
// Detecting that explicitly is better than inferring it from a missing field,
// because a missing field could also mean an older payload shape.
// Whether a MODEL-DEPENDENT check on this document is stale.
//
// This used to sniff `_label`/`_changed` and blanket-stale the reading level and
// the answer key on anything that had ever been rewritten. That was right when
// /api/revise returned two verification fields and nothing else; it is wrong now
// that a rewrite runs its own checks and stamps `verification.stage`.
//
// The consequence of the old behaviour was not cosmetic: a saved-and-reopened
// revised draft showed "Not re-checked since your rewrite" PERMANENTLY, with no
// way to re-run it, because the stamp lived on the version object rather than on
// the verification payload.
//
// A missing stamp still resolves to stale. Absence of evidence is "unchecked",
// never "pass" — that is the rule this whole module exists to hold.
function isStale(output) {
  const v = output?.verification;
  if (v?.stage) return false; // the route that produced this ran its own checks
  return Boolean(output?._label || output?._changed || output?._actionId || output?._directive);
}

/**
 * @returns {null | Array<{id, label, state, detail}>}
 *   null when the document carries no verification at all (the offline engine),
 *   so the caller can fall back rather than render an empty shell.
 */
export function verificationSummary(output, input) {
  const v = output?.verification;
  if (!v) return null;

  const rows = [];
  const skipped = v.budget?.skipped || [];
  const revised = isStale(output);

  // ── Timing. Recomputed, so it is always live. ────────────────────────────
  const target = Number(input?.periodLength) || Number(v.timing?.target) || 0;
  const total = sumMinutes(output?.sections);
  // The exit ticket runs after the last section, so it is time in the period the
  // section minutes never counted. A 50 minute plan plus a 5 minute ticket used
  // to report a clean pass and then run the teacher past the bell.
  const extra = Number(output?.exitTicket?.minutes) > 0 ? Math.round(Number(output.exitTicket.minutes)) : 0;
  if (total > 0 && target > 0) {
    const delta = total - target;
    const ok = Math.abs(delta) <= 2 && total + extra <= target + 2;
    rows.push({
      id: "timing",
      label: "Timing",
      state: ok ? "pass" : "warn",
      detail: ok
        ? extra
          ? `${total} min of lesson plus a ${extra} min exit ticket, inside a ${target} min period.`
          : `${total} min against a ${target} min period.`
        : delta > 0
        ? `${total} min against a ${target} min period. ${delta} minutes over.`
        : extra && total + extra > target + 2
        ? `${total} min of lesson plus a ${extra} min exit ticket is ${total + extra - target} minutes past the bell.`
        : `${total} min against a ${target} min period. ${-delta} minutes spare.`,
    });
  } else {
    rows.push({
      id: "timing",
      label: "Timing",
      state: "unchecked",
      detail: "This resource does not carry per-section minutes.",
    });
  }

  // ── What students actually receive. ──────────────────────────────────────
  // Placed high in the list on purpose: an empty student copy is the only
  // failure here that ends with a teacher handing out blank paper, and it used
  // to have no row at all.
  const sc = v.studentCopy;
  if (sc) {
    rows.push({
      id: "studentCopy",
      label: "Student copy",
      state: sc.state,
      detail:
        sc.state === "warn"
          ? sc.note
          : sc.state === "unchecked"
          ? sc.note || "Could not tell which sections students should see."
          : `${sc.visible} of ${sc.total} sections are on the student copy.`,
    });
  }

  const qr = v.questionsReach;
  if (qr && qr.state !== "unchecked") {
    rows.push({
      id: "questionsReach",
      label: "Questions on the handout",
      state: qr.state,
      detail:
        qr.state === "warn"
          ? `${qr.missing} of ${qr.checked} answer-key ${
              qr.missing === 1 ? "question does" : "questions do"
            } not appear on the student copy. Students would get a blank page for ${
              qr.missing === 1 ? "it" : "them"
            }.`
          : `All ${qr.checked} answer-key questions appear on the student copy.`,
    });
  }

  const se = v.safetyEarned;
  if (se && se.state !== "unchecked") {
    rows.push({
      id: "safety",
      label: "Safety notes",
      state: "pass",
      detail: `${se.notes} ${se.notes === 1 ? "note" : "notes"}, on a lesson that does involve hands-on materials.`,
    });
  } else if (se && se.note) {
    rows.push({ id: "safety", label: "Safety notes", state: "unchecked", detail: se.note });
  }

  // ── Reading level. Model-dependent, so a rewrite invalidates it. ─────────
  const r = v.readability;
  if (revised) {
    rows.push({
      id: "readability",
      label: "Reading level",
      state: "unchecked",
      detail: "Not re-checked since your rewrite. Redraft to measure it again.",
    });
  } else if (!r || r.grade == null) {
    rows.push({
      id: "readability",
      label: "Reading level",
      state: "unchecked",
      detail: "Too little student-facing text to measure.",
    });
  } else {
    const asked = BAND_LABEL[input?.readingLevel] || "on grade";
    const band = Array.isArray(r.band) ? ` (${r.band[0]} to ${r.band[1]})` : "";
    rows.push({
      id: "readability",
      label: "Reading level",
      state: r.ok ? "pass" : "warn",
      detail: r.ok
        ? `Grade ${r.grade}, inside the ${asked} band${band}.`
        : `Grade ${r.grade}. You asked for ${asked}${band}.`,
    });
  }

  // ── Blanks. Recomputed, always live. Placeholders are intentional, so
  //    having them is not a failure; leaving them unfilled at the copier is.
  const blanks = countPlaceholders(output);
  rows.push({
    id: "placeholders",
    label: "Blanks to fill",
    state: blanks > 0 ? "warn" : "pass",
    detail:
      blanks > 0
        ? `${blanks} ${blanks === 1 ? "placeholder" : "placeholders"} still to fill before you print.`
        : "No placeholders left in the text.",
  });

  // ── Answer key. Three genuinely different outcomes, and they must not be
  //    flattened: nothing to check, we did not check, and we checked.
  const math = v.math;
  const disputedInKey = (output?.answerKey || []).filter((a) => a?.disputed).length;
  if (revised) {
    rows.push({
      id: "math",
      label: "Answer key",
      state: "unchecked",
      detail: "Not re-checked since your rewrite. Check any numbers yourself.",
    });
  } else if (skipped.includes("verify-math")) {
    rows.push({
      id: "math",
      label: "Answer key",
      state: "unchecked",
      detail: "Verification was skipped on this draft. Check the numbers yourself.",
    });
  } else if (!output?.answerKey) {
    // The resource type never carries an answer key, so this is not a check
    // that failed to run — it does not apply. Saying "nothing to verify" would
    // imply we looked at a feedback note for arithmetic.
    rows.push({
      id: "math",
      label: "Answer key",
      state: "unchecked",
      detail: "This kind of resource does not have an answer key.",
    });
  } else if (!math || math.checked === 0) {
    rows.push({
      id: "math",
      label: "Answer key",
      state: "unchecked",
      detail: "No numeric answers in this resource, so there was nothing to verify.",
    });
  } else if (math.selfContradictions > 0) {
    // The draft disagreed with itself: its prose answer and its own short form
    // reduce to different values. No second opinion was needed to find this, and
    // it outranks a solver disagreement because it cannot be notation.
    const n = math.selfContradictions;
    rows.push({
      id: "math",
      label: "Answer key",
      state: "warn",
      detail: `${n} ${n === 1 ? "answer contradicts itself" : "answers contradict themselves"} — the written answer and its short form do not match. Both are shown in the key.`,
    });
  } else if (math.disputed > 0 || disputedInKey > 0) {
    const n = Math.max(math.disputed, disputedInKey);
    rows.push({
      id: "math",
      label: "Answer key",
      state: "warn",
      detail: `${n} ${n === 1 ? "answer disagrees" : "answers disagree"} with an independent solve. Both are shown in the key.`,
    });
  } else if (math.confirmed >= math.checked) {
    rows.push({
      id: "math",
      label: "Answer key",
      state: "pass",
      detail: `${math.confirmed} of ${math.checked} confirmed by solving them again independently.`,
    });
  } else {
    // Checked, not disputed, but not confirmed either. reconcile() reaches this
    // when the independent solver could not solve the question, or when the two
    // answers are not numerically comparable ("3 inches per week" against a
    // worked expression it could not evaluate) — see api/_math.js. Nothing was
    // verified, so this is the third state, not the first.
    //
    // It rendered as a green tick reading "0 of 1 confirmed", which is the exact
    // failure this module was written to prevent: a pass that was never earned.
    const unresolved = math.checked - math.confirmed;
    const n = math.checked;
    rows.push({
      id: "math",
      label: "Answer key",
      state: "unchecked",
      detail:
        math.confirmed === 0
          ? n === 1
            ? "The one numeric answer here could not be re-solved independently. Check it yourself."
            : `None of the ${n} numeric answers could be re-solved independently. Check them yourself.`
          : `${math.confirmed} of ${n} confirmed independently. The other ${
              unresolved === 1 ? "one could not be re-solved" : `${unresolved} could not be re-solved`
            } — check ${unresolved === 1 ? "it" : "them"} yourself.`,
    });
  }

  // ── Numbers and sources. Pure function of the document, so it stays live
  //    after a rewrite. `asserted` is a figure that states something about the
  //    real world with no source; `bare` is usually problem data, and warning on
  //    it would be the false positive that teaches teachers to ignore this panel.
  const fig = v.figures;
  const cite = v.citations;
  if (!fig) {
    rows.push({
      id: "sources",
      label: "Numbers and sources",
      state: "unchecked",
      detail: "This draft was not scanned for unsourced figures.",
    });
  } else if (fig.asserted?.length) {
    const n = fig.asserted.length;
    const sample = fig.asserted.slice(0, 2).map((a) => `"${a.figure}"`).join(", ");
    rows.push({
      id: "sources",
      label: "Numbers and sources",
      state: "warn",
      detail: `${n} ${n === 1 ? "figure states" : "figures state"} something about the real world with no source (${sample}). Check ${n === 1 ? "it" : "them"} or replace with a blank to fill.`,
    });
  } else if (cite?.removed) {
    rows.push({
      id: "sources",
      label: "Numbers and sources",
      state: "warn",
      detail: `${cite.removed} invented ${cite.removed === 1 ? "citation was" : "citations were"} removed. Lumen has no source library, so any citation it writes is made up.`,
    });
  } else if (fig.bare?.length) {
    const n = fig.bare.length;
    rows.push({
      id: "sources",
      label: "Numbers and sources",
      state: "unchecked",
      detail: `${n} ${n === 1 ? "number" : "numbers"} could not be traced to anything you typed. If ${n === 1 ? "it is" : "they are"} problem data that is fine.`,
    });
  } else {
    rows.push({
      id: "sources",
      label: "Numbers and sources",
      state: "pass",
      detail: "Every figure traces to a blank to fill, something you entered, or the lesson's own timing.",
    });
  }

  // ── Class-size arithmetic. Merges grouping and copy counts: both are the same
  //    question (does this plan add up against your actual class?) and two rows
  //    for one question is how a panel becomes noise.
  const gr = v.grouping;
  const pc = v.printCounts;
  const groupWarn = gr?.state === "warn";
  const printWarn = pc?.state === "warn";
  if (groupWarn || printWarn) {
    const parts = [];
    if (groupWarn) parts.push(gr.note);
    if (printWarn) {
      const p = pc.problems[0];
      parts.push(`The print list says ${p.stated} for a class of ${p.expected}.`);
    }
    rows.push({ id: "classsize", label: "Class-size arithmetic", state: "warn", detail: parts.join(" ") });
  } else if (gr?.state === "pass" || pc?.state === "pass") {
    const bits = [];
    if (gr?.state === "pass") bits.push(`${gr.groups} groups of ${gr.per}`);
    if (pc?.state === "pass") bits.push(`${pc.checked} copy ${pc.checked === 1 ? "count" : "counts"}`);
    rows.push({
      id: "classsize",
      label: "Class-size arithmetic",
      state: "pass",
      detail: `${bits.join(" and ")} reconcile against ${gr?.classSize || pc?.classSize} students.`,
    });
  } else {
    rows.push({
      id: "classsize",
      label: "Class-size arithmetic",
      state: "unchecked",
      detail: gr?.reason === "no class size given" || pc?.reason === "no class size given"
        ? "No class size given, so grouping and copy counts could not be checked."
        : "This resource has no grouping plan and no copy counts.",
    });
  }

  // ── Missing inputs. A gap the draft failed to name is an abstention failure:
  //    the model drafted confidently over an input it was told was absent.
  const added = v.needsMoreInfo?.added;
  if (Array.isArray(added) && added.length) {
    rows.push({
      id: "gaps",
      label: "Missing inputs",
      state: "warn",
      detail: `The draft did not flag ${added.length} missing ${added.length === 1 ? "input" : "inputs"} (${added.slice(0, 3).join(", ")}). ${added.length === 1 ? "It was" : "They were"} added for you.`,
    });
  }


  // ── Cultural fit. Never a verdict. This is the one thing the tool cannot
  //    check, and saying so every time is the point rather than an omission.
  rows.push({
    id: "cultural",
    label: "Cultural fit",
    state: "judgement",
    detail: "Only you can judge this. Read it against your actual students.",
  });

  return rows;
}

// One-line summary for a toolbar badge. Counts only real problems: an unchecked
// row is not a failure, and rendering it as one would push teachers to ignore
// the thing entirely.
export function countWarnings(rows) {
  return (rows || []).filter((r) => r.state === "warn").length;
}
