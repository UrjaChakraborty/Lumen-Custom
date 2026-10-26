// Fixed eval set (#116): realistic teacher scenarios, including the edge cases
// that break things.
//
// Covers both subjects, all four resource types, and the inputs that actually
// go wrong in practice: empty cultural context, unusual grade bands, block
// periods, junk input, and text that should trip the PII screen.
//
// This set is fixed on purpose. Changing scenarios between runs makes scores
// incomparable, which defeats the point of running it before every prompt edit.

export const SCENARIOS = [
  // ── Core: the happy paths across both subjects and all four types ──────
  {
    id: "bio-lesson-standard",
    note: "Ordinary biology lesson with full context",
    input: {
      subject: "Science", course: "Biology", grade: "10", topic: "Photosynthesis",
      studentInterests: "cooking, gardening, basketball",
      communityContext: "Urban neighborhood with a community garden two blocks from school",
      readingLevel: "on-grade", resourceLevel: "medium", periodLength: 50,
      classSize: "28", outputType: "lesson",
    },
    expect: { standards: true, culturalConnection: true, minutesSum: 50 },
  },
  {
    id: "algebra-lesson-lowtech",
    note: "Maths lesson, no devices, wide readiness range",
    input: {
      subject: "Mathematics", course: "Algebra I", grade: "9", topic: "Systems of equations",
      studentInterests: "cars, music production",
      communityContext: "Rural town, farming economy, long bus rides",
      readingLevel: "mixed", resourceLevel: "low", lowTech: true,
      periodLength: 45, classSize: "22", outputType: "lesson",
    },
    expect: { standards: true, culturalConnection: true, minutesSum: 45 },
  },
  {
    id: "calc-activity",
    note: "Activity for AP Calculus",
    input: {
      subject: "Mathematics", course: "AP Calculus AB", grade: "11-12",
      topic: "Derivatives as rates of change",
      studentInterests: "track and field, video editing",
      communityContext: "Magnet school, students commute from across the city",
      readingLevel: "above-grade", resourceLevel: "high", periodLength: 85,
      classSize: "24", outputType: "activity",
    },
    expect: { standards: true, minutesSum: 85 },
  },
  {
    id: "chem-assessment-quiz",
    note: "Assessment, quiz format",
    input: {
      subject: "Science", course: "Chemistry", grade: "11", topic: "Chemical reactions",
      studentInterests: "cooking", communityContext: "Neighborhood with several family restaurants",
      readingLevel: "on-grade", resourceLevel: "medium", periodLength: 50,
      classSize: "30", outputType: "assessment", format: "quiz",
    },
    expect: { standards: true },
  },
  {
    id: "feedback-strengths",
    note: "Feedback, strengths-based",
    input: {
      subject: "Science", course: "Biology", grade: "10", topic: "Cell division",
      studentInterests: "art", communityContext: "Community health clinic nearby",
      readingLevel: "on-grade", outputType: "feedback", format: "strengths",
      periodLength: 50, classSize: "26",
    },
    expect: {},
  },

  // ── Edge: empty cultural context. THE case the product exists to get right.
  {
    id: "edge-no-cultural-context",
    note: "Both cultural fields empty. Must abstain, never infer.",
    input: {
      subject: "Science", course: "Biology", grade: "10", topic: "Photosynthesis",
      studentInterests: "", communityContext: "", culturalAssets: "",
      readingLevel: "on-grade", resourceLevel: "medium", periodLength: 50,
      classSize: "28", outputType: "lesson",
    },
    expect: { culturalConnection: false, needsMoreInfo: true },
  },

  // ── Edge: unusual grade band ───────────────────────────────────────────
  {
    id: "edge-wide-grade-band",
    note: "Grades 9-12 combined elective",
    input: {
      subject: "Science", course: "Environmental Science", grade: "9-12",
      topic: "Urban heat islands",
      studentInterests: "skateboarding, photography",
      communityContext: "Dense city neighborhood with little tree cover",
      readingLevel: "mixed", resourceLevel: "medium", periodLength: 50,
      classSize: "31", outputType: "lesson",
    },
    expect: { standards: true, minutesSum: 50 },
  },

  // ── Edge: block period ─────────────────────────────────────────────────
  {
    id: "edge-block-period",
    note: "90 minute block; timing must still reconcile",
    input: {
      subject: "Science", course: "Physics", grade: "11", topic: "Newton's second law",
      studentInterests: "car repair", communityContext: "Auto shop district",
      readingLevel: "on-grade", resourceLevel: "medium", periodLength: 90,
      classSize: "25", outputType: "lesson",
    },
    expect: { standards: true, minutesSum: 90 },
  },

  // ── Edge: topic with no standard in the dataset ────────────────────────
  {
    id: "edge-no-matching-standard",
    note: "Off-corpus topic. Must return no standard, not invent one.",
    input: {
      subject: "Science", course: "Astronomy", grade: "11", topic: "Exoplanet detection methods",
      studentInterests: "science fiction", communityContext: "Rural, dark skies, amateur astronomy club",
      readingLevel: "on-grade", resourceLevel: "medium", periodLength: 50,
      classSize: "20", outputType: "lesson",
    },
    expect: { standards: false },
  },

  // ── Edge: thin input ───────────────────────────────────────────────────
  {
    id: "edge-minimal-input",
    note: "Almost nothing given. Should abstain rather than fabricate.",
    input: { subject: "Science", topic: "Energy", outputType: "lesson", periodLength: 50 },
    expect: { needsMoreInfo: true, culturalConnection: false, missingFields: true },
  },

  // ── Edge: below-grade reading target ───────────────────────────────────
  {
    id: "edge-below-grade-reading",
    note: "Readability must land in the below-grade band",
    input: {
      subject: "Science", course: "Biology", grade: "9", topic: "Cells",
      studentInterests: "sports", communityContext: "Neighborhood rec center",
      readingLevel: "below-grade", resourceLevel: "low", periodLength: 50,
      classSize: "29", outputType: "lesson",
    },
    expect: { readabilityBand: [4, 8] },
  },

  // ── Edge: PII. Must never reach the model at all. ──────────────────────
  {
    id: "edge-pii-blocked",
    note: "Input names a student. The screen must block the send.",
    input: {
      subject: "Science", course: "Biology", grade: "10", topic: "Genetics",
      communityContext: "Marcus has an IEP and student 20481337 reads below level",
      readingLevel: "on-grade", periodLength: 50, outputType: "lesson",
    },
    expect: { piiBlocked: true },
  },

  // ── Edge: junk input ───────────────────────────────────────────────────
  {
    id: "edge-junk-input",
    note: "Garbage in the topic field. Should not crash or produce a confident lesson about nothing.",
    input: {
      subject: "sadfsd", course: "10", grade: "10", topic: "asdfgh",
      readingLevel: "on-grade", periodLength: 50, outputType: "lesson",
    },
    expect: { needsMoreInfo: true, junkFields: true, missingFields: true },
  },
];
