// Post-generation verification, in code rather than in the prompt.
//
// The principle from the brief: the model should assemble and phrase, not
// recall, and anything that can be wrong should be checked by something that
// cannot be talked out of it. A prompt saying "make the minutes add up" is a
// request. Adding the numbers is a check.
//
// Each function returns findings rather than throwing, so the handler can
// decide whether to re-ask the model, drop a field, or surface a warning to the
// teacher. Nothing here rewrites content: silently "fixing" a lesson plan hides
// the failure from the person who has to teach it.
import { resolveAudience } from "./_schema.js";


// Sections every resource type must actually contain before it renders. A
// missing section should trigger a retry, not render as an absence the teacher
// might not notice.
const REQUIRED_SECTIONS = {
  lesson: ["objective", "warm", "activity", "assessment"],
  activity: ["question", "task", "product"],
  assessment: ["question"],
  feedback: [],
};

const norm = (s) => String(s || "").toLowerCase();

// #101 Completeness. Checks that required fields exist and are non-empty, and
// that the expected sections are present by keyword rather than exact label, so
// a model that writes "Warm-up and hook" still satisfies "warm".
export function verifyCompleteness(data, outputType = "lesson") {
  const problems = [];
  if (!data || typeof data !== "object") return ["response was not an object"];

  if (!String(data.title || "").trim()) problems.push("title is empty");
  if (!Array.isArray(data.sections) || data.sections.length === 0) {
    problems.push("no sections were returned");
    return problems;
  }

  data.sections.forEach((s, i) => {
    if (!String(s?.label || "").trim()) problems.push(`section ${i + 1} has no label`);
    const hasBody = String(s?.body || "").trim().length > 0;
    const hasItems = Array.isArray(s?.items) && s.items.some((x) => String(x).trim());
    // #53/#56 A section whose content is the two-column procedure is full, not
    // empty. The drafting prompt tells the model to put those moves in steps[]
    // and NOT repeat them in body or items, so checking only body and items
    // reported every warm-up and main activity as an empty section.
    const hasSteps =
      Array.isArray(s?.steps) &&
      s.steps.some((t) => String(t?.teacher || "").trim() || String(t?.students || "").trim());
    // An intentionally empty cultural connection is allowed, because abstaining
    // is a valid result. Anything else empty is a gap.
    const isAbstained = /cultural|community/i.test(s?.label || "");
    if (!hasBody && !hasItems && !hasSteps && !isAbstained) {
      problems.push(`section "${s?.label || i + 1}" is empty`);
    }
  });

  const labels = data.sections.map((s) => norm(s.label)).join(" | ");
  for (const needle of REQUIRED_SECTIONS[outputType] || []) {
    if (!labels.includes(needle)) problems.push(`missing a section covering "${needle}"`);
  }
  return problems;
}

// #98 Timing. Minutes are integers per section; the sum is compared against the
// period length here. A model asked to "make it fit 50 minutes" will assert
// that it does. This adds it up.
// `extras` are timed things that are NOT sections — today just the exit ticket,
// which was excluded entirely, so a 50 minute period plus a 10 minute ticket
// reported a clean pass and then ran the teacher past the bell.
//
// The overrun is reported SEPARATELY rather than folded into `delta`, and that
// separation is the whole point: `delta` drives timingRetryInstruction, so
// folding the ticket in would make the model shrink the lesson to make room for
// the ticket. The lesson is not what is wrong. The teacher needs to see the real
// total and decide.
export function verifyTiming(sections, periodLength, extras = []) {
  const target = Number(periodLength) || 0;
  const timed = (Array.isArray(sections) ? sections : []).filter(
    (s) => Number.isFinite(Number(s?.minutes)) && Number(s.minutes) > 0
  );
  const extraMinutes = (Array.isArray(extras) ? extras : []).reduce(
    (n, e) => n + (Number(e?.minutes) > 0 ? Math.round(Number(e.minutes)) : 0),
    0
  );
  if (!target || timed.length === 0) {
    return {
      ok: true, total: 0, target, delta: 0, timedSections: 0, reason: "no timing data",
      overrun: { extraMinutes, grandTotal: extraMinutes, ok: true },
    };
  }
  const total = timed.reduce((n, s) => n + Math.round(Number(s.minutes)), 0);
  const delta = total - target;
  // A couple of minutes either way is normal lesson planning slack. Beyond
  // that the teacher is being handed a plan that does not fit the bell.
  const ok = Math.abs(delta) <= 2;
  const grandTotal = total + extraMinutes;
  return {
    ok, total, target, delta, timedSections: timed.length,
    overrun: {
      extraMinutes,
      grandTotal,
      extras: (Array.isArray(extras) ? extras : [])
        .filter((e) => Number(e?.minutes) > 0)
        .map((e) => ({ label: e.label || "extra", minutes: Math.round(Number(e.minutes)) })),
      ok: grandTotal <= target + 2,
    },
  };
}

