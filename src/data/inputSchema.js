// Structured teacher-input schema.
// This is the single source of truth for the input form and the shape of
// data passed into every prompt template.

export const defaultInput = {
  // #40 Codes chosen from the local standards list, never typed from memory.
  standards: [],
  // --- Class Context ---
  subject: "",
  course: "",
  grade: "",
  topic: "",
  // --- Cultural & Community Anchors ---
  studentInterests: "",
  communityContext: "",
  culturalAssets: "",
  // --- Accessibility Supports ---
  readingLevel: "on-grade", // below-grade | on-grade | above-grade | mixed
  language: "English",
  neurodiverseSupport: false,
  lowTech: false,
  // --- Differentiation Options ---
  learningNeeds: [], // multi-select tags
  resourceLevel: "medium", // low | medium | high
  // --- What to generate ---
  outputType: "lesson", // lesson | activity | assessment | feedback
  assistanceLevel: "full", // minimal | collaborative | full
  customTasks: [], // Optional, explicit outputs that refine the assistance level
  // --- Timing and logistics (drive the timing table and grouping plan) ---
  periodLength: 50, // minutes; everything about pacing depends on this
  classSize: "", // determines grouping and materials counts
  lessonStructure: "", // 5e | gradual-release | hunter | workshop | ""
  lastClass: "", // one line on what students did last class
  unit: "",
  lessonDate: "",
};

export const fieldMeta = {
  subject: { label: "Subject", group: "context", placeholder: "e.g. Science, Mathematics" },
  course: { label: "Course", group: "context", placeholder: "e.g. Biology, Algebra I, AP Calculus" },
  grade: { label: "Grade / Level", group: "context", placeholder: "e.g. 9, 10-11" },
  topic: {
    label: "Topic / Standard",
    group: "context",
    placeholder: "e.g. Linear functions & slope",
  },
  studentInterests: {
    label: "Student interests",
    group: "anchors",
    placeholder: "e.g. music, sports, gaming, local food, family businesses",
    hint: "What are your students actually into? Be specific.",
  },
  communityContext: {
    label: "Community context",
    group: "anchors",
    placeholder:
      "e.g. rural agriculture town; urban neighborhood near a river; strong community clinic",
    hint: "The neighborhood, industries, institutions, and issues your students live in.",
  },
  culturalAssets: {
    label: "Cultural & linguistic assets",
    group: "anchors",
    placeholder: "e.g. bilingual (Spanish), multigenerational households, oral storytelling",
    hint: "Optional. Build on these, never treat them as something to fix.",
  },
};

export const readingLevels = [
  { value: "below-grade", label: "Below grade" },
  { value: "on-grade", label: "On grade" },
  { value: "above-grade", label: "Above grade" },
  { value: "mixed", label: "Mixed / wide range" },
];

export const resourceLevels = [
  { value: "low", label: "Low (little/no tech, printing)" },
  { value: "medium", label: "Medium (shared devices)" },
  { value: "high", label: "High (1:1 devices, wifi)" },
];

// Instructional models teachers were actually trained on. The draft follows the
// one they pick, using that model's own section names.
export const lessonStructures = [
  { value: "", label: "No preference" },
  { value: "5e", label: "5E (engage, explore, explain, elaborate, evaluate)" },
  { value: "gradual-release", label: "Gradual release (I do, we do, you do)" },
  { value: "hunter", label: "Madeline Hunter" },
  { value: "workshop", label: "Workshop model" },
];

// Grade is a picker, not free text: free text breaks standards lookup and
// reading-level targeting downstream.
export const gradeOptions = [
  { value: "9", label: "Grade 9" },
  { value: "10", label: "Grade 10" },
  { value: "11", label: "Grade 11" },
  { value: "12", label: "Grade 12" },
  { value: "9-10", label: "Grades 9-10" },
  { value: "10-11", label: "Grades 10-11" },
  { value: "11-12", label: "Grades 11-12" },
  { value: "9-12", label: "Grades 9-12" },
];

export const periodLengths = [
  { value: 40, label: "40 min" },
  { value: 45, label: "45 min" },
  { value: 50, label: "50 min" },
  { value: 55, label: "55 min" },
  { value: 60, label: "60 min" },
  { value: 85, label: "85 min (block)" },
  { value: 90, label: "90 min (block)" },
];

// "Neurodiverse supports" and "Low-tech / offline" deliberately do NOT appear
// here: they are dedicated boolean fields (neurodiverseSupport, lowTech) shown
// as their own toggles. Listing them in both places produced two controls for
// one setting that could disagree with each other.
export const learningNeedOptions = [
  "Multilingual",
  "Reading-level support",
  "Wide readiness range",
  "Multiple response options",
  "Project-based",
];

export const outputTypes = [
  { value: "lesson", label: "Lesson Plan", desc: "Full culturally responsive lesson" },
  { value: "activity", label: "Activity / PBL", desc: "Hands-on or project-based task" },
  { value: "assessment", label: "Assessment", desc: "Quiz, exit ticket, or rubric" },
  { value: "feedback", label: "Feedback", desc: "Asset-based student feedback" },
];
