// #90 stage 1: normalize inputs before anything else runs.
//
// The pipeline is: normalize -> retrieve standards -> draft -> verify. This is
// the first stage, and it exists because everything downstream is only as good
// as the fields it is given. A teacher types "bio", "Alg 1", "9th", "10-11th
// grade" and, on a bad day, "sadfsd". Those went straight into the prompt and
// into standards retrieval, where "bio" matched no subject and the lesson was
// drafted against no standard for no stated reason.
//
// This runs in CODE, not as a model call. Canonicalizing a course name is a
// lookup, and spending a network round trip and a token budget on a lookup would
// make every generation slower and less predictable to no benefit. The stage
// boundary is what matters, not that every stage talks to a model.
//
// It never overwrites what the teacher typed for display. It adds canonical
// fields alongside, so retrieval and prompting use the clean value while the
// document still says what the teacher called their own course.

const CANON_SUBJECTS = {
  science: ["science", "sci", "general science"],
  biology: ["biology", "bio", "life science", "living environment"],
  chemistry: ["chemistry", "chem"],
  physics: ["physics", "phys"],
  "environmental science": ["environmental science", "env sci", "apes", "environmental"],
  mathematics: ["mathematics", "math", "maths"],
  "computer science": ["computer science", "cs", "comp sci", "programming"],
  engineering: ["engineering", "eng", "stem engineering"],
};

const CANON_COURSES = {
  "Algebra I": ["algebra i", "algebra 1", "alg 1", "alg i", "algebra one"],
  "Algebra II": ["algebra ii", "algebra 2", "alg 2", "alg ii"],
  Geometry: ["geometry", "geo"],
  Precalculus: ["precalculus", "pre-calculus", "pre calc", "precalc"],
  "AP Calculus AB": ["ap calculus ab", "ap calc ab", "calc ab", "calculus ab"],
  "AP Calculus BC": ["ap calculus bc", "ap calc bc", "calc bc", "calculus bc"],
  Calculus: ["calculus", "calc"],
  Statistics: ["statistics", "stats", "ap statistics", "ap stats"],
  Biology: ["biology", "bio", "ap biology", "ap bio"],
  Chemistry: ["chemistry", "chem", "ap chemistry", "ap chem"],
  Physics: ["physics", "phys", "ap physics"],
  "Environmental Science": ["environmental science", "apes", "ap environmental science", "env sci"],
};

const norm = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");

function canonicalize(value, table) {
  const v = norm(value);
  if (!v) return null;
  for (const [canon, aliases] of Object.entries(table)) {
    if (aliases.includes(v)) return canon;
  }
  // Fall back to a containment match so "AP Biology - period 3" still resolves.
  for (const [canon, aliases] of Object.entries(table)) {
    if (aliases.some((a) => a.length > 3 && v.includes(a))) return canon;
  }
  return null;
}

// Grades arrive as "9", "9th", "grade 10", "10-11", "11 & 12", "freshman".
// Returns { min, max, label } so a band can be reasoned about rather than
// string-matched.
const NAMED_GRADES = { freshman: 9, sophomore: 10, junior: 11, senior: 12 };

export function normalizeGrade(raw) {
  const v = norm(raw);
  if (!v) return null;
  for (const [name, n] of Object.entries(NAMED_GRADES)) {
    if (v.includes(name)) return { min: n, max: n, label: String(n) };
  }
  const nums = (v.match(/\d{1,2}/g) || [])
    .map(Number)
    .filter((n) => n >= 6 && n <= 12);
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max, label: min === max ? String(min) : `${min}-${max}` };
}

// #106 Junk detection. "asdfgh" in the topic field should produce an abstention
// with the field named, not a confident lesson about nothing. Deliberately
// conservative: it must never fire on a real topic, because refusing to draft a
// legitimate lesson is a worse failure than drafting a weak one.
const VOWELS = /[aeiouy]/i;
const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

// A word typed by dragging a finger along one row is the shape almost all
// keyboard mash takes. On its own that would catch real words ("flask", "salad"),
// so it is paired with a vowel-density test: English words of this length carry
// more vowels than a mash does. "alfalfa" survives at 3 vowels in 7; "sadfsd"
// does not at 1 in 6.
function isRowMash(letters) {
  if (letters.length < 6) return false;
  const onOneRow = ROWS.some((row) => [...letters].every((c) => row.includes(c)));
  if (!onOneRow) return false;
  const vowels = (letters.match(/[aeiou]/g) || []).length;
  return vowels / letters.length < 0.4;
}

export function looksLikeJunk(raw) {
  const v = String(raw || "").trim();
  if (!v) return false;
  if (v.length < 3) return false;
  const words = v.split(/\s+/);
  // Multi-word input is essentially never keyboard mash.
  if (words.length > 2) return false;
  return words.every((w) => {
    const letters = w.replace(/[^a-z]/gi, "").toLowerCase();
    if (letters.length < 4) return false;
    // No vowel at all, or a run of 5+ consonants: not a word in this context.
    if (!VOWELS.test(letters)) return true;
    if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(letters)) return true;
    if (isRowMash(letters)) return true;
    // Adjacent keyboard runs: asdf, qwer, zxcv, hjkl.
    return /(asdf|sdfg|dfgh|qwer|wert|erty|zxcv|xcvb|hjkl|uiop)/i.test(letters);
  });
}

export function normalizeInput(input) {
  const subject = canonicalize(input.subject, CANON_SUBJECTS);
  const course = canonicalize(input.course, CANON_COURSES);
  const grade = normalizeGrade(input.grade);

  // Named so the drafting prompt can ask for them by name rather than producing
  // a lesson that quietly assumes them.
  const missing = [];
  if (!String(input.topic || "").trim()) missing.push("topic");
  if (!subject && !course) missing.push("subject or course");
  if (!grade) missing.push("grade level");
  if (!input.periodLength) missing.push("period length");

  const junk = [];
  for (const field of ["subject", "course", "topic"]) {
    if (looksLikeJunk(input[field])) junk.push(field);
  }

  return {
    ...input,
    // Canonical values for retrieval and prompting. The originals are untouched.
    canonicalSubject: subject,
    canonicalCourse: course,
    gradeBand: grade,
    // A course implies its subject when the teacher only filled one in.
    subjectForRetrieval: subject || (course ? canonicalize(course, CANON_SUBJECTS) : null),
    missingFields: missing,
    junkFields: junk,
  };
}