// The arithmetic the prompt explicitly demands, finally checked.
//
// generate.js asks the model to "State the arithmetic (how many groups, of what
// size, and what to do with the remainder)" and then nothing looked at it. The
// fix is not a better prompt — it is making the arithmetic STRUCTURAL, the same
// move sections[].minutes already made by being an integer instead of prose.
// Once the counts are typed fields, code can add them up.
//
// Numbers are never rewritten. A disputed grouping is marked and shown, exactly
// like a disputed answer key, because a plan whose group counts were silently
// "corrected" is a plan the teacher cannot trust either.
export function verifyGrouping(grouping, classSize) {
  const size = Number(classSize) || 0;
  const formation = String(grouping?.formation || "").trim();
  if (!grouping || !formation) return { state: "unchecked", reason: "no grouping plan" };
  if (!size) return { state: "unchecked", reason: "no class size given" };

  const count = Number(grouping.groupCount);
  const per = Number(grouping.groupSize);
  const left = Number(grouping.leftover);
  if (![count, per, left].every(Number.isFinite) || count <= 0 || per <= 0 || left < 0) {
    return { state: "unchecked", reason: "the grouping plan has no stated counts" };
  }

  const accounted = count * per + left;
  if (accounted !== size) {
    return {
      state: "warn",
      note: `The grouping accounts for ${accounted} of ${size} students (${count} groups of ${per}, ${left} left over).`,
    };
  }
  if (left >= per) {
    return {
      state: "warn",
      note: `${left} students are left over but a full group is ${per}. Another group was possible.`,
    };
  }
  // The numbers can reconcile while the SENTENCE the teacher actually reads says
  // something else. That is the version that reaches the classroom.
  const saidCount = formation.match(/(\d+)\s+groups?\b/i);
  const saidSize = formation.match(/groups?\s+of\s+(\d+)/i);
  if (saidCount && Number(saidCount[1]) !== count) {
    return { state: "warn", note: `The plan says ${saidCount[1]} groups but the count is ${count}.` };
  }
  if (saidSize && Number(saidSize[1]) !== per) {
    return { state: "warn", note: `The plan says groups of ${saidSize[1]} but the size is ${per}.` };
  }
  return { state: "pass", groups: count, per, leftover: left, classSize: size };
}

// Copy counts, compared against the class the prompt told the model to size them
// for. A teacher who prints 20 handouts for 32 students finds out at the copier.
const COUNT_PATTERNS = [
  /(\d+)\s*(?:copies|copy|prints?|printouts?|handouts?|sheets?|packets?|cards?|sets?)\b/i,
  /\b(?:print|make|run)\s+(\d+)\b/i,
];

export function verifyPrintCounts(materials, classSize, grouping) {
  const size = Number(classSize) || 0;
  const list = Array.isArray(materials?.print) ? materials.print : [];
  if (!list.length) return { state: "unchecked", reason: "nothing to print", checked: 0, problems: [] };
  if (!size) return { state: "unchecked", reason: "no class size given", checked: 0, problems: [] };

  const groups = Number(grouping?.groupCount) || 0;
  const problems = [];
  let checked = 0;

  for (const item of list) {
    const text = String(item || "");
    let stated = null;
    for (const re of COUNT_PATTERNS) {
      const m = text.match(re);
      if (m) { stated = Number(m[1]); break; }
    }
    if (stated == null || !Number.isFinite(stated)) continue;
    checked += 1;

    const perGroupWording = /\bper (?:group|team|table|station|pair|partner)\b|\bone per\b/i.test(text);
    const okExact = stated === size;
    const okSpares = stated > size && stated <= size + 5;      // real teacher practice
    const okPerGroup = perGroupWording && groups > 0 && stated === groups;
    const okShared =
      perGroupWording &&
      [2, 3, 4, 5, 6].some((k) => stated === Math.ceil(size / k));

    if (!(okExact || okSpares || okPerGroup || okShared)) {
      problems.push({ item: text.slice(0, 120), stated, expected: size });
    }
  }

  // The prompt demanded counts and none came back. That is not a pass.
  if (checked === 0) {
    return { state: "unchecked", reason: "the print list has no copy counts", checked: 0, problems: [] };
  }
  return { state: problems.length ? "warn" : "pass", checked, problems, classSize: size };
}

