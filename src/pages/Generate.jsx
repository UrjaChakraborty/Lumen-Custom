import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useToast, copyToClipboard, download, Term } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import PlanningSheet from "../components/PlanningSheet.jsx";
import DocBlocks, { TimingTable, StepTable, PrepStrip } from "../components/DocBlocks.jsx";
import StubCombobox from "../components/StubCombobox.jsx";
import { withSectionIds } from "../engine/sectionIds.js";
import {
  fieldMeta,
  readingLevels,
  resourceLevels,
  learningNeedOptions,
  outputTypes,
  defaultInput,
} from "../data/inputSchema.js";
import { scenarios } from "../data/scenarios.js";
import { classToInput } from "../data/classes.js";
import {
  screenForPII,
  screenLongTextForPII,
  describeFindings,
} from "../engine/piiScreen.js";
import { PdfReadError, readLessonPlanPdf } from "../engine/readLessonPlanPdf.js";
import {
  makeMaterial,
  newMaterialId,
  upsertMaterial,
  mostRecentForClass,
  lastClassSummary,
} from "../data/materials.js";
import { revisionActions } from "../data/promptLibrary.js";
import {
  runReview,
  generateLesson,
  generateActivity,
  generateAssessment,
  generateFeedback,
} from "../engine/mockAI.js";
import { toMarkdown, toPlainText, toWordHtml } from "../engine/exportDoc.js";
import { generateResource, localDraft } from "../engine/generateResource.js";
import { reviseResource } from "../engine/reviseResource.js";
import { regenerateSection } from "../engine/regenerateSection.js";
import { ApiError } from "../engine/apiError.js";
import { recordSectionReport, REPORT_REASONS } from "../engine/sectionFeedback.js";
import ex from "../styles/Explore.module.css";

// The builder has two flows that share a Results screen:
//   • template → review → results   (Path A: pick a pre-built template)
//   • target → environment → output → results   (Path B: build from scratch)
// A "fork" screen chooses between them.
const PROGRESS = { fork: 0, sheet: 50, results: 100 };

// No sparkle or wand anywhere. Each move gets an icon that describes the move.
const REVISION_ICONS = {
  scaffold: "access",
  subplan: "clipboard",
  exitticket: "check",
  shorten: "refresh",
  handout: "printer",
  spanish: "language",
};

// Each rewrite is a full-document Gemini call, so cap how many a single draft can
// run. Counted per generated draft (a new draft starts the allowance over) and
// tracked separately from `versions` — undoing a revision must not hand back a
// rewrite that was already spent.
const MAX_REVISIONS = 10;
const MAX_UPLOAD_BYTES = 200 * 1024;
const UPLOAD_SECTION_CHARS = 7_000;

function uploadedPlanSections(text) {
  const sections = [];
  for (let start = 0, part = 1; start < text.length; part += 1) {
    let end = Math.min(start + UPLOAD_SECTION_CHARS, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start) end = boundary;
    }
    sections.push({
      label: `Uploaded lesson plan · Part ${part}`,
      body: text.slice(start, end),
    });
    start = end;
  }
  return sections;
}

const assessmentFormats = [
  { value: "quiz", label: "Quiz" },
  { value: "exit", label: "Exit Ticket" },
  { value: "rubric", label: "Project Rubric" },
  { value: "multimodal", label: "Multimodal" },
];
const feedbackFormats = [
  { value: "strengths", label: "Strengths-Based" },
  { value: "growth", label: "Growth-Oriented" },
  { value: "reflection", label: "Reflection Prompts" },
  { value: "family", label: "Family-Friendly" },
];

const SUBJECT_OPTIONS = [
  "Science",
  "Mathematics",
  "Computer Science",
  "Engineering",
  "Physics",
  "Chemistry",
  "Biology",
  "Environmental Science",
];
const COURSE_OPTIONS = [
  "Algebra I",
  "Algebra II",
  "Geometry",
  "AP Calculus AB",
  "AP Calculus BC",
  "Biology",
  "Chemistry",
  "Physics",
  "Environmental Science",
  "AP Computer Science A",
  "Intro to Engineering",
];
const GRADE_OPTIONS = ["9", "10", "11", "12", "9-10", "10-11", "11-12"];

const supportOptions = [
  { key: "neurodiverseSupport", label: "Neurodiverse supports" },
  { key: "lowTech", label: "Low-tech / offline" },
];

// Review-screen text fields, grouped to mirror the custom builder's chronology.
const TARGET_TEXT = [
  { key: "subject", label: fieldMeta.subject.label, placeholder: fieldMeta.subject.placeholder },
  { key: "course", label: fieldMeta.course.label, placeholder: fieldMeta.course.placeholder },
  { key: "grade", label: fieldMeta.grade.label, placeholder: fieldMeta.grade.placeholder },
  { key: "topic", label: fieldMeta.topic.label, placeholder: fieldMeta.topic.placeholder },
];
const ENV_TEXT = [
  {
    key: "studentInterests",
    label: fieldMeta.studentInterests.label,
    placeholder: fieldMeta.studentInterests.placeholder,
    textarea: true,
  },
  {
    key: "communityContext",
    label: fieldMeta.communityContext.label,
    placeholder: fieldMeta.communityContext.placeholder,
    textarea: true,
  },
  {
    key: "culturalAssets",
    label: fieldMeta.culturalAssets.label,
    placeholder: fieldMeta.culturalAssets.placeholder,
    textarea: true,
  },
  { key: "language", label: "Language support", placeholder: "e.g. English, English + Spanish" },
];

