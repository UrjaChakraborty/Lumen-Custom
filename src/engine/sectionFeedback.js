// #119 Per-section "this is wrong" capture.
//
// The point of this control is not to apologise to the teacher. It is to build
// the two things the project needs and cannot buy: an eval set drawn from real
// failures, and an exemplar library. So a report stores the section, the inputs
// that produced it, and the prompt version, which is the minimum needed to
// reproduce the failure later. Without the prompt version a report is an anecdote.
//
// Storage is localStorage, like classes and materials. There is no account
// system and no database in this project, and inventing a collection endpoint
// would be a bigger decision than this control justifies. The shape is stable so
// it can be posted to a real sink later without changing any caller. Reports are
// exportable from the Method page so a teacher can hand them over deliberately
// rather than having them shipped off silently.

const KEY = "lumen-section-reports";
const MAX_REPORTS = 200;

export const REPORT_REASONS = [
  { id: "factual", label: "Factually wrong" },
  { id: "cultural", label: "Cultural connection is off" },
  { id: "level", label: "Wrong level for my students" },
  { id: "timing", label: "Timing is unrealistic" },
  { id: "generic", label: "Too generic to use" },
  { id: "other", label: "Something else" },
];

export function loadReports() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

// The teacher's own note is stored, but the class context is reduced to the
// fields that shape generation. Free text a teacher typed about their students
// is exactly what the PII screen exists to keep out of transmissible records, so
// it does not go in here either.
function safeInput(input) {
  return {
    outputType: input?.outputType || null,
    format: input?.format || null,
    subject: input?.subject || null,
    course: input?.course || null,
    grade: input?.grade || null,
    topic: input?.topic || null,
    periodLength: input?.periodLength || null,
    classSize: input?.classSize || null,
    readingLevel: input?.readingLevel || null,
    lessonStructure: input?.lessonStructure || null,
    lowTech: Boolean(input?.lowTech),
    learningNeeds: Array.isArray(input?.learningNeeds) ? input.learningNeeds : [],
    hasCulturalContext: Boolean(
      String(input?.studentInterests || "").trim() || String(input?.communityContext || "").trim()
    ),
  };
}

export function recordSectionReport({ output, input, section, reason, note }) {
  const report = {
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    // The version that produced it. This is the field that makes a report
    // useful six prompt edits from now.
    promptVersion: output?.promptVersion || "unknown",
    source: output?._source || "unknown",
    reason,
    note: String(note || "").slice(0, 1000),
    resourceTitle: output?.title || "",
    section: {
      label: section?.label || "",
      minutes: section?.minutes ?? null,
      audience: section?.audience || "both",
      body: section?.body,
      steps: section?.steps || [],
    },
    input: safeInput(input),
  };

  try {
    const next = [report, ...loadReports()].slice(0, MAX_REPORTS);
    localStorage.setItem(KEY, JSON.stringify(next));
    return report;
  } catch {
    // A full quota must not swallow the teacher's click without telling them.
    return null;
  }
}

// Used by the backup restore. The storage key is private to this module, so
// writing the merged list has to go through here rather than through a second
// hardcoded copy of the key.
export function replaceReports(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify((Array.isArray(list) ? list : []).slice(0, MAX_REPORTS)));
    return true;
  } catch {
    return false;
  }
}

export function clearReports() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

// Handed to the teacher as a file rather than uploaded. They decide if and when
// these leave their machine.
export function reportsToJson() {
  return JSON.stringify({ exportedAt: new Date().toISOString(), reports: loadReports() }, null, 2);
}