// The model's own list of what it was missing, unioned with what the normalizer
// actually measured. `missingFields` and `junkFields` are computed facts, so
// adding them is grounding rather than overwriting — and a gap the model failed
// to name is the abstention failure worth surfacing, because it means the model
// drafted confidently over an input it was explicitly told was absent.
export function reconcileNeedsMoreInfo(modelList, normalized, hasCulturalInput) {
  const have = new Set(
    (Array.isArray(modelList) ? modelList : []).map((s) => String(s || "").trim().toLowerCase())
  );
  const list = (Array.isArray(modelList) ? modelList : []).map((s) => String(s || "").trim()).filter(Boolean);
  const added = [];

  const want = [
    ...(normalized?.missingFields || []),
    ...(normalized?.junkFields || []),
    ...(hasCulturalInput ? [] : ["student interests", "community context"]),
  ];
  for (const field of want) {
    const key = String(field || "").trim().toLowerCase();
    if (!key || have.has(key)) continue;
    have.add(key);
    list.push(field);
    added.push(field);
  }
  return { list, added };
}

// Builds the re-ask instruction for a failed timing check. Re-asking with the
// measured delta works better than repeating the original constraint, which the
// model already believes it satisfied.
export function timingRetryInstruction(check) {
  const dir = check.delta > 0 ? "over" : "under";
  return [
    `TIMING CORRECTION REQUIRED.`,
    `Your section minutes total ${check.total}, which is ${Math.abs(check.delta)} minutes ${dir} the ${check.target} minute period.`,
    `Rewrite the resource so the minutes sum to exactly ${check.target}.`,
    `Adjust the length of activities. Do not drop a required section to make the arithmetic work.`,
  ].join("\n");
}

// #96 Placeholder leakage. Placeholders are intentional and should render
// visibly, but counting them lets the UI tell the teacher how many blanks they
// need to fill before class.
export function countPlaceholders(data) {
  const json = JSON.stringify(data || {});
  return (json.match(/\[insert current data:/gi) || []).length;
}

// #100 Readability, measured rather than requested.
//
// Asking a model to "write at grade level" does not work: it has no way to
// check, and it will assert compliance. This runs Flesch-Kincaid grade level on
// the student-facing text, and the caller re-asks with the measured score when
// it lands outside the target band.
//
// Syllable counting is the approximate part of every readability formula. This
// uses the standard vowel-group heuristic, which is close enough for banding
// and is what most classroom readability tools use too.
function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return w.length ? 1 : 0;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

// Student-facing text only. Teacher notes are written for adults and would drag
// the score up, making an accessible handout look inaccessible.
function studentText(data) {
  const parts = [];
  for (const s of data?.sections || []) {
    // resolveAudience, not the raw field. Readability runs on the RAW draft,
    // before normalizeSections has written the resolved audience back, so a
    // section with no `audience` read as non-teacher here and was scored — then
    // resolved to "teacher" later and left off the handout entirely. The score
    // has to describe the paper students are actually given.
    if (resolveAudience(s) === "teacher") continue;
    if (typeof s.body === "string") parts.push(s.body);
    if (Array.isArray(s.items)) parts.push(...s.items.map(String));
    if (Array.isArray(s.body)) parts.push(...s.body.map(String));
    // Only the "students do" half of a step is student-facing. The teacher half
    // is a direction written for an adult and would drag the score up, which is
    // the same reason teacher-audience sections are skipped above. Excluding
    // steps entirely was scoring the lesson on everything EXCEPT the part
    // students actually read.
    for (const st of s.steps || []) {
      if (String(st?.students || "").trim()) parts.push(st.students);
    }
  }
  return parts.join(" ");
}

export function measureReadability(data) {
  const text = studentText(data);
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim().length > 4);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  // One long sentence is still measurable, and a single dense sentence is
  // exactly the case worth catching. Word count is the real floor.
  if (sentences.length < 1 || words.length < 20) {
    return { grade: null, sentences: sentences.length, words: words.length, reason: "too little text" };
  }
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  // Flesch-Kincaid grade level
  const grade =
    0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
  return {
    grade: Math.round(grade * 10) / 10,
    sentences: sentences.length,
    words: words.length,
    avgWordsPerSentence: Math.round((words.length / sentences.length) * 10) / 10,
  };
}

