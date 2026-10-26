// Client-side screening for student-identifying information (#113).
//
// The footer warning is not a control. It tells a teacher what not to do and
// then does nothing when they do it. This runs before anything is sent, so the
// text never leaves the browser if it looks like it names a student.
//
// Deliberately tuned to catch the realistic cases and stay quiet otherwise: a
// screen that fires on ordinary lesson prose gets dismissed reflexively, which
// is worse than no screen. Every hit names what it matched so the teacher can
// judge it rather than being told "invalid input".

const PATTERNS = [
  {
    id: "student-id",
    label: "what looks like a student ID number",
    // CPS student IDs are 8 digits. Bare long digit runs are the classic leak.
    re: /\b\d{8,10}\b/g,
  },
  {
    id: "email",
    label: "an email address",
    // Quantifiers are bounded to RFC 5321 limits (local part 64, domain 253)
    // rather than left open. Unbounded, `[\w.%+-]+` consumes long runs of word
    // characters and separators looking for an "@", fails, and backtracks from
    // every position: 20KB of "1+1+1..." cost 283ms on this pattern alone. The
    // bounds make it linear and reject nothing a real address would use.
    re: /\b[\w.%+-]{1,64}@[\w.-]{1,253}\.[a-z]{2,24}\b/gi,
  },
  {
    id: "phone",
    label: "a phone number",
    re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  },
  {
    id: "ssn",
    label: "what looks like a social security number",
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    id: "dob",
    label: "a date of birth",
    re: /\b(?:dob|date of birth|born on)\b[:\s]*[\d/.-]{6,10}/gi,
  },
  {
    id: "iep-named",
    label: "a named student alongside an IEP or 504 reference",
    // The specific combination that matters: a capitalised first name sitting
    // next to a protected-status word.
    re: /\b[A-Z][a-z]{2,}\b(?=[^.]{0,40}\b(?:IEP|504|ELL|MLL|diagnos\w+|medicat\w+)\b)/g,
  },
  {
    id: "named-grade",
    label: "a named student alongside a grade or score",
    re: /\b[A-Z][a-z]{2,}\b(?=[^.]{0,30}\b(?:scored|got a|failed|failing|is at|reads at)\b)/g,
  },
];

// Fields a teacher types prose into. Structured pickers cannot carry PII.
//
// `directive` is the rewrite instruction ("Ask for a change") and the per-section
// redo note. It was missing, and it is the single most likely place for a name to
// appear, because the teacher is thinking about one student at the moment they
// type it: "make the warm-up easier for Marcus, who has an IEP". Both of those
// paths sent that text straight to Gemini while the Method page promised the
// opposite. Screening now covers every route that can reach the model.
export const SCREENED_FIELDS = [
  "studentInterests",
  "communityContext",
  "culturalAssets",
  "topic",
  "lastClass",
  "workSummary",
  "directive",
];

const FIELD_LABELS = {
  studentInterests: "Student interests",
  communityContext: "Community context",
  culturalAssets: "Cultural & linguistic assets",
  topic: "Topic",
  lastClass: "What students did last class",
  workSummary: "Student work summary",
  directive: "Your rewrite instruction",
};

// Longest text any pattern is run against.
//
// Several patterns use optional groups and lookaheads whose cost grows with the
// square of the input: 40KB of "1+1+1..." took 1389ms and rose 4x per doubling.
// This screen runs in the browser on every keystroke-ish check, so a teacher
// pasting a long document would lock up their own tab.
//
// Crucially this does NOT silently skip the overflow. Text past the cap is
// reported as unscanned, so the caller can refuse to send rather than treating
// "we did not look" as "we found nothing". Failing closed is the whole point of
// this screen.
const MAX_SCAN = 20_000;

// Returns [] when clean. Each finding names the field, what was matched, and
// the matched text, so the teacher can see exactly what tripped it.
export function screenForPII(input) {
  const findings = [];
  for (const field of SCREENED_FIELDS) {
    const full = String(input?.[field] || "");
    if (!full.trim()) continue;
    const value = full.slice(0, MAX_SCAN);
    if (full.length > MAX_SCAN) {
      findings.push({
        field,
        fieldLabel: FIELD_LABELS[field] || field,
        id: "unscanned",
        label: `text too long to screen (${full.length.toLocaleString()} characters). Shorten it so Lumen can check it before sending.`,
        samples: [],
      });
    }
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      const hits = value.match(p.re);
      if (hits && hits.length) {
        findings.push({
          field,
          fieldLabel: FIELD_LABELS[field] || field,
          id: p.id,
          label: p.label,
          samples: [...new Set(hits)].slice(0, 3),
        });
      }
    }
  }
  return findings;
}

export function describeFindings(findings) {
  if (!findings.length) return "";
  const parts = findings.map((f) => `${f.fieldLabel} contains ${f.label}`);
  return [...new Set(parts)].join(". ") + ".";
}
