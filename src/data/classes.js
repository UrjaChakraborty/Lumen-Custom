// My classes — a teacher's sections, saved once and reused all year.
//
// A teacher has 2 or 3 preps and teaches them from September to June. Making
// them retype subject, course, grade, reading level, community context and tech
// level for every single resource is the fastest way to guarantee they build
// exactly one resource and never come back. A class carries all of it.
//
// Stored in localStorage rather than a server: there is no account system, and
// this data is about the teacher's schedule, not about students. Nothing here
// should ever identify a student, which the setup copy states plainly.

const CLASSES_KEY = "lumen-classes";
const ACTIVE_KEY = "lumen-active-class";

// The fields a class carries into the builder. Everything here maps 1:1 onto a
// key in defaultInput (src/data/inputSchema.js) except `label` and `id`, which
// are only used to name the section in the picker.
export const CLASS_INPUT_KEYS = [
  "subject",
  "course",
  "grade",
  "readingLevel",
  "language",
  "lowTech",
  "resourceLevel",
  "learningNeeds",
  "communityContext",
  "studentInterests",
  "culturalAssets",
  "periodLength",
];

export function blankClass() {
  return {
    id: `cls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    label: "",
    subject: "",
    course: "",
    grade: "",
    readingLevel: "on-grade",
    language: "English",
    lowTech: false,
    resourceLevel: "medium",
    learningNeeds: [],
    communityContext: "",
    studentInterests: "",
    culturalAssets: "",
    periodLength: 50,
  };
}

// Shown on first run so the setup screen is not an empty form. These are
// examples of shape, not real classes: the teacher edits or deletes them.
export const EXAMPLE_CLASSES = [
  {
    label: "Period 2",
    course: "Algebra I",
    subject: "Mathematics",
    grade: "9",
    readingLevel: "mixed",
    resourceLevel: "medium",
    periodLength: 50,
  },
  {
    label: "Period 5",
    course: "AP Calculus AB",
    subject: "Mathematics",
    grade: "11-12",
    readingLevel: "above-grade",
    resourceLevel: "high",
    periodLength: 50,
  },
];

function safeParse(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function loadClasses() {
  try {
    const raw = localStorage.getItem(CLASSES_KEY);
    if (!raw) return [];
    // Merge onto a blank so a class saved by an older build still has every
    // field the current builder expects.
    return safeParse(raw, []).map((c) => ({ ...blankClass(), ...c }));
  } catch {
    return [];
  }
}

// Returns whether the write landed, like saveMaterials. It used to return
// nothing and swallow the failure, so hitting the storage quota was
// indistinguishable from saving successfully — the class stayed on screen for
// the session and was simply gone after a reload.
export function saveClasses(list) {
  try {
    localStorage.setItem(CLASSES_KEY, JSON.stringify(list));
    return true;
  } catch {
    // Private browsing or a full quota. The app keeps working for this
    // session; the classes just will not survive a reload. The caller says so.
    return false;
  }
}

export function loadActiveClassId() {
  try {
    return localStorage.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}

export function saveActiveClassId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
    return true;
  } catch {
    /* see saveClasses */
    return false;
  }
}

// "Period 2, Algebra I" — what the picker shows. Falls back through whatever
// the teacher actually filled in so a half-finished class is still findable.
export function classDisplayName(cls) {
  if (!cls) return "";
  const parts = [cls.label, cls.course].filter((s) => s && s.trim());
  if (parts.length) return parts.join(", ");
  return cls.subject?.trim() || "Untitled class";
}

export function classSubtitle(cls) {
  if (!cls) return "";
  const grade = cls.grade?.trim() ? `Grade ${cls.grade.trim()}` : "";
  const mins = cls.periodLength ? `${cls.periodLength} min` : "";
  return [grade, mins].filter(Boolean).join(" · ");
}

// A class is worth saving once it can be told apart from the others.
export function isClassUsable(cls) {
  return Boolean(cls && (cls.label?.trim() || cls.course?.trim() || cls.subject?.trim()));
}

// The only place class data crosses into the builder. Returns the subset of
// input keys the class actually fills, so callers can both apply the values and
// know which fields to mark as auto-filled.
export function classToInput(cls) {
  if (!cls) return {};
  const patch = {};
  for (const key of CLASS_INPUT_KEYS) {
    const v = cls[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    patch[key] = v;
  }
  return patch;
}