// The band a reading-level setting implies, as grade numbers.
const BANDS = {
  "below-grade": [4, 8],
  "on-grade": [8, 11],
  "above-grade": [10, 13],
  mixed: [5, 11],
};

export function checkReadability(data, readingLevel) {
  const m = measureReadability(data);
  if (m.grade == null) return { ok: true, ...m, band: null };
  const band = BANDS[readingLevel] || BANDS["on-grade"];
  const ok = m.grade >= band[0] && m.grade <= band[1];
  return { ok, ...m, band };
}

export function readabilityRetryInstruction(check) {
  // Nothing to correct when the text was too short to score.
  if (!check || check.grade == null || !check.band) return "";
  const dir = check.grade > check.band[1] ? "too difficult" : "too simple";
  return [
    `READING LEVEL CORRECTION REQUIRED.`,
    `The student-facing text measures grade ${check.grade} on Flesch-Kincaid, which is ${dir}.`,
    `Target band is grade ${check.band[0]} to ${check.band[1]}.`,
    check.grade > check.band[1]
      ? `Shorten sentences and replace multi-syllable words with plainer ones. Any technical term you keep must appear in the vocabulary block.`
      : `Add precision and detail. Do not pad with filler to raise the score.`,
  ].join("\n");
}

// A cheap sentence-length signal, kept for the completeness log. Not a substitute for a real formula on
// the full corpus, but enough to flag a draft that is far outside the band:
// average words per sentence, which is what actually moves grade level in
// classroom text.
export function measureSentenceLength(data) {
  const parts = [];
  for (const s of data?.sections || []) {
    if (typeof s.body === "string") parts.push(s.body);
    if (Array.isArray(s.items)) parts.push(...s.items.map(String));
    if (Array.isArray(s.body)) parts.push(...s.body.map(String));
  }
  const text = parts.join(" ");
  const sentences = text.split(/[.!?]+\s/).filter((x) => x.trim().length > 4);
  if (!sentences.length) return { avgWords: 0, sentences: 0 };
  const words = sentences.reduce((n, s) => n + s.trim().split(/\s+/).length, 0);
  return { avgWords: Math.round((words / sentences.length) * 10) / 10, sentences: sentences.length };
}

// ── What students actually receive ─────────────────────────────────────────
//
// Two ways a class ends up holding blank paper, both of which shipped.
//
// The first: `audience` fails closed to "teacher" when the model omits it, which
// is the right direction — the alternative puts the answer key on the handout —
// but a response omitting it on EVERY section produced an empty student copy and
// said nothing. Measured before this existed: "0 of 3 sections on the student
// copy", with no row, no warning, and a print button that worked.
//
// The second: a quiz whose questions live only in the answer key. There has
// always been a prompt rule about this and never a check, and the failure looks
// identical from the back of the room.
//
// Neither needs a model call. Both are properties of the document.

export function verifyStudentCopy(sections, fallbacks = 0) {
  const list = Array.isArray(sections) ? sections : [];
  if (!list.length) return { state: "unchecked", reason: "no sections" };
  const visible = list.filter((s) => s?.audience !== "teacher");
  if (!visible.length) {
    return {
      state: "warn",
      visible: 0,
      total: list.length,
      note:
        "Nothing in this draft is marked for students, so the student copy is empty. Printing it now would hand out blank paper.",
    };
  }
  // Not empty, but tagged by inference rather than by the model. Worth saying,
  // because the teacher is the one who knows which sections students should see.
  if (fallbacks > 0) {
    return {
      state: "unchecked",
      visible: visible.length,
      total: list.length,
      fallbacks,
      note: `${visible.length} of ${list.length} sections are on the student copy, but ${
        fallbacks === 1 ? "one section" : `${fallbacks} sections`
      } had to be sorted by structure rather than being labelled. Check the student copy before printing.`,
    };
  }
  return { state: "pass", visible: visible.length, total: list.length };
}

