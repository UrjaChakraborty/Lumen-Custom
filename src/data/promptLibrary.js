// =====================================================================
// PROMPT LIBRARY
// Structured, versioned prompt templates for the four dashboard domains.
// Variables use {{double_brace}} tokens filled from the input schema.
// These same templates feed the mock engine and (optionally) a real LLM.
// =====================================================================

// Shared system prompt — the "constitution" every generation inherits.
export const systemPrompt = `You are an instructional co-designer for high school STEM teachers.
You design materials grounded in Culturally Responsive Pedagogy (CRP), Culturally
Sustaining Pedagogy (CSP), and Universal Design for Learning (UDL).

Non-negotiable rules:
1. Treat students' cultures, languages, and communities as ASSETS to build on,
   never deficits to fix. Never use deficit language (e.g. "struggling,"
   "low-level," "these kids can't").
2. Anchor abstract STEM concepts in the SPECIFIC community context provided.
   Be specific and respectful; never rely on cultural stereotypes or generic
   "diverse" filler.
3. Apply UDL: always offer multiple means of representation and multiple ways
   for students to demonstrate learning.
4. Honor accessibility constraints (reading level, language, low-tech/offline,
   neurodiverse supports) as stated.
5. Preserve rigor. Cultural relevance and accessibility never mean lowering
   expectations.
6. You are a drafting assistant. Remind the teacher to review for accuracy and
   fit. Never invent facts about a specific community you weren't given.`;

// Reusable variable glossary so the UI can show what feeds each prompt.
export const promptVariables = [
  { token: "{{subject}}", from: "Subject" },
  { token: "{{course}}", from: "Course" },
  { token: "{{grade}}", from: "Grade / level" },
  { token: "{{topic}}", from: "Topic / standard" },
  { token: "{{student_interests}}", from: "Student interests" },
  { token: "{{community_context}}", from: "Community context" },
  { token: "{{cultural_assets}}", from: "Cultural & linguistic assets" },
  { token: "{{reading_level}}", from: "Reading level" },
  { token: "{{language}}", from: "Language support" },
  { token: "{{resource_level}}", from: "Resource / tech level" },
  { token: "{{learning_needs}}", from: "Differentiation needs" },
];

export const promptLibrary = {
  lesson: {
    domain: "Lesson Planning",
    color: "primary",
    templates: [
      {
        id: "lesson-core",
        name: "Culturally Responsive Lesson Plan",
        purpose:
          "Full lesson anchored in community context with required CRP + UDL sections.",
        template: `Design a {{grade}} {{course}} lesson on "{{topic}}".

CLASS CONTEXT
- Student interests: {{student_interests}}
- Community context: {{community_context}}
- Cultural/linguistic assets: {{cultural_assets}}
- Reading level: {{reading_level}} | Language: {{language}} | Tech: {{resource_level}}
- Differentiation needs: {{learning_needs}}

Produce a lesson with EXACTLY these sections:
1. Lesson Title
2. Learning Objective (measurable, rigorous)
3. Cultural / Community Connection (specific to the context above, and explain the link)
4. Warm-Up / Hook (grounded in student interests or community)
5. Main Activity (multiple means of representation)
6. Differentiation Supports (for the stated reading levels & needs)
7. Accessibility Supports (reading level, language, {{low_tech}})
8. Assessment / Check for Understanding (multiple ways to show learning)
9. Teacher Reflection Question (about equity & fit)

Avoid deficit language. Keep rigor high.`,
      },
    ],
  },

  activity: {
    domain: "Pedagogy / Activity Design",
    color: "accent",
    templates: [
      {
        id: "activity-pbl",
        name: "Community-Connected PBL Task",
        purpose: "Authentic, often project-based activity tied to a community issue.",
        template: `Design a hands-on {{course}} activity on "{{topic}}" for {{grade}}.

Anchor it in an AUTHENTIC problem from this community: {{community_context}}.
Draw on student interests: {{student_interests}}.

Include:
- Driving question (real, community-relevant)
- Student roles / collaboration structure
- Step-by-step task (works at {{resource_level}} tech; give a {{low_tech}} path)
- Public product or share-out
- Multiple ways to participate (UDL action & expression)
- Materials list (note low-cost / no-cost options)

Keep it rigorous and standards-worthy. No stereotypes.`,
      },
    ],
  },

  assessment: {
    domain: "Assessment",
    color: "teal",
    templates: [
      {
        id: "assess-quiz",
        name: "Differentiated Quiz",
        purpose: "Quiz with tiered questions and multiple response options.",
        template: `Create a {{course}} quiz on "{{topic}}" for {{grade}}.
Provide 5-6 questions across DOK levels 1-3, tiered for a {{reading_level}} range.
For at least 2 questions, offer multiple response options (write / diagram / explain aloud).
Use contexts from: {{community_context}} / {{student_interests}}.
Language: {{language}}. Include an answer key with acceptable alternative responses.`,
      },
      {
        id: "assess-exit",
        name: "Exit Ticket",
        purpose: "Quick formative check with a low-tech option.",
        template: `Write a 3-question exit ticket on "{{topic}}" for {{grade}} {{course}}.
Q1 recall, Q2 application in a {{community_context}} context, Q3 metacognition
("What still feels unclear?"). Provide a {{low_tech}} paper version.`,
      },
      {
        id: "assess-rubric",
        name: "Project Rubric",
        purpose: "Rubric that values multiple modes of demonstrating mastery.",
        template: `Build a 4-level rubric for a {{course}} project on "{{topic}}".
Criteria must reward multiple valid ways to show mastery (UDL). Use asset-based,
growth-oriented level language (no "poor/fails"). Include a criterion for
connecting the work to community/context where appropriate.`,
      },
      {
        id: "assess-multimodal",
        name: "Alternative / Multimodal Assessment",
        purpose: "Non-traditional ways to demonstrate the same learning.",
        template: `Propose 3 alternative assessments for "{{topic}}" ({{grade}} {{course}}) that
measure the SAME objective through different modes (e.g. build/model, oral
explanation, visual, community interview). Each with a quick scoring guide.`,
      },
    ],
  },

  feedback: {
    domain: "Feedback",
    color: "rose",
    templates: [
      {
        id: "fb-strengths",
        name: "Strengths-Based Feedback",
        purpose: "Names what the student did well, specifically.",
        template: `Given this student work summary: {{work_summary}}
Write asset-based feedback for a {{grade}} student in {{course}}.
Lead with 2 specific strengths, then 1 concrete growth step framed positively.
No deficit language. Reading level: {{reading_level}}. Language: {{language}}.`,
      },
      {
        id: "fb-growth",
        name: "Growth-Oriented Feedback",
        purpose: "Actionable next step framed as growth.",
        template: `Turn this teacher note into growth-oriented feedback: {{work_summary}}.
Frame the next step as an achievable move ("Your next power move is…").
Keep it warm, specific, and free of deficit framing.`,
      },
      {
        id: "fb-reflection",
        name: "Student Reflection Prompt",
        purpose: "Prompts student self-assessment and agency.",
        template: `Write 3 student reflection prompts for "{{topic}}" that build agency and
metacognition, connecting learning to {{student_interests}} where natural.`,
      },
      {
        id: "fb-family",
        name: "Family-Friendly Feedback",
        purpose: "Plain-language note home, translatable, respectful.",
        template: `Write a short, warm message to a family about their student's progress on
"{{topic}}". Plain language, no jargon, asset-based. Provide it in {{language}}.
Assume it may be printed and sent home ({{low_tech}}).`,
      },
    ],
  },
};