function Choice({ selected, onClick, children }) {
  return (
    <motion.button
      type="button"
      className={`${ex.choice} ${selected ? ex.choiceSelected : ""}`}
      onClick={onClick}
      aria-pressed={selected}
      whileTap={{ scale: 0.93, transition: { type: "spring", stiffness: 500, damping: 22 } }}
      whileHover={{ scale: 1.02, transition: { duration: 0.15 } }}
    >
      <AnimatePresence initial={false}>
        {selected && (
          <motion.span
            className={ex.choiceCheck}
            aria-hidden="true"
            style={{ minWidth: 0, overflow: "hidden", display: "inline-flex" }}
            initial={{ opacity: 0, scale: 0.3, width: 0, x: -4 }}
            animate={{ opacity: 1, scale: 1, width: "1em", x: 0 }}
            exit={{ opacity: 0, scale: 0.3, width: 0, x: -4 }}
            transition={{ type: "spring", stiffness: 520, damping: 28 }}
          >
            {/* Drawn, not the ✓ character: the icon set is SVG throughout so a
                glyph cannot render differently per platform or be announced. */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 13 4 4L19 7" />
            </svg>
          </motion.span>
        )}
      </AnimatePresence>
      {children}
    </motion.button>
  );
}

// A row on the Review screen: uppercase label (+ "Auto" badge when the template
// filled it) beside its inline-editable control.
function ReviewRow({ label, auto, children }) {
  return (
    <div className={ex.reviewRow}>
      <div className={ex.reviewRowLabel}>
        {label}
        {auto && <span className={ex.autoBadge}>from template</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

// Single-select chip group (reading level, resource level, output type, format).
function ChipGroup({ options, value, onSelect, prefill }) {
  return (
    <div className={ex.reviewChips}>
      {options.map((o) => {
        const sel = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            className={`${ex.reviewChip}${sel ? ` ${ex.reviewChipSelected}` : ""}${
              sel && prefill ? ` ${ex.reviewChipPrefill}` : ""
            }`}
            aria-pressed={sel}
            onClick={() => onSelect(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// A section is dropped when a typed block below now carries the same content.
// The blocks are the better version (real UDL checkpoint ids, IEP-shaped
// accommodations), so the prose section is the one that goes. Only drops when
// the block actually has content, so a thin draft still shows what it has.
const SUPERSEDED = [
  [/^accessibility/i, (o) => o.accessibilitySupports?.length > 0],
  [/^differentiation/i, (o) => {
    const d = o.differentiation;
    return Boolean(d && (d.below?.length || d.on?.length || d.above?.length || d.accommodations?.length));
  }],
];

function supersededSection(label, output) {
  return SUPERSEDED.some(([re, hasBlock]) => re.test(String(label || "").trim()) && hasBlock(output));
}

// #83 What changed between two versions, at section granularity. Compared by
// label rather than index, so a rewrite that inserts a section does not report
// every section after it as changed. Section-level is the right grain here: a
// word-level diff of regenerated prose marks nearly every line and tells the
// teacher nothing.
function diffSections(before, after) {
  const norm = (s) => (Array.isArray(s?.body) ? s.body.join("\n") : String(s?.body || "")).trim();
  const steps = (s) =>
    (s?.steps || []).map((t) => `${t.teacher}|${t.students}`).join("\n");
  const prev = new Map((before?.sections || []).map((s) => [s.label, norm(s) + steps(s)]));
  const next = new Map((after?.sections || []).map((s) => [s.label, norm(s) + steps(s)]));

  const added = [...next.keys()].filter((k) => !prev.has(k));
  const removed = [...prev.keys()].filter((k) => !next.has(k));
  const edited = [...next.keys()].filter((k) => prev.has(k) && prev.get(k) !== next.get(k));
  return { added, removed, edited };
}

// One line summarising a diff, for the version pill's tooltip and the rail.
function describeDiff(d) {
  if (!d) return "The first draft";
  const bits = [];
  if (d.added.length) bits.push(`added ${d.added.join(", ")}`);
  if (d.removed.length) bits.push(`removed ${d.removed.join(", ")}`);
  if (d.edited.length) bits.push(`rewrote ${d.edited.join(", ")}`);
  if (!bits.length) return "No section changed";
  // Sentence case, and the list reads as prose rather than a stat line.
  return bits.join("; ").replace(/^./, (c) => c.toUpperCase());
}

// #119 The report control. Asks for a reason and an optional note, because a
// bare "this is wrong" cannot be turned into an eval case or an exemplar. The
// reasons are the failure modes this product actually has, not a generic scale.
function ReportForm({ section, onCancel, onSubmit }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className={ex.reportForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (reason) onSubmit(section, reason, note);
      }}
    >
      <p className={ex.reportTitle}>What is wrong with this section?</p>
      <div className={ex.reportReasons}>
        {REPORT_REASONS.map((r) => (
          <label key={r.id} className={ex.reportReason}>
            <input
              type="radio"
              name={`reason-${section.id}`}
              value={r.id}
              checked={reason === r.id}
              onChange={() => setReason(r.id)}
            />
            <span>{r.label}</span>
          </label>
        ))}
      </div>
      <label className={ex.reportNoteLabel} htmlFor={`note-${section.id}`}>
        Anything else? Optional.
      </label>
      <textarea
        id={`note-${section.id}`}
        className={ex.reportNote}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="What would have been right?"
      />
      <p className={ex.reportPrivacy}>
        Saved on this device with the section and the prompt version. Your class
        notes are not included. Export or clear these from the Method page.
      </p>
      <div className={ex.editActions}>
        <button type="submit" className={ex.btnPrimarySm} disabled={!reason}>
          Send report
        </button>
        <button type="button" className={ex.btnGhostSm} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// #8 The real first page of a card's lesson, generated once and cached. The
// offline engine is deterministic and synchronous, so this is genuinely the
// document the card produces rather than a representative sample of one.
const previewCache = new Map();

function previewOf(scenario) {
  if (previewCache.has(scenario.id)) return previewCache.get(scenario.id);
  let doc = null;
  try {
    const inp = scenario.input || {};
    doc =
      inp.outputType === "activity"
        ? generateActivity(inp)
        : inp.outputType === "assessment"
        ? generateAssessment(inp, inp.format || "quiz")
        : inp.outputType === "feedback"
        ? generateFeedback(inp, inp.format || "strengths")
        : generateLesson(inp);
  } catch {
    // A preview is decoration. It must never stop the card rendering.
    doc = null;
  }
  previewCache.set(scenario.id, doc);
  return doc;
}

// #44 The headings a given resource type will come back with, in order. These
// mirror the section guides in api/generate.js. They are shown while drafting so
// the wait shows the shape of the document rather than gray bars.
//
// Minutes are proportional to the period, which is why they are computed rather
// than hardcoded: a 90 minute block should not show the 50 minute split.
const SECTION_PLANS = {
  lesson: [
    ["Learning objective", 0.06],
    ["Cultural and community connection", 0.08],
    ["Warm-up and hook", 0.16],
    ["Main activity", 0.5],
    ["Assessment and check for understanding", 0.2],
    ["Teacher reflection (optional)", 0],
  ],
  activity: [
    ["Driving question", 0.08],
    ["Student roles", 0.1],
    ["Step by step task", 0.52],
    ["Public product", 0.2],
    ["Multiple ways to participate", 0.1],
  ],
  assessment: [["Overview", 0], ["Questions", 0], ["Answer key", 0]],
  feedback: [["Strengths", 0], ["Growth step", 0]],
};

function expectedSections(input) {
  const lessonPlans = {
    minimal: [
      ["Brainstorm ideas", 0],
      ["Discussion questions", 0],
      ["Standards connections", 0],
    ],
    collaborative: [
      ["Lesson outline", 0],
      ["Activity ideas", 0],
      ["Differentiation suggestions", 0],
      ["Assessment ideas", 0],
      ["Standards connections", 0],
    ],
    full: SECTION_PLANS.lesson,
  };
  const plan =
    input.outputType === "lesson"
      ? lessonPlans[input.assistanceLevel] || lessonPlans.full
      : SECTION_PLANS[input.outputType] || SECTION_PLANS.lesson;
  const period = Number(input.periodLength) || 50;
  return plan.map(([label, share]) => ({
    label,
    minutes: share ? Math.max(1, Math.round((period * share) / 5) * 5) : 0,
  }));
}

function draftingLabel(input) {
  const resource = labelFor(input.outputType) || "resource";
  return {
    minimal: `Brainstorming ${resource.toLowerCase()} ideas with AI…`,
    collaborative: `Building your ${resource.toLowerCase()} with AI…`,
    full: `Creating a full ${resource.toLowerCase()} draft with AI…`,
  }[input.assistanceLevel] || `Creating a full ${resource.toLowerCase()} draft with AI…`;
}

function assistanceLevelLabel(level) {
  return {
    minimal: "AI assistance: Minimal",
    collaborative: "AI assistance: Collaborative",
    full: "AI assistance: Full Draft",
  }[level] || null;
}

function withAssistanceLevel(output, input) {
  return { ...output, assistanceLevel: input.assistanceLevel || "full" };
}

function labelFor(t) {
  return (
    { lesson: "Lesson Plan", activity: "Activity", assessment: "Assessment", feedback: "Feedback" }[
      t
    ] || ""
  );
}

function fileName(output, ext) {
  const base = (output.title || "output")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${base || "lumen-output"}.${ext}`;
}

// Which list items are things a student answers, rather than instructions to
// read. Deliberately conservative: a false positive puts ruled lines under a
// direction ("Work with your partner"), which looks broken on a handout.
function isQuestion(label, text) {
  const t = String(text || "");
  if (/\?\s*$/.test(t.trim())) return true;
  return /\b(question|quiz|practice|problem|exit ticket|check for understanding)\b/i.test(
    String(label || "")
  );
}

// Rough room to answer, from what the question asks for. Explaining needs more
// room than naming, and anything asking for a graph or a table needs the most.
function answerLines(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(graph|plot|sketch|draw|diagram|table)\b/.test(t)) return 6;
  if (/\b(explain|justify|describe|compare|why|how|show your work|reasoning)\b/.test(t)) return 4;
  if (t.length > 140) return 3;
  return 2;
}

export default function Generate({
  input,
  setInput,
  activeClass = null,
  classes = [],
  go: _goRoute = () => {},
  materials = [],
  setMaterials = () => true,
  openMaterial = null,
  onConsumeOpenMaterial = () => {},
}) {
  const toast = useToast();
  const [flow, setFlow] = useState(null); // "template" | "custom" | null (fork)
  const [screen, setScreen] = useState("fork");
  const [prefilled, setPrefilled] = useState(() => new Set());
  const [fromProgress, setFromProgress] = useState(0);
  const [progressWidth, setProgressWidth] = useState(0);
  const [exitDir, setExitDir] = useState(0);
  const exitTimerRef = useRef(null);

  // Version history: each revision REPLACES the whole document, so we keep every
  // version and let the teacher step back and forth. `output` is the version on
  // screen. versionIndex === -1 means nothing generated yet.
  const [versions, setVersions] = useState([]);
  const [versionIndex, setVersionIndex] = useState(-1);
  const output = versionIndex >= 0 ? versions[versionIndex] ?? null : null;

  // Which saved material this draft corresponds to, so re-saving updates the
  // same record instead of piling up copies.
  // #68 Teacher copy vs student copy. Sections carry an audience, so the
  // student view is a filter rather than a second generation.
  const [audience, setAudience] = useState("teacher");
  // #113 Blocks the send when the input looks like it names a student. The
  // teacher sees what matched and decides; nothing is sent until they clear it.
  const [piiFindings, setPiiFindings] = useState([]);
  const [materialId, setMaterialId] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const [loading, setLoading] = useState(false);
  const [revising, setRevising] = useState(false);
  const [review, setReview] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [format, setFormat] = useState("quiz");
  const [genId, setGenId] = useState(0);
  const [customPrompt, setCustomPrompt] = useState("");
  const [navHeight, setNavHeight] = useState(56);
  // Mobile-only disclosure for the quick-edit chips (see .aiChipsToggle).
  const [quickEditsOpen, setQuickEditsOpen] = useState(false);
  // Per-section controls (#81 redo, #82 edit, #119 report). Keyed by section id
  // rather than index so a redo that changes section order cannot leave an open
  // editor pointed at different text than the teacher opened.
  const [openSectionMenu, setOpenSectionMenu] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [redoingSection, setRedoingSection] = useState(null);
  const [reportingSection, setReportingSection] = useState(null);
  // #77 Reading view, #78 page count.
  const [readingView, setReadingView] = useState(false);
  // #79 The revision drawer is closed at rest so the document is never covered.
  const [rewriteOpen, setRewriteOpen] = useState(false);
  // Which artifact the next print produces. A teacher prints different things at
  // different moments: the plan for themselves, the handout for students, the
  // exit ticket as slips, the key to mark against. These are already separate
  // typed fields; only the print scope was missing.
  const [printScope, setPrintScope] = useState("full");
  // A failed generation the teacher can act on, rather than a silently weaker
  // document. Holds the classified ApiError; null when there is nothing wrong.
  const [genError, setGenError] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [uploadingPlan, setUploadingPlan] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const uploadInputRef = useRef(null);

  // Whether switching to Student copy would show an empty document. Computed from
  // the sections rather than read from the server payload, so it stays true after
  // an edit that changes an audience tag.
  const studentCopyEmpty =
    Boolean(output?.sections?.length) &&
    output.sections.every((s) => s?.audience === "teacher");
  const docBodyRef = useRef(null);
  // #85/#86 The export menu, and #87 the assign menu. Both are popovers rather
  // than more buttons in a row that was already too long on a laptop.
  const [exportOpen, setExportOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  // WHERE this draft is filed: which class, which unit.
  //
  // This used to be re-derived on every save from `activeClass` and `input.unit`,
  // which meant the filing on the record was never actually authoritative:
  //
  //   * opening a Biology lesson while Period 2 was the active class silently
  //     re-filed it to Period 2 — a teacher opening a lesson to READ it moved it
  //   * refiling from My materials was reverted by the next autosave, because
  //     Refile writes the record's `unit` and the autosave read `input.unit`
  //   * even "Assign to class" in this toolbar was undone the same way, one
  //     autosave later
  //
  // So filing is state now, seeded from the material when one is opened and from
  // the builder context when a draft is new. One source of truth, and re-saving
  // preserves it instead of overwriting it.
  const [filing, setFiling] = useState({ classId: null, unit: "" });
  const [revisionsUsed, setRevisionsUsed] = useState(0);
  const revisionsLeft = Math.max(0, MAX_REVISIONS - revisionsUsed);
  const revisionsExhausted = revisionsLeft === 0;

  const resetOutput = () => {
    setVersions([]);
    setVersionIndex(-1);
    setRevisionsUsed(0);
  };

  // Measure the sticky site nav so the document's own sticky toolbar docks just
  // below it instead of hiding behind it.
  useEffect(() => {
    const measure = () => {
      const nav = document.querySelector("nav");
      if (nav) setNavHeight(nav.getBoundingClientRect().height);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Dock the "being revised…" status just under the sticky stack (site nav + the
  // document toolbar). On a phone that stack is tall and the AI toolbar eats the
  // lower half, so clamp the offset to whatever gap is actually left — the status
  // has to stay on screen for the whole rewrite.
  const [badgeTop, setBadgeTop] = useState(96);
  useEffect(() => {
    if (!revising) return;
    const measure = () => {
      const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
      const navH = rect("nav")?.height ?? navHeight;
      const barH = rect(`.${ex.docToolbar}`)?.height ?? 0;
      const aiTop = rect(`.${ex.aiToolbar}`)?.top ?? window.innerHeight;
      const preferred = navH + barH + 12;
      const ceiling = Math.max(navH + 12, aiTop - 56);
      setBadgeTop(Math.round(Math.min(preferred, ceiling)));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [revising, navHeight]);

  // Escape closes the revision drawer and the mobile quick-edits panel. Bound
  // whenever EITHER is open: gating it on quickEditsOpen alone meant the drawer
  // could be opened on desktop and Escape did nothing, because the listener was
  // never attached.
  useEffect(() => {
    if (!quickEditsOpen && !rewriteOpen) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setQuickEditsOpen(false);
      setRewriteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickEditsOpen, rewriteOpen]);

  // Escape closes the toolbar popovers, and a click anywhere outside dismisses
  // them. Without the outside click they stay open behind the document, which
  // reads as a rendering bug rather than an open menu.
  useEffect(() => {
    if (!exportOpen && !assignOpen) return;
    const close = () => {
      setExportOpen(false);
      setAssignOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && close();
    const onDown = (e) => {
      if (!e.target.closest(`.${ex.menuWrap}`)) close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [exportOpen, assignOpen]);

  const targetProgress = PROGRESS[screen] ?? 0;
  const showFormat = input.outputType === "assessment" || input.outputType === "feedback";
  const formats = input.outputType === "assessment" ? assessmentFormats : feedbackFormats;

  const set = (k, v) => setInput((p) => ({ ...p, [k]: v }));
  // On the Review screen, editing a prefilled field clears its "auto-filled"
  // highlight — the teacher has taken ownership of that value.
  const clearPrefill = (k) =>
    setPrefilled((p) => {
      if (!p.has(k)) return p;
      const n = new Set(p);
      n.delete(k);
      return n;
    });
  const setField = (k, v) => {
    set(k, v);
    clearPrefill(k);
  };
  const toggleNeed = (n) => {
    setInput((p) => ({
      ...p,
      learningNeeds: p.learningNeeds.includes(n)
        ? p.learningNeeds.filter((x) => x !== n)
        : [...p.learningNeeds, n],
    }));
    clearPrefill("learningNeeds");
  };
  const setOutputType = (v) => {
    setField("outputType", v);
    if (v === "assessment") setFormat("quiz");
    if (v === "feedback") setFormat("strengths");
  };

  const contextLabels = useMemo(() => {
    return [labelFor(input.outputType), input.subject, input.grade, input.topic].filter(Boolean);
  }, [input.outputType, input.subject, input.grade, input.topic]);

  const canGenerate = Boolean(input.topic?.trim() || input.subject?.trim());
  const canLeaveTarget = Boolean(input.subject?.trim() || input.topic?.trim());


  useEffect(() => {
    setProgressWidth(fromProgress);
    const id = requestAnimationFrame(() => setProgressWidth(targetProgress));
    return () => cancelAnimationFrame(id);
  }, [fromProgress, targetProgress, screen]);

  useEffect(() => () => clearTimeout(exitTimerRef.current), []);

  // Stepping between wizard screens plays a 220ms exit before the next screen
  // mounts, so the outgoing content is not yanked away mid-read.
  //
  // Two cases must not pay that cost:
  //
  //   `immediate` — opening a saved draft. The teacher is arriving from My
  //   materials, so there is no wizard screen on display to animate out. The
  //   timer was 220ms of blank builder between the click and the document, and
  //   it read as the app being slow to open a file.
  //
  //   reduced motion — the exit animation is suppressed (globally in CSS and by
  //   framer-motion), so the wait buys nothing and is dead time by definition.
  function go(next, direction, { immediate = false } = {}) {
    const settle = () => {
      setFromProgress(PROGRESS[screen] ?? 0);
      setScreen(next);
      setExitDir(0);
    };
    clearTimeout(exitTimerRef.current);

    const skip =
      immediate ||
      (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

    if (skip) {
      settle();
      // `smooth` on an instant switch scrolls the NEW screen, which reads as a
      // second, unrelated movement right after the first.
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    setExitDir(direction);
    exitTimerRef.current = setTimeout(() => {
      settle();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 220);
  }


  // Every reset path re-seeds from the active class. Without this, picking a
  // class then starting a draft would clear the class right back out.
  // Everything a fresh sheet inherits from the active class. All three reset
  // paths (template, blank sheet, start over) seed from this, so anything not
  // in here gets wiped by them — which is exactly how the class prefill was
  // silently lost once before. The last-lesson carry-forward therefore lives
  // here rather than only in an effect.
  const classPatch = () => {
    const patch = classToInput(activeClass);
    if (!activeClass) return patch;
    const summary = lastClassSummary(mostRecentForClass(materials, activeClass.id, materialId));
    if (summary) patch.lastClass = summary;
    return patch;
  };

  const chooseTemplate = (s) => {
    // The template wins where the two overlap: the teacher chose it deliberately.
    const seed = { ...classPatch(), ...s.input };
    setInput({ ...defaultInput, ...seed });
    setPrefilled(new Set(Object.keys(seed)));
    setFlow("template");
    resetOutput();
    setReview(null);
    setReviewOpen(false);
    if (s.input.outputType === "assessment") setFormat("quiz");
    else if (s.input.outputType === "feedback") setFormat("strengths");
    else setFormat("quiz");
    go("sheet", -1);
    toast(`Loaded ${s.title || s.label}`);
  };

  const startCustom = () => {
    const seed = classPatch();
    setInput({ ...defaultInput, ...seed });
    setPrefilled(new Set(Object.keys(seed)));
    setFlow("custom");
    setFormat("quiz");
    resetOutput();
    setReview(null);
    setReviewOpen(false);
    go("sheet", -1);
  };

  const uploadLessonPlan = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const isPdf = /\.pdf$/i.test(file.name);
    if (!/\.(txt|md|markdown|pdf)$/i.test(file.name)) {
      toast("Choose a plain-text, Markdown, or PDF lesson plan.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast("That file is too large. Upload a plan no larger than 200 KB.");
      return;
    }

    setUploadingPlan(true);
    setUploadProgress(isPdf ? "Reading PDF…" : "Reading plan…");
    try {
      const sourceText = isPdf
        ? await readLessonPlanPdf(file, setUploadProgress)
        : await file.text();
      const text = sourceText
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
        .trim();
      if (!text) {
        toast("That file is empty. Choose a lesson plan with text.");
        return;
      }

      const title =
        file.name
          .replace(/\.(txt|md|markdown|pdf)$/i, "")
          .replace(/[\u0000-\u001F\u007F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
          .trim() || "Uploaded lesson plan";
      const findings = screenLongTextForPII("uploadedLesson", `${title}\n${text}`);
      if (findings.length) {
        toast(`Not uploaded. ${describeFindings(findings)}`, { duration: 7000 });
        return;
      }

      const sections = uploadedPlanSections(text);
      if (!sections.length) {
        toast("No lesson-plan text was found in that file.");
        return;
      }

      const seed = { ...classPatch(), outputType: "lesson" };
      const nextInput = { ...defaultInput, ...seed };
      setInput(nextInput);
      setPrefilled(new Set(Object.keys(seed)));
      setFlow("custom");
      setMaterialId(null);
      setSavedAt(null);
      setFiling({ classId: activeClass?.id || null, unit: nextInput.unit || "" });
      setVersions([
        withSectionIds(
          withAssistanceLevel(
            {
              kind: "lesson",
              title: title.slice(0, 300),
              meta: ["Uploaded lesson plan"],
              sections,
              userUploaded: true,
              _source: "upload",
            },
            nextInput
          )
        ),
      ]);
      setVersionIndex(0);
      setRevisionsUsed(0);
      setReview(null);
      setReviewOpen(false);
      setGenError(null);
      setPiiFindings([]);
      setCustomPrompt("");
      setAudience("teacher");
      setRewriteOpen(false);
      setGenId((n) => n + 1);
      go("results", -1);
      toast("Lesson plan uploaded. Open “Ask for a change” to choose a refinement.");
    } catch (err) {
      console.error("Could not read uploaded lesson plan:", err);
      toast(
        err instanceof PdfReadError
          ? err.message
          : isPdf
          ? "Could not read this PDF. It may be damaged, password-protected, or use unsupported encryption."
          : "Could not read that file. Try a UTF-8 plain-text or Markdown file."
      );
    } finally {
      setUploadingPlan(false);
      setUploadProgress("");
    }
  };

  const backToFork = () => {
    setFlow(null);
    go("fork", 1);
  };

  const run = async () => {
    // Screen before anything leaves the browser, not after.
    const found = screenForPII(input);
    if (found.length) {
      setPiiFindings(found);
      toast("Check the highlighted fields before drafting.");
      return;
    }
    setPiiFindings([]);
    // A fresh draft files under the class being planned for and the unit typed on
    // the sheet. From here on the record owns its filing; see the note on
    // `filing`.
    setFiling({ classId: activeClass?.id || null, unit: input.unit || "" });
    setMaterialId(null);
    setLoading(true);
    setReview(null);
    setReviewOpen(false);
    resetOutput();
    go("results", -1);
    setGenError(null);
    const fmt = showFormat ? format : undefined;
    try {
      const out = await generateResource(input, { format: fmt });
      setVersions([withSectionIds(withAssistanceLevel(out, input))]);
      setVersionIndex(0);
      setGenId((n) => n + 1);
    } catch (err) {
      // Recoverable failures are shown, not papered over. Handing a teacher a
      // thinner local draft when waiting a minute would have produced the real
      // one is a decision they should get to make.
      setGenError(err instanceof ApiError ? err : null);
      if (!(err instanceof ApiError)) throw err;
    } finally {
      setLoading(false);
    }
  };

  // "Use a local draft instead" from the error panel: an explicit choice rather
  // than a substitution made on the teacher's behalf.
  const useLocalDraft = async () => {
    setGenError(null);
    setLoading(true);
    try {
      const out = await localDraft(input, { format: showFormat ? format : undefined });
      setVersions([withSectionIds(withAssistanceLevel(out, input))]);
      setVersionIndex(0);
      setGenId((n) => n + 1);
      toast("Using a local draft. The AI service was not called.");
    } finally {
      setLoading(false);
    }
  };

  // A revision REWRITES the whole document and pushes a new version. `directive`
  // is the plain-language instruction sent to Gemini; `actionId` maps to the
  // local fallback rewrite when the live route is unavailable.
  const revise = async (directive, actionId) => {
    const text = String(directive || "").trim();
    if (!output || revising || !text) return;
    // The directive is free text a teacher types while thinking about one
    // student, which is exactly when a name gets typed. This path skipped the
    // screen entirely and sent it to Gemini. The server refuses it too now; this
    // is here so the teacher is told what is wrong instead of seeing a failure.
    const piiInDirective = screenForPII({ directive: text });
    if (piiInDirective.length) {
      toast(`Not sent. ${describeFindings(piiInDirective)}`, { duration: 7000 });
      return;
    }
    if (revisionsExhausted) {
      toast(`You've used all ${MAX_REVISIONS} rewrites for this draft.`);
      return;
    }
    setRevising(true);
    setReviewOpen(false);
    setReview(null);
    const fmt = showFormat ? format : undefined;
    let revised;
    try {
      revised = await reviseResource(output, input, text, { format: fmt, actionId });
    } catch (err) {
      // The draft on screen is untouched, so a failed rewrite costs the teacher
      // nothing except the attempt. Say what happened and leave them where they
      // were rather than replacing good work with a weaker local rewrite.
      setRevising(false);
      toast(err instanceof ApiError ? err.message : "That rewrite did not go through. Try again.");
      return;
    }
    // #83 Name the version after the change that produced it, and record which
    // sections actually moved. "V1 / V2" alone makes the teacher reread the
    // whole document to find out what a rewrite did.
    revised._label = revisionActions.find((a) => a.id === actionId)?.label || text;
    revised.assistanceLevel = output.assistanceLevel;
    revised._changed = diffSections(output, revised);
    // Drop any "redo" branch, then append and jump to the new version.
    setVersions((prev) => [...prev.slice(0, versionIndex + 1), revised]);
    setVersionIndex((i) => i + 1);
    setGenId((n) => n + 1);
    setCustomPrompt("");
    setRevising(false);
    const used = revisionsUsed + 1;
    setRevisionsUsed(used);
    const left = MAX_REVISIONS - used;
    toast(
      revised._source === "mock"
        ? "No drafting service is running. Applied a local revision."
        : left === 0
        ? `Draft rewritten. That was your last of ${MAX_REVISIONS} rewrites.`
        : `Draft rewritten. ${left} rewrite${left === 1 ? "" : "s"} left.`
    );
  };

  // ── My classes: prefill ─────────────────────────────────────────────────
  // A teacher's section carries its subject, course, grade, reading level, tech
  // level and community context, so a new draft starts filled in.
  const appliedClassRef = useRef(null);
  useEffect(() => {
    if (!activeClass || appliedClassRef.current === activeClass.id) return;
    appliedClassRef.current = activeClass.id;
    const patch = classToInput(activeClass);
    const keys = Object.keys(patch);
    if (!keys.length) return;
    setInput((prev) => ({ ...prev, ...patch }));
    setPrefilled((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  }, [activeClass, setInput]);

  // ── Carry the last lesson forward ───────────────────────────────────────
  // "What students did last class" was typed from memory every time, even
  // though the previous lesson for this class is saved in My materials with a
  // timestamp. This fills it in.
  //
  // Deliberately its own effect rather than folded into the class prefill
  // above: that one depends on `activeClass` alone and fires once, so when
  // materials finished loading a moment later the lookup found nothing and
  // never retried. This waits for both.
  const appliedLastClassRef = useRef(null);
  useEffect(() => {
    if (!activeClass) return;
    // Once per class, so re-running never overwrites what a teacher typed.
    if (appliedLastClassRef.current === activeClass.id) return;
    const summary = lastClassSummary(mostRecentForClass(materials, activeClass.id, materialId));
    if (!summary) return;
    appliedLastClassRef.current = activeClass.id;
    setInput((prev) => {
      // A teacher who has already written something owns it.
      if (String(prev.lastClass || "").trim()) return prev;
      return { ...prev, lastClass: summary };
    });
    setPrefilled((prev) => new Set(prev).add("lastClass"));
  }, [activeClass, materials, materialId, setInput]);

  // ── My materials: save ──────────────────────────────────────────────────
  // Explicit save with a confirmation, plus a silent autosave so a refresh never
  // loses a draft. Both write the same record.
  const persist = (opts = {}) => {
    if (!output) return false;
    const id = materialId || newMaterialId();
    // Keep the record's existing title (a duplicate's "(copy)") rather than
    // re-deriving it from the draft on every autosave.
    const existingTitle = materials.find((x) => x.id === id)?.title;
    const item = makeMaterial({
      output,
      input,
      classId: filing.classId,
      unit: filing.unit,
      id,
      title: existingTitle,
      versions,
      revisionsUsed,
    });
    const ok = setMaterials(upsertMaterial(materials, item));
    if (ok) {
      setMaterialId(id);
      setSavedAt(item.savedAt);
      if (opts.announce) toast("Saved to My materials");
    } else if (opts.announce) {
      toast("Could not save. Your browser storage may be full.");
    }
    return ok;
  };

  const saveToMaterials = () => persist({ announce: true });

  // #87 Duplicate. Saves the current draft under a new id so a teacher can fork
  // a plan for a second section without losing the first. The new record becomes
  // the one this screen autosaves to, which is what "duplicate" means everywhere
  // else: you are now working on the copy.
  const duplicateMaterial = () => {
    if (!output) return;
    const id = newMaterialId();
    const base = materials.find((x) => x.id === materialId)?.title || output.title || "Draft";
    const item = makeMaterial({
      output,
      input,
      classId: filing.classId,
      unit: filing.unit,
      id,
      title: `${base} (copy)`,
      versions,
      revisionsUsed,
    });
    if (setMaterials(upsertMaterial(materials, item))) {
      setMaterialId(id);
      setSavedAt(item.savedAt);
      toast(`Duplicated as "${item.title}"`);
    } else {
      toast("Could not duplicate. Your browser storage may be full.");
    }
    setAssignOpen(false);
  };

  // Differentiated versions of the same lesson, as printable documents.
  //
  // The `differentiation` block already describes below / on / above variants,
  // but it describes them TO THE TEACHER. Nobody can hand a student a paragraph
  // about how the task could be adapted. This turns one into an actual document.
  //
  // A variant is a NEW MATERIAL, not a field on this one. That matters for three
  // reasons: the document does not double in size against a ~5MB storage ceiling
  // shared by every draft; each variant is independently editable, printable and
  // refilable like anything else in My materials; and it lands in the same class
  // and unit, so it sits beside the original rather than hiding inside it.
  //
  // It reuses /api/revise, so it inherits every check that route runs, and it is
  // an explicit action rather than something the draft does automatically: it
  // costs a model call, and a draft that needed retries has already spent three
  // of four.
  const TIERS = {
    below: {
      label: "below grade",
      directive:
        "Rewrite this resource for students reading below grade level, keeping the same " +
        "learning objective and the same rigour of thinking. Shorten sentences, define " +
        "the terms in place, break multi-step tasks into numbered steps, and keep every " +
        "question. Do not remove content or lower what students are asked to do.",
    },
    above: {
      label: "above grade",
      directive:
        "Rewrite this resource for students ready to go further, keeping the same learning " +
        "objective. Add depth rather than volume: ask for justification, generalisation, or " +
        "a second representation. Keep the same structure and timing.",
    },
  };

  const makeVariant = async (tier) => {
    const spec = TIERS[tier];
    if (!output || revising || !spec) return;
    setRevising(true);
    setAssignOpen(false);
    let variant;
    try {
      variant = await reviseResource(output, input, spec.directive, {
        format: showFormat ? format : undefined,
      });
    } catch (err) {
      setRevising(false);
      toast(err instanceof ApiError ? err.message : "That version did not come through. Try again.");
      return;
    }
    const base = materials.find((x) => x.id === materialId)?.title || output.title || "Draft";
    const item = makeMaterial({
      output: variant,
      input,
      classId: filing.classId,
      unit: filing.unit,
      id: newMaterialId(),
      title: `${base} (${spec.label})`,
      versions: [variant],
    });
    setRevising(false);
    if (setMaterials(upsertMaterial(materials, item))) {
      // Deliberately does NOT switch the screen to the variant. The teacher asked
      // for another version, not to leave the one they were reading.
      // Sends them to the list rather than swapping the document underneath
      // them: they asked for another version, not to stop reading this one.
      toast(`Saved "${item.title}" to My materials`, {
        action: { label: "Show me", onAction: () => go("materials") },
      });
    } else {
      toast("Could not save. Your browser storage may be full.");
    }
  };

  // #87 Assign to a class. Re-files the saved record against another class so it
  // shows up under that class in My materials.
  const assignToClass = (classId) => {
    if (!output) return;
    const id = materialId || newMaterialId();
    const existingTitle = materials.find((x) => x.id === id)?.title;
    const nextFiling = { classId, unit: filing.unit };
    setFiling(nextFiling);
    const item = makeMaterial({
      output, input, classId: nextFiling.classId, unit: nextFiling.unit, id,
      title: existingTitle, versions, revisionsUsed,
    });
    if (setMaterials(upsertMaterial(materials, item))) {
      setMaterialId(id);
      setSavedAt(item.savedAt);
      const name = classes.find((c) => c.id === classId)?.name || "that class";
      toast(`Filed under ${name}`);
    } else {
      toast("Could not save. Your browser storage may be full.");
    }
    setAssignOpen(false);
  };

  useEffect(() => {
    if (!output) return;
    const t = setTimeout(() => persist(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output]);

  // Opening a saved draft from My materials: restore it and land on results.
  useEffect(() => {
    if (!openMaterial) return;
    // Version history and the rewrite budget travel with the material. They used
    // to be discarded on reopen, which quietly refilled a budget of ten and threw
    // away every earlier draft the teacher might have wanted back.
    setVersions(
      (Array.isArray(openMaterial.versions) && openMaterial.versions.length
        ? openMaterial.versions
        : [openMaterial.output]
      ).map(withSectionIds)
    );
    setRevisionsUsed(Number(openMaterial.revisionsUsed) || 0);
    setVersionIndex(0);
    setMaterialId(openMaterial.id);
    // Adopt the record's own filing rather than the current builder context.
    setFiling({ classId: openMaterial.classId ?? null, unit: openMaterial.unit || "" });
    setSavedAt(openMaterial.savedAt);
    setFlow("custom");
    setGenId((n) => n + 1);
    go("results", -1, { immediate: true });
    onConsumeOpenMaterial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMaterial]);

  // #12 The five most recently saved materials, newest first. Drawn from saved
  // materials rather than a separate history store: what a teacher saved and
  // reopened IS the history, and a second store would drift from it.
  const recentMaterials = useMemo(
    () =>
      [...(materials || [])]
        .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))
        .slice(0, 5),
    [materials]
  );

  // Reopening one restores it in place. Same work the openMaterial effect does
  // when My materials hands a draft over, kept local so the fork screen does not
  // need a round trip through App state to open something it already has.
  const openRecent = (m) => {
    if (!m?.output) return;
    setVersions(
      (Array.isArray(m.versions) && m.versions.length ? m.versions : [m.output]).map(
        withSectionIds
      )
    );
    setRevisionsUsed(Number(m.revisionsUsed) || 0);
    setVersionIndex(0);
    setMaterialId(m.id);
    setSavedAt(m.savedAt);
    if (m.input) setInput((prev) => ({ ...prev, ...m.input }));
    setFlow("custom");
    setGenId((n) => n + 1);
    // Same reasoning as the openMaterial effect: reopening a saved draft is a
    // file being opened, not a step in the wizard, so it should not wait.
    go("results", 1, { immediate: true });
  };

  const goToVersion = (i) => {
    if (i < 0 || i >= versions.length || i === versionIndex) return;
    setVersionIndex(i);
    setReview(null);
    setReviewOpen(false);
    setGenId((n) => n + 1);
  };
  const undoRevision = () => goToVersion(versionIndex - 1);

  // Swap one section inside the version on screen. Section-level changes edit
  // the current version in place rather than pushing a new one: a teacher fixing
  // a warm-up has not produced a new draft of the whole document, and stacking a
  // version pill per word changed would make the version history useless.
  const replaceSection = (sectionId, patch) => {
    setVersions((prev) =>
      prev.map((v, i) =>
        i !== versionIndex
          ? v
          : {
              ...v,
              sections: v.sections.map((s) =>
                s.id === sectionId ? { ...s, ...patch } : s
              ),
            }
      )
    );
  };

  // #81 Redo one section. Deliberately does NOT spend from the rewrite budget:
  // the budget exists to bound whole-document rewrites, and charging a teacher a
  // full rewrite to fix eight words is the behaviour the item asks us to remove.
  const redoSection = async (section, directive = "") => {
    if (!output || redoingSection) return;
    // Same gap as revise(): a per-section redo note is free text and was going
    // to the model unscreened.
    const piiInDirective = screenForPII({ directive: String(directive || "") });
    if (piiInDirective.length) {
      toast(`Not sent. ${describeFindings(piiInDirective)}`, { duration: 7000 });
      return;
    }
    setOpenSectionMenu(null);
    setRedoingSection(section.id);
    try {
      const { section: next, source } = await regenerateSection(
        output,
        input,
        section.label,
        directive
      );
      // Timing is held in code, not asked for in the prompt. The section prompt
      // does tell the model to keep the minutes, and in testing it returned 10
      // for a 7 minute warm-up anyway, which silently breaks the period total
      // because no other section was regenerated to absorb the difference. The
      // number only moves when the teacher's directive is actually about time.
      const aboutTiming = /\b(minute|min\b|time|timing|shorter|longer|shorten|extend)/i.test(
        directive
      );
      replaceSection(section.id, {
        label: next.label || section.label,
        body: next.body,
        steps: next.steps || [],
        minutes: aboutTiming ? next.minutes ?? section.minutes : section.minutes,
      });
      toast(source === "mock" ? "Redrew this section locally" : "Redrew this section");
    } catch {
      toast("Could not redo that section. Try again.");
    } finally {
      setRedoingSection(null);
    }
  };

  // #82 Inline editing. Teachers change one word without spending a call.
  // Which part of a section is being edited: its prose/list body, or the
  // two-column procedure. The procedure is the part a teacher most wants to
  // adjust — it is the minute-by-minute of the lesson — and it had no edit path
  // at all, so changing one word cost a whole rewrite from a budget of ten.
  const [editingMode, setEditingMode] = useState("body");

  // One "Teacher | Students" pair per line. The same round-trip convention the
  // materials editor uses for its three named lists: a flat textarea a teacher
  // can actually work in, with a separator that survives being typed by hand.
  const stepsToText = (steps) =>
    (Array.isArray(steps) ? steps : [])
      .map((t) => `${t?.teacher || ""} | ${t?.students || ""}`)
      .join("\n");

  const textToSteps = (text) =>
    String(text || "")
      .split("\n")
      .map((line) => {
        const [teacher = "", students = ""] = line.split("|");
        return { teacher: teacher.trim(), students: students.trim() };
      })
      .filter((t) => t.teacher || t.students);

  const startEditingSteps = (section) => {
    setOpenSectionMenu(null);
    setEditingMode("steps");
    setEditingSection(section.id);
    setEditDraft(stepsToText(section.steps));
  };

  const startEditing = (section) => {
    setEditingMode("body");
    setOpenSectionMenu(null);
    setEditingSection(section.id);
    setEditDraft(
      Array.isArray(section.body) ? section.body.join("\n") : String(section.body || "")
    );
  };

  const saveEditing = (section) => {
    if (editingMode === "steps") {
      replaceSection(section.id, { steps: textToSteps(editDraft), edited: true });
      setEditingSection(null);
      setEditingMode("body");
      setEditDraft("");
      toast("Steps updated");
      return;
    }
    // A list stays a list and prose stays prose: switching the shape on edit
    // would change how the section renders and exports.
    const next = Array.isArray(section.body)
      ? editDraft.split("\n").map((l) => l.trim()).filter(Boolean)
      : editDraft.trim();
    replaceSection(section.id, { body: next, edited: true });
    setEditingSection(null);
    setEditDraft("");
    toast("Section updated");
  };

  const cancelEditing = () => {
    setEditingMode("body");
    setEditingSection(null);
    setEditDraft("");
  };

  // #82 Editing a typed block. The blocks are lists of strings, so the same
  // one-per-line editor works; the difference is only where the value is written
  // back. Kept separate from the section editor so a block edit cannot land in
  // a section by mistake.
  const [editingBlock, setEditingBlock] = useState(null);
  const startEditingBlock = (key, title) => {
    if (!output) return;
    const value =
      key === "materials"
        ? [
            ...(output.materials?.print || []).map((x) => `print: ${x}`),
            ...(output.materials?.gather || []).map((x) => `gather: ${x}`),
            ...(output.materials?.setup || []).map((x) => `setup: ${x}`),
          ]
        : output[key] || [];
    setEditingBlock({ key, title });
    setEditDraft(value.join("\n"));
  };

  const saveEditingBlock = () => {
    if (!editingBlock) return;
    const lines = editDraft.split("\n").map((l) => l.trim()).filter(Boolean);
    const patch =
      editingBlock.key === "materials"
        ? {
            materials: {
              // The prefix is how a flat editor round-trips three named lists.
              // Anything unprefixed falls into "gather", which is the bucket a
              // teacher means when they just type an item.
              print: lines.filter((l) => /^print:/i.test(l)).map((l) => l.replace(/^print:\s*/i, "")),
              gather: lines
                .filter((l) => !/^(print|setup):/i.test(l))
                .map((l) => l.replace(/^gather:\s*/i, "")),
              setup: lines.filter((l) => /^setup:/i.test(l)).map((l) => l.replace(/^setup:\s*/i, "")),
            },
          }
        : { [editingBlock.key]: lines };

    setVersions((prev) =>
      prev.map((v, i) => (i === versionIndex ? { ...v, ...patch } : v))
    );
    setEditingBlock(null);
    setEditDraft("");
    toast(`${editingBlock.title} updated`);
  };

  // #119 Capture the section, the inputs, and the prompt version.
  const submitReport = (section, reason, note) => {
    const saved = recordSectionReport({ output, input, section, reason, note });
    setReportingSection(null);
    toast(
      saved
        ? "Thanks. Saved with the prompt version so this can be fixed."
        : "Could not save the report. Your browser storage may be full."
    );
  };

  const doReview = () => {
    if (reviewOpen) {
      setReviewOpen(false);
      return;
    }
    setReview(runReview(output, input));
    setReviewOpen(true);
  };

  // #86 Copy says what it copies. "Copy" alone gave no way to know whether the
  // clipboard held the teacher copy or the student one, which matters when the
  // difference is the answer key.
  const doCopy = async (kind) => {
    const text =
      kind === "markdown" ? toMarkdown(output, audience, input) : toPlainText(output, audience, input);
    const copied = await copyToClipboard(text);
    const which = audience === "student" ? "student copy" : "teacher copy";
    toast(
      copied
        ? `Copied the ${which} as ${kind === "markdown" ? "Markdown" : "plain text"}`
        : "Couldn't copy. Try a download instead."
    );
    setExportOpen(false);
  };

  // #85 The formats a teacher uses. Word HTML opens in Word, Pages, and Google
  // Docs (upload converts it), which covers the Google Docs case without an
  // OAuth client. PDF goes through the print dialog, same as paper.
  const doWord = () => {
    download(fileName(output, "doc"), toWordHtml(output, audience, input), "application/msword");
    toast(`Downloaded the ${audience === "student" ? "student" : "teacher"} copy for Word`);
    setExportOpen(false);
  };
  const doMarkdown = () => {
    download(fileName(output, "md"), toMarkdown(output, audience, input));
    toast("Downloaded Markdown");
    setExportOpen(false);
  };
  // Scoped printing reuses the reading-view trick: flag the document root and
  // let CSS decide what renders. Nothing in the document tree needs to know a
  // print scope exists.
  const doPrint = (scope = "full") => {
    setExportOpen(false);
    setPrintScope(scope);
    // The student handout is exactly the student copy, so switching the audience
    // keeps one source of truth rather than duplicating the filter in CSS.
    const previousAudience = audience;
    if (scope === "handout") setAudience("student");

    document.documentElement.setAttribute("data-print-scope", scope);
    // Wait a frame so React has committed the audience change before the print
    // dialog snapshots the page.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        document.documentElement.removeAttribute("data-print-scope");
        setPrintScope("full");
        if (scope === "handout") setAudience(previousAudience);
      });
    });
  };

  const resultsBack = () => {
    setReadingView(false);
    go("sheet", 1);
  };

  const restart = () => {
    const seed = classPatch();
    setInput({ ...defaultInput, ...seed });
    resetOutput();
    setReview(null);
    setReviewOpen(false);
    setPrefilled(new Set(Object.keys(seed)));
    setFlow(null);
    setFromProgress(0);
    go("fork", 1);
  };

  // The stereotype check reports `pass: null` because it is a judgement only the
  // teacher can make. Counting it as a pass would let the tool certify the one
  // thing it is least able to certify, so it is excluded from the denominator
  // and surfaced as "needs your eye" instead.
  const checkable = review ? review.filter((r) => r.pass !== null) : [];
  const passCount = checkable.filter((r) => r.pass).length;

  // #44 Advances the "arriving" highlight down the expected section list while
  // the draft is in flight. Paced to a typical generation rather than tied to
  // real progress: the API returns the whole document at once, so a progress bar
  // claiming to track sections would be a lie about what is happening.
  const [draftStep, setDraftStep] = useState(-1);
  useEffect(() => {
    if (!loading || output) {
      setDraftStep(-1);
      return;
    }
    const total = expectedSections(input).length;
    let i = -1;
    const id = setInterval(() => {
      i += 1;
      setDraftStep(i);
      if (i >= total - 1) clearInterval(id);
    }, 650);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, output]);

  // #77 The site nav lives outside this component, so reading view flags it on
  // the document element and a global rule hides it. Cleaned up on unmount, or
  // navigating away while reading view is on would leave the app with no nav.
  useEffect(() => {
    document.documentElement.classList.toggle("reading-view", readingView);
    return () => document.documentElement.classList.remove("reading-view");
  }, [readingView]);

  // #78 Estimate the printed page count. Letter at 0.75in margins leaves 9.5in
  // of usable height, which is 912px at the 96dpi CSS reference. The document
  // renders at a different width on screen than on paper, so this is an
  // estimate and is labelled as one: it is meant to answer "one copy or three"
  // at the copier, not to be exact.
  useEffect(() => {
    if (!output || !docBodyRef.current) {
      setPageCount(0);
      return;
    }
    const USABLE_PAGE_PX = 912;
    const measure = () => {
      const h = docBodyRef.current?.scrollHeight || 0;
      setPageCount(h ? Math.max(1, Math.ceil(h / USABLE_PAGE_PX)) : 0);
    };
    measure();
    // Editing a section, redoing one, or switching to the student copy all
    // change the height, so this observes rather than measuring once.
    const ro = new ResizeObserver(measure);
    ro.observe(docBodyRef.current);
    return () => ro.disconnect();
  }, [output, audience, genId]);
  const failedChecks = checkable.filter((r) => !r.pass);
  const needsEye = review ? review.filter((r) => r.pass === null) : [];

  // #80 Flags grouped by the section they refer to, so each one renders in the
  // margin beside its own paragraph. Anything the review could not anchor stays
  // at document level rather than being pinned to a guess.
  const flagsBySection = useMemo(() => {
    const map = new Map();
    for (const r of review || []) {
      if (r.pass === true) continue;
      if (r.sectionIndex == null) continue;
      const list = map.get(r.sectionIndex) || [];
      list.push(r);
      map.set(r.sectionIndex, list);
    }
    return map;
  }, [review]);

  return (
    <div className={ex.wizardPage}>

      <motion.div
        key={screen}
        className={ex.wizardContent}
        initial={{ opacity: 0, x: fromProgress > targetProgress ? -48 : 48 }}
        animate={
          exitDir !== 0
            ? { opacity: 0, x: exitDir * 48, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }
            : { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }
        }
      >

        {/* ══ Fork: choose a template or build from scratch ══ */}
        {screen === "fork" && (
          <>
            <div className={ex.forkIntro}>
              <p className={ex.question}>How do you want to start?</p>
              <div className={ex.forkStartChoices}>
                <button type="button" className={ex.startBlankLink} onClick={startCustom}>
                  Start from a blank sheet
                </button>
                <span className={ex.forkChoiceDivider}>or</span>
                <button
                  type="button"
                  className={ex.uploadPlanButton}
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploadingPlan}
                  aria-busy={uploadingPlan}
                >
                  {uploadingPlan ? uploadProgress || "Reading plan…" : "Upload your own lesson plan"}
                </button>
                <input
                  ref={uploadInputRef}
                  className={ex.srOnly}
                  type="file"
                  accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"
                  aria-label="Choose a plain-text, Markdown, or PDF lesson plan"
                  onChange={uploadLessonPlan}
                />
              </div>
              <p className={ex.uploadPlanHint}>
                Plain text, Markdown, or PDF up to 200 KB (PDFs up to 40 pages). Scanned PDFs use
                English OCR; the file stays in your browser. Remove student-identifying information
                first. Your plan is sent to AI only when you request a change.
              </p>
            </div>

            <motion.section
              className={ex.pathSection}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
            >
              <div className={ex.pathHeader}>
                <h2 className={ex.pathTitle}>Examples</h2>
                <p className={ex.pathCount}>Four examples so far. Adapt one, or start blank.</p>
              </div>
              <div className={ex.templateGrid}>
                {scenarios.map((s) => (
                  <motion.button
                    key={s.id}
                    type="button"
                    className={ex.templateCard}
                    onClick={() => chooseTemplate(s)}
                    whileTap={{ scale: 0.98 }}
                  >
                    {/* #8 A real preview, not a description: the first page of
                        the lesson this card actually produces, rendered small.
                        Teachers judge materials by looking at them. The offline
                        engine is deterministic, so this is the same document the
                        card generates, not a mock-up of one. */}
                    <span className={ex.templatePreview} aria-hidden="true">
                      <span className={ex.templatePreviewPage}>
                        <span className={ex.templatePreviewTitle}>
                          {previewOf(s)?.title}
                        </span>
                        {(previewOf(s)?.sections || []).slice(0, 3).map((sec, i) => (
                          <span key={i} className={ex.templatePreviewSection}>
                            <span className={ex.templatePreviewHeading}>{sec.label}</span>
                            <span className={ex.templatePreviewBody}>
                              {Array.isArray(sec.body) ? sec.body[0] : sec.body}
                            </span>
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className={ex.templateCardTitle}>{s.title || s.label}</span>
                    {/* #10 The facts a teacher screens on before reading a word
                        of the description: who it is for, how long, what tech. */}
                    <span className={ex.templateCardFacts}>
                      {[
                        s.input?.grade && `Grade ${s.input.grade}`,
                        `${s.input?.periodLength || 50} min`,
                        s.input?.resourceLevel && `${s.input.resourceLevel} tech`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {s.blurb && <span className={ex.templateCardBlurb}>{s.blurb}</span>}
                    {/* #6 Plain text, not a button. The whole card is the button. */}
                    <span className={ex.templateCardCta}>Adapt for my class</span>
                  </motion.button>
                ))}
              </div>
              {/* #12 Recently used. The school-wide row the brief also asks for
                  needs data this app does not have: there is no account system
                  and nothing is shared between teachers. */}
              {recentMaterials.length > 0 && (
                <div className={ex.recentRow}>
                  <h3 className={ex.recentTitle}>Recently used</h3>
                  <ul className={ex.recentList}>
                    {recentMaterials.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          className={ex.recentCard}
                          onClick={() => openRecent(m)}
                        >
                          <span className={ex.recentCardTitle}>{m.title}</span>
                          <span className={ex.recentCardFacts}>
                            {[m.input?.course || m.input?.subject, m.input?.topic]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            </motion.section>


          </>
        )}

        {/* ══ Template Review: single unified, inline-editable summary ══ */}
        

        {/* ══ Custom Step 1 · Target (who & what) ══ */}
        

        {/* ══ Custom Step 2 · Environment (context & needs) ══ */}
        

        {/* ══ Custom Step 3 · Output (the deliverable) ══ */}
        

        {/* ══ Results — one continuous Document Canvas (shared by both flows) ══ */}
        {screen === "sheet" && (
          <PlanningSheet
            input={input}
            set={set}
            prefilled={prefilled}
            clearPrefill={(k) =>
              setPrefilled((prev) => {
                const next = new Set(prev);
                next.delete(k);
                return next;
              })
            }
            onGenerate={run}
            onStartOver={restart}
            loading={loading}
            canGenerate={canGenerate}
            piiFindings={piiFindings}
            onDismissPii={() => setPiiFindings([])}
          />
        )}

        {screen === "results" && (
          <div className={ex.resultsWrap}>
            <div className={ex.docTopNav}>
              <button type="button" className={ex.btnBack} onClick={resultsBack}>
                ← Back
              </button>
              {output && (
                <button
                  type="button"
                  className={ex.btnSaveMaterial}
                  disabled={loading || revising}
                  onClick={saveToMaterials}
                >
                  Save to My materials
                </button>
              )}
              {savedAt && (
                <span className={ex.savedFlag} aria-live="polite">
                  Saved
                </span>
              )}
              <button
                type="button"
                className={ex.btnBack}
                disabled={loading || revising}
                onClick={restart}
              >
                Start over
              </button>
            </div>

            <div role="status" aria-live="polite" aria-atomic="true" className={ex.srOnly}>
              {loading
                ? "Generating your draft…"
                : revising
                ? "Your draft is being revised…"
                : output
                ? "Draft ready."
                : ""}
            </div>

            {/* A failure the teacher can act on. Sits in the same slot the
                skeleton occupies, so the page does not jump between states. */}
            {genError && !loading && !output && (
              <div className={ex.genError} role="alert">
                <p className={ex.genErrorTitle}>
                  {genError.recoverable ? "That did not go through" : "Lumen could not draft this"}
                </p>
                <p className={ex.genErrorBody}>{genError.message}</p>
                <div className={ex.genErrorActions}>
                  {genError.recoverable && (
                    <button type="button" className={ex.btnPrimarySm} onClick={run}>
                      Try again
                    </button>
                  )}
                  {/* Always offered, never chosen for them. A local draft is a
                      real option, just not one the app should take silently. */}
                  <button type="button" className={ex.btnGhostSm} onClick={useLocalDraft}>
                    Use a local draft instead
                  </button>
                  <button type="button" className={ex.btnGhostSm} onClick={() => go("sheet", 1)}>
                    Back to the sheet
                  </button>
                </div>
                {genError.retryAfter ? (
                  <p className={ex.genErrorHint}>
                    The server suggested waiting about {genError.retryAfter} seconds.
                  </p>
                ) : null}
              </div>
            )}

            {/* Initial generation — skeleton document */}
            {loading && !output && (
              <div className={ex.docCanvas}>
                <div className={ex.docToolbar} style={{ top: navHeight }}>
                  <span className={ex.typingIndicator}>
                    <span className={ex.typingDots} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>{draftingLabel(input)}</span>
                  </span>
                </div>
                {/* #44 The real section headings arrive in order, each with the
                    minutes it will get, instead of anonymous gray bars. The wait
                    teaches the structure of what is coming and reinforces the
                    period budget. The headings are known in advance because the
                    section list per resource type is fixed by the prompt. */}
                <div className={ex.docBody}>
                  <div className={`${ex.skelLine} ${ex.skelTitle}`} aria-hidden="true" />
                  <ol className={ex.draftPlan}>
                    {expectedSections(input).map((sec, i) => (
                      <li
                        key={sec.label}
                        className={`${ex.draftPlanRow}${i <= draftStep ? ` ${ex.draftPlanRowOn}` : ""}`}
                      >
                        <span className={ex.draftPlanLabel}>{sec.label}</span>
                        {sec.minutes ? (
                          <span className={ex.draftPlanMin}>{sec.minutes} min</span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}

            {output && (
              <div
                className={`${ex.docCanvas}${revising ? ` ${ex.docCanvasRevising}` : ""}${
                  readingView ? ` ${ex.readingView}` : ""
                }`}
              >
                {/* Sticky header: version control + export actions + review */}
                <div className={ex.docToolbar} style={{ top: navHeight }}>
                  <div className={ex.docToolbarLeft}>
                    {versions.length > 1 && (
                      <div className={ex.versionControl} role="group" aria-label="Draft versions">
                        <button
                          type="button"
                          className={ex.undoBtn}
                          onClick={undoRevision}
                          disabled={versionIndex === 0 || revising}
                          title="Undo revision"
                        >
                          <Icon name="arrowLeft" size="sm" /> Undo
                        </button>
                        <div className={ex.versionPills}>
                          {versions.map((v, i) => (
                            <button
                              key={i}
                              type="button"
                              className={`${ex.versionPill}${
                                i === versionIndex ? ` ${ex.versionPillActive}` : ""
                              }`}
                              onClick={() => goToVersion(i)}
                              disabled={revising}
                              aria-current={i === versionIndex}
                              title={
                                i === 0
                                  ? "Version 1, the first draft"
                                  : `Version ${i + 1}: ${v._label || "rewrite"}. ${describeDiff(
                                      v._changed
                                    )}.`
                              }
                            >
                              <span className={ex.versionPillNum}>V{i + 1}</span>
                              {v._label && (
                                <span className={ex.versionPillName}>{v._label}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* #83 The name of the change, and what it moved, without
                        opening anything. Tooltips alone are not reachable by
                        keyboard or touch. */}
                    {output?._label && (
                      <p className={ex.versionSummary}>
                        <span className={ex.versionName}>{output._label}</span>
                        <span className={ex.versionDiff}>{describeDiff(output._changed)}</span>
                      </p>
                    )}
                  </div>

                  <div className={ex.docToolbarActions}>
                    {/* #68 Teacher copy vs student copy. Filtering by the
                        audience field means the student version can never
                        contain teacher notes or an answer key. */}
                    <div className={ex.audienceToggle} role="group" aria-label="Which copy">
                      <button
                        type="button"
                        className={`${ex.audienceBtn}${audience === "teacher" ? ` ${ex.audienceBtnOn}` : ""}`}
                        aria-pressed={audience === "teacher"}
                        onClick={() => setAudience("teacher")}
                      >
                        Teacher copy
                      </button>
                      <button
                        type="button"
                        className={`${ex.audienceBtn}${audience === "student" ? ` ${ex.audienceBtnOn}` : ""}`}
                        aria-pressed={audience === "student"}
                        onClick={() => setAudience("student")}
                      >
                        Student copy
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`${ex.docActionBtn}${reviewOpen ? ` ${ex.docActionBtnActive}` : ""}`}
                      onClick={doReview}
                      aria-expanded={reviewOpen}
                    >
                      <Icon name="shieldCheck" size="sm" /> Review Results
                      {review && (
                        <span className={ex.reviewBadge}>
                          {failedChecks.length > 0
                            ? `${failedChecks.length} flag${failedChecks.length > 1 ? "s" : ""}`
                            : `${passCount}/${checkable.length}`}
                        </span>
                      )}
                    </button>
                    {/* #78 The page count drives the copier decision, so it sits
                        in the toolbar rather than buried in the document. */}
                    {pageCount > 0 && (
                      <span className={ex.pageCount} title="Estimated from the draft on screen">
                        about {pageCount} page{pageCount > 1 ? "s" : ""}
                      </span>
                    )}
                    {/* #77 Reading view: hide the app chrome and give the
                        document the window, the pattern teachers know from Docs. */}
                    <button
                      type="button"
                      className={`${ex.docActionBtn}${readingView ? ` ${ex.readingViewBtnOn}` : ""}`}
                      onClick={() => setReadingView((v) => !v)}
                      aria-pressed={readingView}
                      title={
                        readingView
                          ? "Show the app around the document"
                          : "Read the document full width"
                      }
                    >
                      <Icon name={readingView ? "minus" : "book"} size="sm" />
                      {readingView ? "Exit reading" : "Reading view"}
                    </button>
                    <span className={ex.docActionDivider} aria-hidden="true" />

                    {/* #87 Duplicate and assign-to-class, next to Save. */}
                    <div className={ex.menuWrap}>
                      <button
                        type="button"
                        className={`${ex.docActionBtn}${assignOpen ? ` ${ex.docActionBtnActive}` : ""}`}
                        onClick={() => {
                          setAssignOpen((v) => !v);
                          setExportOpen(false);
                        }}
                        aria-expanded={assignOpen}
                        aria-haspopup="menu"
                      >
                        <Icon name="clipboard" size="sm" /> File
                        <Icon name="chevronDown" size="sm" />
                      </button>
                      {assignOpen && (
                        <div className={ex.menu} role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className={ex.menuItem}
                            onClick={duplicateMaterial}
                          >
                            Duplicate this draft
                          </button>
                          {/* Printable versions of the differentiation the draft already
                              describes. Each becomes its own material, so it can be edited and
                              printed like any other draft. */}
                          {output?.differentiation && (
                            <>
                              <button
                                type="button"
                                className={ex.menuItem}
                                onClick={() => makeVariant("below")}
                                disabled={revising || loading}
                              >
                                Make a below-grade version
                              </button>
                              <button
                                type="button"
                                className={ex.menuItem}
                                onClick={() => makeVariant("above")}
                                disabled={revising || loading}
                              >
                                Make an above-grade version
                              </button>
                            </>
                          )}
                          {classes.length > 0 && (
                            <>
                              <p className={ex.menuLabel}>Assign to a class</p>
                              {classes.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  role="menuitem"
                                  className={ex.menuItem}
                                  onClick={() => assignToClass(c.id)}
                                >
                                  {c.name}
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* #85/#86 One menu, and every item names what it produces
                        and which copy it produces it from. */}
                    <div className={ex.menuWrap}>
                      <button
                        type="button"
                        className={`${ex.docActionBtn}${exportOpen ? ` ${ex.docActionBtnActive}` : ""}`}
                        onClick={() => {
                          setExportOpen((v) => !v);
                          setAssignOpen(false);
                        }}
                        aria-expanded={exportOpen}
                        aria-haspopup="menu"
                      >
                        <Icon name="download" size="sm" /> Export
                        <Icon name="chevronDown" size="sm" />
                      </button>
                      {exportOpen && (
                        <div className={ex.menu} role="menu">
                          <p className={ex.menuLabel}>
                            {audience === "student" ? "Student copy" : "Teacher copy"}
                          </p>
                          <button type="button" role="menuitem" className={ex.menuItem} onClick={doWord}>
                            Word or Google Docs
                            <span className={ex.menuHint}>.doc, opens in both</span>
                          </button>
                          {/* The four things a teacher actually walks to the
                              copier with. Each already exists as a typed field;
                              this just prints one instead of all of them. */}
                          <p className={ex.menuLabel}>Print</p>
                          <button
                            type="button"
                            role="menuitem"
                            className={ex.menuItem}
                            onClick={() => doPrint("full")}
                          >
                            Full lesson plan
                            <span className={ex.menuHint}>Everything, for you</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className={ex.menuItem}
                            onClick={() => doPrint("handout")}
                          >
                            Student handout
                            <span className={ex.menuHint}>No notes, no answers</span>
                          </button>
                          {output.exitTicket?.questions?.length > 0 && (
                            <button
                              type="button"
                              role="menuitem"
                              className={ex.menuItem}
                              onClick={() => doPrint("exit-ticket")}
                            >
                              Exit ticket
                              <span className={ex.menuHint}>Questions only, no key</span>
                            </button>
                          )}
                          {output.answerKey?.length > 0 && (
                            <button
                              type="button"
                              role="menuitem"
                              className={ex.menuItem}
                              onClick={() => doPrint("answer-key")}
                            >
                              Answer key
                              <span className={ex.menuHint}>Both keys, for marking</span>
                            </button>
                          )}
                          <button
                            type="button"
                            role="menuitem"
                            className={ex.menuItem}
                            onClick={() => doCopy("text")}
                          >
                            Copy as plain text
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className={ex.menuItem}
                            onClick={() => doCopy("markdown")}
                          >
                            Copy as Markdown
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className={ex.menuItem}
                            onClick={doMarkdown}
                          >
                            Download Markdown
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* #83 What this version changed, stated on screen. The diff was
                    already computed for the pill tooltip, and a tooltip is not
                    somewhere a teacher looks to find out what a rewrite did. */}
                {versionIndex > 0 && versions[versionIndex]?._changed && !revising && (
                  <div className={ex.versionSummary}>
                    <span className={ex.versionSummaryName}>
                      {versions[versionIndex]._label || "Rewrite"}
                    </span>
                    <span className={ex.versionSummaryDiff}>
                      {describeDiff(versions[versionIndex]._changed)}
                    </span>
                  </div>
                )}

                {/* Dimming + shimmer while a revision is in flight */}
                <AnimatePresence>
                  {revising && (
                    <motion.div
                      className={ex.reviseOverlay}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    />
                  )}
                </AnimatePresence>

                {/* Rewrite status. Sticky inside the canvas rather than fixed to the
                    viewport, so it sits by the document title and travels with the
                    document instead of floating over the page header. The rail is
                    zero-height so showing it never shifts the text underneath. */}
                <AnimatePresence>
                  {revising && (
                    <motion.div
                      className={ex.reviseStatus}
                      style={{ top: badgeTop }}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                      role="status"
                      aria-live="polite"
                    >
                      <span className={ex.reviseOverlayBadge}>
                        <Icon name="refresh" size="sm" />
                        Your {labelFor(input.outputType) || "draft"} is being revised…
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* The document itself — typography, not cards */}
                <article className={ex.docBody} key={genId} ref={docBodyRef}>
                  {/* #78 Where each printed page will end. Drawn as an overlay
                      rather than inserted between sections, so showing them
                      cannot change the layout they are measuring. Estimated
                      from screen height, and labelled as an estimate. */}
                  {pageCount > 1 &&
                    Array.from({ length: pageCount - 1 }).map((_, i) => (
                      <span
                        key={i}
                        className={ex.pageRule}
                        style={{ top: `${(i + 1) * 912}px` }}
                        aria-hidden="true"
                      >
                        <span className={ex.pageRuleLabel}>page {i + 2}</span>
                      </span>
                    ))}
                  {output._source === "mock" && (
                    <span
                      className={`${ex.sourceBadge} ${ex.sourceBadgeMock}`}
                      title="No drafting service is reachable, so this was written by the offline engine. It is thinner than a live draft."
                    >
                      Local draft
                    </span>
                  )}
                  {/* #50 The metadata block a real lesson plan carries, above
                      the title where a department chair looks first. Replaces a
                      bare title followed by three chips. */}
                  <dl className={ex.docPlanHeader} data-print="plan-header">
                    {[
                      ["Course", input.course || input.subject],
                      ["Grade", input.grade],
                      ["Unit", input.unit],
                      ["Date", input.date],
                      ["Period", input.periodLength ? `${input.periodLength} min` : ""],
                      ["Class size", input.classSize],
                      [
                        "Standards",
                        output.standards?.length
                          ? output.standards.map((x) => (typeof x === "string" ? x : x?.code)).filter(Boolean).join(", ")
                          : "",
                      ],
                      ["Pages", pageCount ? `about ${pageCount}` : ""],
                    ]
                      .filter(([, v]) => String(v || "").trim())
                      .map(([k, v]) => (
                        <div key={k} className={ex.docPlanCell}>
                          <dt className={ex.docPlanKey}>{k}</dt>
                          <dd className={ex.docPlanVal}>{v}</dd>
                        </div>
                      ))}
                  </dl>

                  {/* Name / date / period. A handout students write on needs a
                      place to put their name, and nothing in this document had
                      one. Student copy only: a teacher's own copy does not. */}
                  {/* The blank-handout alarm, where the teacher is actually
                      standing. The verification row says it too, but a teacher
                      who has switched to Student copy to check the handout is
                      looking HERE, and an empty page with no explanation reads
                      as a rendering bug rather than a draft that needs redoing.
                      Not printed: it is a message about the artifact, not part
                      of it. */}
                  {audience === "student" && studentCopyEmpty && (
                    <p className={ex.emptyStudentCopy} data-print="notice">
                      Nothing in this draft is marked for students, so this copy is
                      empty. Redraft it, or use Teacher copy and mark the sections
                      students should see.
                    </p>
                  )}
                  {audience === "student" && (
                    <div className={ex.worksheetHeader} data-print="worksheet-header">
                      <span className={ex.worksheetField}>Name</span>
                      <span className={ex.worksheetField}>Date</span>
                      <span className={ex.worksheetFieldShort}>Period</span>
                    </div>
                  )}
                  <h1 className={ex.docTitle} data-print="title">{output.title}</h1>

                  {/* Copies and materials, at the top where the morning
                      decision actually gets made. */}
                  <PrepStrip output={output} audience={audience} />
                  {(output.meta?.length > 0 || assistanceLevelLabel(output.assistanceLevel || input.assistanceLevel)) && (
                    <div className={ex.docMetaPills}>
                      {(output.meta || []).map((m, i) => (
                        <span key={i} className={ex.docMetaPill}>
                          {m}
                        </span>
                      ))}
                      {assistanceLevelLabel(output.assistanceLevel || input.assistanceLevel) && (
                        <span className={ex.docMetaPill} data-print="assistance-level">
                          {assistanceLevelLabel(output.assistanceLevel || input.assistanceLevel)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Standards are only shown once checked against the local
                      dataset on the server, so a code on screen is a code that
                      exists. The title carries the standard's actual text. */}
                  {output.standards?.length > 0 && (
                    <div className={ex.standardsRow} data-print="standards">
                      {/* Tolerant of the older shape. validateStandards returns
                          objects, but a draft saved by an earlier build (or
                          restored from a backup written by one) can carry plain
                          code strings — which rendered as an empty chip with a
                          duplicate React key. Normalising here keeps one blank
                          chip from being the visible symptom. */}
                      {output.standards.map((raw) => {
                        const s = typeof raw === "string" ? { code: raw } : raw || {};
                        return (
                          <span key={s.code} className={ex.standardChip} title={s.text}>
                            <span className={ex.standardCode}>{s.code}</span>
                            {s.framework && (
                              <span className={ex.standardFramework}>{s.framework}</span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {output._source === "gemini" &&
                    !output.standards?.length &&
                    output.standardsRejected > 0 && (
                      <p className={ex.noStandardNote}>
                        No standard matched. The draft proposed a code that is not in the
                        standards list, so it was not shown.
                      </p>
                    )}

                  {/* Abstention is a result, not a failure. If the model said it
                      needed something, ask for it rather than hiding the gap. */}
                  {output.needsMoreInfo?.length > 0 && (
                    <div className={ex.needsInfo}>
                      <p className={ex.needsInfoTitle}>Add this and redraft for a better fit</p>
                      <ul className={ex.needsInfoList}>
                        {output.needsMoreInfo.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {output.sections
                    // The original index is captured BEFORE filtering, because
                    // the review anchors its flags to positions in the full
                    // section list. Using the filtered index would pin a flag to
                    // whichever section happened to shift into that slot.
                    .map((s, originalIndex) => ({ s, originalIndex }))
                    .filter(({ s }) => audience !== "student" || s.audience !== "teacher")
                    // Differentiation and accessibility now exist as typed blocks
                    // further down, with real UDL citations. Keeping the older
                    // prose section as well printed each one twice.
                    .filter(({ s }) => !supersededSection(s.label, output))
                    .map(({ s, originalIndex }, i) => {
                      const isList = Array.isArray(s.body);
                      // withSectionIds backfills at every entry point, so this
                      // is a second line of defence rather than the fix. It
                      // matters because `editingSection === undefined` matched
                      // EVERY id-less section at once: one click on Edit opened
                      // an editor on all of them, and saving wrote the same text
                      // into all of them. See src/engine/sectionIds.js.
                      const sid = s.id || `s${originalIndex}`;
                      const isEditing = editingSection === sid;
                      const isRedoing = redoingSection === sid;
                      const flags = flagsBySection.get(originalIndex) || [];
                      return (
                        <section
                          key={sid}
                          data-print="section"
                          className={`${ex.docSection}${isRedoing ? ` ${ex.docSectionBusy}` : ""}${
                            flags.length ? ` ${ex.docSectionFlagged}` : ""
                          }`}
                        >
                          {/* #80 Review findings sit in the margin beside the
                              section they are about. On narrow screens the
                              margin does not exist, so they become an inline
                              note above the section instead of overlapping it. */}
                          {flags.length > 0 && (
                            <aside
                              className={ex.marginFlags}
                              aria-label={`Review notes for ${s.label}`}
                            >
                              {flags.map((f) => (
                                <div
                                  key={f.id}
                                  className={`${ex.marginFlag}${
                                    f.pass === null ? ` ${ex.marginFlagEye}` : ""
                                  }`}
                                >
                                  <span className={ex.marginFlagMark} aria-hidden="true">
                                    {f.pass === null ? "?" : "!"}
                                  </span>
                                  <div>
                                    <p className={ex.marginFlagQ}>{f.q}</p>
                                    <p className={ex.marginFlagNote}>{f.note}</p>
                                  </div>
                                </div>
                              ))}
                            </aside>
                          )}
                          <h2 className={ex.docSectionHeading}>
                            {s.label}
                            {/* #52 Minutes in the gutter beside the heading. */}
                            {Number(s.minutes) > 0 && (
                              <span className={ex.sectionMinutes}>{s.minutes} min</span>
                            )}
                            {s.edited && (
                              <span className={ex.editedFlag} title="You edited this section">
                                edited
                              </span>
                            )}
                            {/* Per-section controls. Teacher copy only: these are
                                authoring tools, and they must not appear on a
                                view meant to be handed to a class. */}
                            {audience !== "student" && !isEditing && (
                              <span className={ex.sectionTools}>
                                {isRedoing ? (
                                  <span className={ex.sectionBusyLabel} role="status">
                                    <span className={ex.spinner} /> Redrawing…
                                  </span>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className={ex.sectionToolBtn}
                                      onClick={() => redoSection(s)}
                                      disabled={revising || loading || Boolean(redoingSection)}
                                      title={`Redo just "${s.label}" without spending a rewrite`}
                                    >
                                      <Icon name="refresh" size="sm" />
                                      <span className={ex.sectionToolLabel}>Redo</span>
                                    </button>
                                    <button
                                      type="button"
                                      className={ex.sectionToolBtn}
                                      onClick={() => startEditing(s)}
                                      disabled={revising || loading}
                                      title="Edit this section yourself"
                                    >
                                      <Icon name="pencil" size="sm" />
                                      <span className={ex.sectionToolLabel}>Edit</span>
                                    </button>
                                    {/* Only where there is a procedure to edit.
                                        The two-column moves are the part of a
                                        plan a teacher actually reworks, and they
                                        were the one part with no edit path. */}
                                    {s.steps?.length > 0 && (
                                      <button
                                        type="button"
                                        className={ex.sectionToolBtn}
                                        onClick={() => startEditingSteps(s)}
                                        disabled={revising || loading}
                                        title="Edit the teacher and student moves"
                                      >
                                        <Icon name="layers" size="sm" />
                                        <span className={ex.sectionToolLabel}>Steps</span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className={ex.sectionToolBtn}
                                      onClick={() =>
                                        setReportingSection(
                                          reportingSection === sid ? null : sid
                                        )
                                      }
                                      aria-expanded={reportingSection === sid}
                                      title="Tell us this section is wrong"
                                    >
                                      <Icon name="flag" size="sm" />
                                      <span className={ex.sectionToolLabel}>This is wrong</span>
                                    </button>
                                  </>
                                )}
                              </span>
                            )}
                          </h2>

                          {reportingSection === sid && (
                            <ReportForm
                              section={s}
                              onCancel={() => setReportingSection(null)}
                              onSubmit={submitReport}
                            />
                          )}

                          <div className={ex.docSectionBody}>
                            {isEditing ? (
                              <div className={ex.editBox}>
                                <label className={ex.srOnly} htmlFor={`edit-${sid}`}>
                                  Edit {s.label}
                                </label>
                                <textarea
                                  id={`edit-${sid}`}
                                  className={ex.editArea}
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  rows={Math.min(20, Math.max(4, editDraft.split("\n").length + 1))}
                                  autoFocus
                                />
                                <p className={ex.editHint}>
                                  {editingMode === "steps"
                                    ? "One step per line, as: what you do | what students do."
                                    : isList
                                    ? "One bullet per line."
                                    : "Plain text. Your wording is kept exactly as typed."}
                                </p>
                                <div className={ex.editActions}>
                                  <button
                                    type="button"
                                    className={ex.btnPrimarySm}
                                    onClick={() => saveEditing(s)}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    className={ex.btnGhostSm}
                                    onClick={cancelEditing}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {isList ? (
                                  <ul>
                                    {s.body.map((b, j) => (
                                      <li key={j}>
                                        {b}
                                        {/* Working space, on the student copy only.
                                            A handout without room to answer in is a
                                            document ABOUT the lesson, not the thing
                                            students work in — the whole difference
                                            between a printout and a worksheet.
                                            Sized to the question: a one-word answer
                                            does not need six ruled lines and a
                                            graphing task needs more than two. */}
                                        {audience === "student" && isQuestion(s.label, b) && (
                                          <span
                                            className={ex.answerSpace}
                                            data-lines={answerLines(b)}
                                            aria-hidden="true"
                                          />
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  String(s.body || "").trim() && <p>{s.body}</p>
                                )}
                                {/* #53/#56 The procedure as paired teacher and
                                    student moves, in order. */}
                                <StepTable steps={s.steps} />
                              </>
                            )}
                          </div>
                        </section>
                      );
                    })}

                  {audience !== "student" && (
                    <TimingTable
                      sections={output.sections}
                      periodLength={input.periodLength}
                      // The same predicate that removes these sections from the
                      // document, so the schedule can never name a section the
                      // teacher cannot find above it.
                      hiddenLabels={output.sections
                        .filter((s) => supersededSection(s.label, output))
                        .map((s) => s.label)}
                    />
                  )}
                  <DocBlocks
                    output={output}
                    input={input}
                    audience={audience}
                    onEditBlock={startEditingBlock}
                  />

                  {/* #82 The block editor. One dialog rather than an inline
                      editor per block: the blocks are far apart in a long
                      document and an inline field would scroll out of view. */}
                  {editingBlock && (
                    <div className={ex.blockEditor} role="group" aria-label={`Edit ${editingBlock.title}`}>
                      <p className={ex.blockEditorTitle}>Edit {editingBlock.title.toLowerCase()}</p>
                      <textarea
                        className={ex.editArea}
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={Math.min(16, Math.max(4, editDraft.split("\n").length + 1))}
                        autoFocus
                        aria-label={`${editingBlock.title} content`}
                      />
                      <p className={ex.editHint}>
                        {editingBlock.key === "materials"
                          ? "One item per line. Start a line with print: or setup: to file it under that heading."
                          : "One item per line."}
                      </p>
                      <div className={ex.editActions}>
                        <button type="button" className={ex.btnPrimarySm} onClick={saveEditingBlock}>
                          Save
                        </button>
                        <button
                          type="button"
                          className={ex.btnGhostSm}
                          onClick={() => {
                            setEditingBlock(null);
                            setEditDraft("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              </div>
            )}

            {/* Bias & fit review — collapsible right-hand drawer. Scrim and drawer
                each sit in their own AnimatePresence with a keyed child, which is
                the pattern AnimatePresence documents; a bare fragment child is not
                a tracked presence node. */}
            <AnimatePresence>
              {reviewOpen && review && (
                <motion.div
                  key="review-scrim"
                  className={ex.drawerScrim}
                  onClick={() => setReviewOpen(false)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {reviewOpen && review && (
                  <motion.aside
                    key="review-drawer"
                    className={ex.reviewDrawer}
                    aria-label="Bias and fit review"
                    initial={{ x: "100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "100%" }}
                    transition={{ type: "spring", stiffness: 320, damping: 34 }}
                  >
                    <div className={ex.reviewDrawerHead}>
                      <div>
                        <p className={ex.reviewDrawerTitle}>Bias &amp; fit review</p>
                        <p className={ex.reviewDrawerSummary}>
                          {passCount} of {checkable.length} checks passed
                          {needsEye.length > 0 && `, ${needsEye.length} needs your eye`}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={ex.drawerClose}
                        onClick={() => setReviewOpen(false)}
                        aria-label="Close review"
                      >
                        <Icon name="minus" size="sm" />
                      </button>
                    </div>
                    <div className={ex.checkList}>
                      {review.map((r, i) => (
                        <div className={ex.checkRow} key={r.id || i}>
                          <span
                            className={`${ex.checkMark}${
                              r.pass === true ? "" : r.pass === null ? ` ${ex.checkMarkEye}` : ` ${ex.checkMarkFail}`
                            }`}
                            aria-hidden
                          >
                            {r.pass === true ? "✓" : r.pass === null ? "?" : "!"}
                          </span>
                          <div>
                            <div className={ex.checkTitle}>{r.q}</div>
                            <div className={ex.checkNote}>{r.note}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.aside>
              )}
            </AnimatePresence>


            {/* Persistent AI Assistant — floating toolbar (revise = full rewrite) */}
            {/* Rendered through a portal to document.body. `position: fixed`
                resolves against the nearest ancestor with a transform, and the
                page-transition wrapper carries one, so in place the dock
                anchored to the content column and sat on top of the document
                instead of in the corner of the window. */}
            {output && createPortal(
              <div
                className={`${ex.aiToolbar}${rewriteOpen ? ` ${ex.aiToolbarOpen}` : ""}`}
                role="region"
                aria-label="Revision controls"
              >
                {/* #79 Collapsed to a dock at rest so it never covers the
                    document. A right rail was the other option in the brief, but
                    the right margin is already carrying the review flags (#80)
                    and the two would collide on every wide screen. */}
                {!rewriteOpen && (
                  <button
                    type="button"
                    className={ex.aiDock}
                    onClick={() => setRewriteOpen(true)}
                    aria-expanded="false"
                    aria-controls="revise-drawer"
                  >
                    <Icon name="refresh" size="sm" />
                    Ask for a change
                    <span className={ex.aiDockCount}>{revisionsLeft} left</span>
                  </button>
                )}
                <div
                  className={ex.aiToolbarInner}
                  id="revise-drawer"
                  hidden={!rewriteOpen}
                >
                  <div className={ex.aiDrawerHead}>
                    <span className={ex.aiDrawerTitle}>Ask for a change</span>
                    <button
                      type="button"
                      className={ex.drawerClose}
                      onClick={() => setRewriteOpen(false)}
                      aria-label="Close revision controls"
                    >
                      <Icon name="minus" size="sm" />
                    </button>
                  </div>
                  {/* Mobile only (CSS-hidden on wider screens): five stacked chips ate
                      ~40% of a phone screen, so they collapse behind this toggle and
                      the desktop layout is left exactly as it was. */}
                  <button
                    type="button"
                    className={ex.aiChipsToggle}
                    onClick={() => setQuickEditsOpen((v) => !v)}
                    aria-expanded={quickEditsOpen}
                    aria-controls="ai-quick-edits"
                  >
                    <Icon name="menu" size="sm" />
                    Quick edits
                    <Icon
                      name="chevronDown"
                      size="sm"
                      className={quickEditsOpen ? ex.aiChipsChevronOpen : undefined}
                    />
                  </button>
                  <div
                    id="ai-quick-edits"
                    className={`${ex.aiChips}${quickEditsOpen ? ` ${ex.aiChipsOpen}` : ""}`}
                  >
                    {revisionActions.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className={ex.aiChip}
                        onClick={() => {
                          setQuickEditsOpen(false);
                          revise(a.directive, a.id);
                        }}
                        disabled={revising || loading || revisionsExhausted}
                        title={
                          revisionsExhausted
                            ? `No rewrites left for this draft (${MAX_REVISIONS} of ${MAX_REVISIONS} used)`
                            : a.directive
                        }
                      >
                        <Icon name={REVISION_ICONS[a.id]} size="sm" />
                        {a.label}
                      </button>
                    ))}
                  </div>
                  <form
                    className={ex.aiPromptRow}
                    onSubmit={(e) => {
                      e.preventDefault();
                      revise(customPrompt, "custom");
                    }}
                  >
                    <span className={ex.aiPromptIcon} aria-hidden="true">
                      <Icon name="refresh" size="sm" />
                    </span>
                    <input
                      type="text"
                      className={ex.aiPromptInput}
                      placeholder={
                        revisionsExhausted
                          ? "No rewrites left for this draft"
                          : "Ask for a change"
                      }
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      disabled={revising || loading || revisionsExhausted}
                      maxLength={1000}
                      aria-label="Describe a custom revision"
                    />
                    <button
                      type="submit"
                      className={ex.aiPromptSend}
                      disabled={
                        revising || loading || revisionsExhausted || !customPrompt.trim()
                      }
                    >
                      {revising ? <span className={ex.spinner} /> : "Rewrite"}
                    </button>
                    <span
                      className={`${ex.reviseCounter}${
                        revisionsExhausted ? ` ${ex.reviseCounterMax}` : ""
                      }`}
                      aria-live="polite"
                    >
                      <span aria-hidden="true">
                        {revisionsLeft} left
                      </span>
                      <span className={ex.srOnly}>
                        {revisionsLeft} of {MAX_REVISIONS} rewrites left
                      </span>
                    </span>
                  </form>
                </div>
              </div>,
              document.body
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