// Normalised comparison so a key that MIRRORS a question still counts as finding
// it. The key restates; it does not copy, and requiring equality would report
// every well-formed quiz as broken.
function normQ(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlap(a, b) {
  const A = new Set(normQ(a).split(" ").filter((w) => w.length > 3));
  const B = new Set(normQ(b).split(" ").filter((w) => w.length > 3));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit += 1;
  return hit / Math.min(A.size, B.size);
}

export function verifyQuestionsReachStudents(doc) {
  const key = Array.isArray(doc?.answerKey) ? doc.answerKey : [];
  if (!key.length) return { state: "unchecked", reason: "no answer key" };

  // Everything a student can actually read: section items and prose, plus the
  // exit ticket, which is its own printable.
  const studentText = [];
  for (const s of Array.isArray(doc?.sections) ? doc.sections : []) {
    if (s?.audience === "teacher") continue;
    if (Array.isArray(s?.body)) studentText.push(...s.body);
    else if (typeof s?.body === "string") studentText.push(s.body);
    if (Array.isArray(s?.items)) studentText.push(...s.items);
  }
  studentText.push(...(doc?.exitTicket?.questions || []));

  const readable = studentText.map(String).filter((t) => t.trim());
  if (!readable.length) {
    return { state: "warn", missing: key.length, checked: key.length,
      note: "The answer key has questions but the student copy has none of them." };
  }

  const missing = key.filter((entry) => {
    const q = entry?.question;
    if (!String(q || "").trim()) return false;
    return !readable.some((t) => overlap(q, t) >= 0.6);
  });

  if (!missing.length) return { state: "pass", checked: key.length, missing: 0 };
  return {
    state: "warn",
    checked: key.length,
    missing: missing.length,
    examples: missing.slice(0, 2).map((m) => String(m.question).slice(0, 80)),
  };
}

// ── Safety notes that were not earned ──────────────────────────────────────
//
// The prompt says "Do not invent hazards for a paper-and-pencil lesson" and
// nothing checked it. This does, loosely: if nothing in the materials or the
// procedure suggests equipment, chemicals or heat, a list of hazards is
// suspicious.
//
// Reported as UNCHECKED with a note, never a warn, and nothing is ever removed.
// The asymmetry is the same one the figure scanner runs on: a false positive on a
// real chemistry lab would teach a teacher to ignore safety warnings, which is a
// far worse outcome than missing an invented one.
const LAB_SIGNALS =
  /\b(beaker|flask|burner|bunsen|hot ?plate|goggles|gloves|apron|acid|base|chemical|reagent|solution|scalpel|dissect|specimen|centrifuge|microscope|slide|pipette|test tube|graduated cylinder|balance|scale|voltage|circuit|battery|wire|solder|saw|drill|blade|glass|flame|heat|boil|combust|spill|fume|ventilat)/i;

export function verifySafetyEarned(doc) {
  const safety = Array.isArray(doc?.safety) ? doc.safety.filter((x) => String(x || "").trim()) : [];
  if (!safety.length) return { state: "unchecked", reason: "no safety notes" };

  const haystack = [
    ...(doc?.materials?.gather || []),
    ...(doc?.materials?.setup || []),
    ...(Array.isArray(doc?.sections) ? doc.sections : []).flatMap((s) => [
      typeof s?.body === "string" ? s.body : "",
      ...(Array.isArray(s?.body) ? s.body : []),
      ...(Array.isArray(s?.items) ? s.items : []),
      ...(Array.isArray(s?.steps) ? s.steps.map((t) => `${t?.teacher || ""} ${t?.students || ""}`) : []),
    ]),
  ].join(" ");

  if (LAB_SIGNALS.test(haystack)) {
    return { state: "pass", notes: safety.length, reason: "hands-on materials are present" };
  }
  return {
    state: "unchecked",
    notes: safety.length,
    note: `${safety.length} safety ${safety.length === 1 ? "note" : "notes"} on a lesson with no equipment or lab work in it. Worth a look before you copy them onto a handout.`,
  };
}