// Revision actions — each carries a `directive`: a plain-language instruction
// passed to the model to REWRITE the whole resource (not append to it), so the
// result stays one cohesive document instead of a pile of patches.
// The moves teachers actually name when they ask a colleague for help with a
// plan. "Make more accessible" is a category; "add a scaffolded version for
// below-grade readers" is a request someone can act on.
export const revisionActions = [
  {
    id: "scaffold",
    label: "Add a scaffolded version",
    directive:
      "Rewrite the entire resource to add a scaffolded version for students reading below grade " +
      "level. Provide sentence frames, a vocabulary preview with student-friendly definitions, " +
      "worked examples, and directions broken into numbered steps. Keep the same learning " +
      "objective and the same rigor of the final task.",
  },
  {
    id: "subplan",
    label: "Write the sub plan",
    directive:
      "Rewrite the entire resource as a substitute teacher plan. Remove anything that requires " +
      "content expertise to deliver, replace it with directions a non-specialist can follow " +
      "exactly, and add seating and behavior notes, an attendance and materials checklist, and " +
      "a clear what-to-do-if-students-finish-early section. Keep it to one page.",
  },
  {
    id: "exitticket",
    label: "Add an exit ticket",
    directive:
      "Rewrite the entire resource to include a three question exit ticket at the end, with an " +
      "answer key. Question one checks recall, question two checks application, question three " +
      "asks what still feels unclear. Adjust the timing of the other sections so the total still " +
      "fits the period.",
  },
  {
    id: "shorten",
    label: "Shorten to 30 minutes",
    directive:
      "Rewrite the entire resource to fit a 30 minute period. Cut and combine activities rather " +
      "than rushing them, keep the learning objective intact, and update the minutes on every " +
      "section so they sum to 30.",
  },
  {
    id: "handout",
    label: "Make a student handout",
    directive:
      "Rewrite the entire resource as a student-facing handout. Remove teacher notes, answer keys, " +
      "pedagogical rationale, and timing. Keep only what a student reads and writes on, with clear " +
      "directions and space for responses.",
  },
  {
    id: "spanish",
    label: "Add a Spanish version",
    directive:
      "Rewrite the entire resource to include a Spanish version of all student-facing text " +
      "alongside the English. Keep teacher-facing notes in English. Highlight cognates where they " +
      "help, and keep both versions at the same reading level.",
  },
];
