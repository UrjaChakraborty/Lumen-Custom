// =====================================================================
// Generation engine
// - By default: a deterministic, context-aware MOCK generator so the
//   prototype runs with zero setup or API cost. Outputs are structured,
//   sectioned documents.
// - The live path is api/generate.js, which calls Gemini server-side; the same
//   templates and input schema are reused.
// =====================================================================

import { promptLibrary, systemPrompt } from "../data/promptLibrary.js";

// ---- Template filling -------------------------------------------------
export function fillTemplate(template, input) {
  const map = {
    subject: input.subject || "STEM",
    course: input.course || "your course",
    grade: input.grade || "high school",
    topic: input.topic || "the topic",
    student_interests: relevantInterest(input) || "a topic-relevant example chosen by the teacher",
    community_context: input.communityContext || "their community",
    cultural_assets: input.culturalAssets || "students' cultural & linguistic assets",
    reading_level: readable(input.readingLevel),
    language: input.language || "English",
    resource_level: input.resourceLevel || "medium",
    learning_needs: (input.learningNeeds || []).join(", ") || "varied learner needs",
    low_tech: input.lowTech ? "provide a low-tech / offline path" : "device-based is fine",
    work_summary: input.workSummary || "the student's submitted work",
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] ?? `{{${k}}}`);
}

function readable(level) {
  return (
    {
      "below-grade": "below grade level",
      "on-grade": "on grade level",
      "above-grade": "above grade level",
      mixed: "a mixed / wide range",
    }[level] || "on grade level"
  );
}

// ---- Context helpers (make mock output feel specific) -----------------
function relevantInterest(input) {
  const topicWords = new Set(
    `${input.topic || ""} ${input.course || ""} ${input.subject || ""}`
      .toLowerCase()
      .match(/[a-z0-9]{4,}/g) || []
  );
  const interests = (input.studentInterests || "")
    .split(/,|;/)
    .map((value) => value.trim())
    .filter(Boolean);
  return interests.find((interest) =>
    (interest.toLowerCase().match(/[a-z0-9]{4,}/g) || []).some((word) => topicWords.has(word))
  ) || "";
}
function communityPhrase(input) {
  const c = (input.communityContext || "").trim();
  if (!c) return "a relevant real-world context";
  // Trim to a usable clause.
  return c.replace(/\.$/, "");
}
function langNote(input) {
  const l = (input.language || "English").toLowerCase();
  if (l.includes("+") || (!l.includes("english") && l.length)) {
    return `Key terms and directions are provided in ${input.language}; sentence frames support multilingual learners.`;
  }
  return "Sentence frames and a bilingual key can be added on request.";
}
function readingNote(input) {
  return {
    "below-grade":
      "Text is chunked into short segments with a vocabulary preview and visuals for every key term.",
    "on-grade": "Text is on grade level with optional extension vocabulary.",
    "above-grade":
      "Includes extension prompts and primary-source style excerpts for depth.",
    mixed:
      "Offered in two reading versions (core + scaffolded) so a wide readiness range accesses the same concept.",
  }[input.readingLevel];
}
function lowTechNote(input) {
  return input.lowTech || input.resourceLevel === "low"
    ? "A fully printable, no-device version is included (paper handout + manipulatives)."
    : "Digital version uses shared or 1:1 devices; a printable fallback is available.";
}

// ---- Generators -------------------------------------------------------
// Each returns { title, meta, sections: [{label, body}] } — body is a
// string or array (rendered as list).

// The offline engine mirrors the live schema block for block. If it did not,
// a teacher on the fallback path would silently get a document missing the
// materials list and the misconceptions, and would have no way to know why.
function mockBlocks(input, topic, place) {
  const size = Number(input.classSize) || 30;
  return {
    materials: {
      print: [
        `Student handout, ${size} copies`,
        `Exit ticket, ${size} copies`,
        "One answer key for yourself",
      ],
      gather: ["Chart paper or whiteboard space", "Markers for each group"],
      setup: ["Arrange desks in groups of 3 to 4 before the bell", "Write the objective on the board"],
    },
    vocabulary: [
      {
        term: topic,
        definition: `The core idea of this lesson, stated in student-friendly language.`,
        cognate: "",
        frame: `${topic} matters here because ___.`,
      },
    ],
    misconceptions: [
      {
        misconception: `Students often treat ${topic.toLowerCase()} as a formula to memorise rather than a relationship to reason about.`,
        response: "Ask them to explain the idea using a case from their own context before any notation appears.",
      },
    ],
    differentiation: {
      below: ["Provide the worked first step and a sentence frame for the explanation."],
      on: ["Students complete the task and justify their reasoning in writing."],
      above: ["Students construct a second case and compare the two."],
      accommodations: [
        "Extended time on the written explanation",
        "Response may be given orally or in writing",
      ],
    },
    // #57 Tagged the same way the live path tags them, with real CAST ids, so
    // the offline draft is not quietly missing the citations.
    accessibilitySupports: [
      {
        text: "Key terms are previewed with a visual and a sentence frame before the task.",
        checkpoint: { id: "2.1", principle: "Representation", text: "Clarify vocabulary and symbols" },
      },
      {
        text: "Students may answer in writing, out loud, or with a diagram.",
        checkpoint: {
          id: "5.1",
          principle: "Action and expression",
          text: "Use multiple media for communication",
        },
      },
      {
        text: "A visible agenda and a step checklist keep the sequence predictable.",
        checkpoint: {
          id: "6.2",
          principle: "Action and expression",
          text: "Support planning and strategy development",
        },
      },
    ],
    safety: [],
    familyBlurb: `This week we are studying ${topic.toLowerCase()} and connecting it to ${place}. Ask your student to explain one example they found.`,
    sources: [
      "This draft contains no external data. Any figures you add should be checked against a current source.",
    ],
    // #71 The arithmetic is stated rather than left as "small groups", because
    // the arithmetic is the part a teacher has to do at 7am otherwise.
    grouping: {
      formation: `With ${size} students, form ${Math.ceil(size / 3)} groups of 3. If the number does not divide evenly, make the last group a 4 rather than a 2, so nobody works alone.`,
      roles: [
        { role: "Recorder", does: "Writes the group's reasoning where everyone can see it." },
        { role: "Checker", does: "Asks how do we know that after every claim." },
        { role: "Reporter", does: "Explains the group's thinking to the class." },
      ],
    },
    // #69 Its own printable, with its own key.
    exitTicket: {
      prompt: `Answer on your own. This is not graded for correctness.`,
      questions: [
        `In one sentence, what is ${topic.toLowerCase()}?`,
        `Give one example of ${topic.toLowerCase()} from ${place}.`,
        `What still feels unclear?`,
      ],
      key: [
        `Any student-worded definition that captures the core relationship, not just a formula.`,
        `Any example that is genuinely local. Accept anything they can justify.`,
        `No wrong answer. Use these to plan tomorrow's opening.`,
      ],
      minutes: 5,
    },
    // #70 Task plus one extension.
    homework: {
      task: `Find one example of ${topic.toLowerCase()} outside school and write two sentences about it.`,
      extension: `Explain what would change about your example if one variable were doubled.`,
    },
    // #67 Teacher copy only.
    answerKey: [
      {
        question: `Where have you seen ${topic.toLowerCase()} show up in ${place}?`,
        answer: "Accept any grounded example. This is a surfacing question, not a graded one.",
        work: "",
      },
      {
        question: `Model or solve the ${place} problem from the main activity.`,
        answer: "Answers vary with the data students bring. Check the reasoning, not the number.",
        work: "",
      },
    ],
  };
}

export function generateLesson(input) {
  const interest = relevantInterest(input);
  const place = communityPhrase(input);
  const topic = input.topic || "the topic";
  return {
    kind: "lesson",
    ...mockBlocks(input, topic, place),
    title: `${topic}: ${input.course || input.subject || "STEM"} Lesson`,
    meta: [`${input.grade || "HS"} · ${input.course || input.subject}`, `${input.topic || "Draft"}`],
    sections: [
      {
        label: "Learning objective",
        minutes: 2,
        audience: "both",
        body: `Students will be able to explain ${topic.toLowerCase()}, apply it to a new example, and justify their reasoning with relevant evidence. (Rigor preserved: analysis and application beyond recall.)`,
      },
      {
        label: "Cultural and community connection",
        audience: "both",
        body: input.communityContext || input.culturalAssets
          ? `Use the provided context as an optional, authentic point of connection to ${topic.toLowerCase()}: ${[input.communityContext, input.culturalAssets].filter(Boolean).join("; ")}. Invite students to contribute or decline personal connections; do not assume the context describes every learner.`
          : `No specific community context was provided. Keep examples anchored in ${topic.toLowerCase()} and invite students to choose a familiar context without assuming which one fits.`,
      },
      {
        label: "Warm-up and hook",
        minutes: 5,
        audience: "both",
        body: interest
          ? `Introduce ${topic.toLowerCase()} with a short prompt connected to the student interest "${interest}" because it directly relates to the concept. Students may instead use a topic-based example.`
          : `Open with a topic-first prompt: "What do you already know about ${topic.toLowerCase()}, and what would you need to observe or measure to explain it?" Do not force an unrelated student interest into the example.`,
        steps: [
          {
            teacher: `Display the prompt and ask students to write or sketch an initial idea. Give quiet think time before inviting discussion.`,
            students: `Write or sketch a first response and mark one part they are unsure about.`,
          },
          {
            teacher: `Collect a few different starting ideas. Record them neutrally and note what evidence could distinguish them.`,
            students: `Compare interpretations with a partner; sharing aloud is optional.`,
          },
        ],
      },
      {
        label: "Prior knowledge and key concept",
        audience: "teacher",
        body: [
          `Before teaching, identify the prerequisite ideas students need for ${topic.toLowerCase()}; surface gaps with the warm-up rather than assuming them.`,
          `State the central concept in precise, student-ready language, then distinguish it from a likely misconception.`,
          `Key question: What evidence would help students tell a reasonable explanation from a guess?`,
        ],
      },
      {
        label: "Explicit instruction and model",
        minutes: 8,
        audience: "both",
        body: [
          `Name the learning goal and define the essential terms students need to use when explaining ${topic.toLowerCase()}.`,
          `Model one representative example step by step. Think aloud about why each step is valid, what evidence is being used, and how to check the result.`,
          `Pause after the model and ask: "Which step changed your understanding, and what evidence supports that step?"`,
        ],
      },
      {
        label: "Guided practice",
        minutes: 12,
        audience: "both",
        body: [
          `Work through a second example with the class, gradually releasing responsibility: teacher models the first decision, class makes the next, and partners justify the final step.`,
          `Check for understanding by asking students to explain their reasoning, not only give an answer. Listen for whether they connect evidence to the concept.`,
          `If students are unsure, return to the model and compare one step at a time; if they are ready, ask them to explain why a plausible alternative does not fit.`,
        ],
        steps: [
          { teacher: "Present a related example and ask students to predict the next step before revealing it.", students: "Make a prediction and cite the clue or evidence they used." },
          { teacher: "Invite students to complete the next step, then ask a learner to explain the reasoning.", students: "Solve, annotate, or explain the step using a chosen representation." },
          { teacher: "Compare responses and address a misconception with a counterexample.", students: "Revise their explanation and note what changed their thinking." },
        ],
      },
      {
        label: "Main activity",
        minutes: 15,
        audience: "both",
        steps: [
          {
            teacher: `Introduce the task, show the expected product, and make the success criteria visible.`,
            students: `Restate the task and choose a role or response format.`,
          },
          {
            teacher: `Circulate with a prompt: "What evidence supports that decision?" Offer the scaffold in the differentiation notes when needed.`,
            students: `Investigate ${topic.toLowerCase()} using the supplied information; record evidence and explain the link to the concept.`,
          },
          {
            teacher: `Invite contrasting approaches and ask students to compare their reasoning against the success criteria.`,
            students: `Share a model, written explanation, calculation, or oral account; revise if new evidence changes their thinking.`,
          },
        ],
        body: [
          `Task: apply ${topic.toLowerCase()} to the provided example or material. Identify the relevant evidence, make a claim or solution, and explain the reasoning.`,
          `Expected product: a worked response, annotated model, diagram, or short explanation that makes the reasoning visible.`,
          `Success criteria: the response uses the central concept accurately, supports its claim with relevant evidence, and explains the connection.`,
          `Offer written, visual, and oral ways to represent the same learning goal; do not require personal or community disclosure.`,
        ],
      },
      {
        label: "Independent practice and transfer",
        minutes: 5,
        audience: "both",
        body: [
          `Give students a new, short example of ${topic.toLowerCase()} that differs from the modeled example.`,
          `Ask each student to solve or explain it independently, then identify which part of the model they used and what they had to adapt.`,
        ],
      },
      {
        label: "Differentiation supports",
        audience: "teacher",
        body: [
          readingNote(input),
          (input.learningNeeds || []).includes("Wide readiness range")
            ? "Tiered task cards: an entry version, a core version, and a challenge extension. Same concept, different scaffolding."
            : "Optional challenge extension for students ready to go deeper.",
          "Students choose their grouping and product format where possible (agency).",
        ],
      },
      {
        label: "Accessibility supports",
        audience: "teacher",
        body: [langNote(input), lowTechNote(input),
          input.neurodiverseSupport
            ? "Predictable structure, visual timer, and a step checklist support neurodiverse learners; movement break built in."
            : "Clear step-by-step directions and a visual agenda.",
        ],
      },
      {
        label: "Assessment and check for understanding",
        minutes: 5,
        audience: "both",
        body: [
          `Use these questions to check understanding of ${topic.toLowerCase()}; choose the ones that fit the time and objective.`,
          `1. In your own words, what is the central idea behind ${topic.toLowerCase()}?`,
          `2. Which piece of evidence in today's example mattered most, and why?`,
          `3. Apply the idea to a new example. What would you do first, and why?`,
          `4. What is one plausible mistake someone might make, and how would you correct it?`,
          `5. What question remains, or what additional evidence would you want?`,
          `Accept a written response, diagram/model, or brief oral explanation against the same success criteria.`,
        ],
      },
      {
        label: "Teacher reflection (optional)",
        audience: "teacher",
        body: `Which student responses provide evidence that the learning objective was met? What should be retaught, extended, or adjusted next time?`,
      },
    ],
  };
}

function applyLessonAssistance(output, input) {
  const topic = input.topic || "your topic";
  const interest = relevantInterest(input);
  const place = communityPhrase(input);
  const standards = (input.standards || []).map((standard) => `Connect the lesson to ${standard}.`);
  const standardsIdeas = standards.length
    ? standards
    : ["Choose a relevant standard to connect these ideas to."];

  if (input.assistanceLevel === "minimal") {
    return {
      kind: "lesson",
      title: `Ideas for ${topic}`,
      meta: output.meta,
      standards: input.standards || [],
      sections: [
        {
          label: "Brainstorm ideas",
          audience: "teacher",
          body: [
            `Identify a real example of ${topic} that students can analyze using evidence.`,
            ...(interest ? [`A possible familiar entry point is ${interest}, because it directly relates to the topic.`] : []),
            `Invite students to bring examples from their own experience.`,
          ],
        },
        {
          label: "Standards connections",
          audience: "teacher",
          body: standardsIdeas,
        },
      ],
    };
  }

  if (input.assistanceLevel === "collaborative") {
    const objective = output.sections.find((section) => section.label === "Learning objective");
    const activity = output.sections.find((section) => section.label === "Main activity");
    const differentiation = output.sections.find(
      (section) => section.label === "Differentiation supports"
    );
    const assessment = output.sections.find(
      (section) => section.label === "Assessment and check for understanding"
    );

    return {
      kind: output.kind,
      title: output.title,
      meta: output.meta,
      standards: input.standards || [],
      sections: [
        {
          label: "Lesson outline",
          audience: "teacher",
          body: [
            objective?.body,
            "Sequence the lesson: surface prior thinking, model the key concept, practice with support, apply it independently, and check understanding.",
            "Add examples, teacher directions, expected student responses, and timing that fit your class.",
          ].filter(Boolean),
        },
        {
          label: "Activity ideas",
          audience: "teacher",
          body: activity?.body || [],
        },
        {
          label: "Differentiation suggestions",
          audience: "teacher",
          body: differentiation?.body || [],
        },
        {
          label: "Assessment ideas",
          audience: "teacher",
          body: assessment?.body || "",
        },
        {
          label: "Standards connections",
          audience: "teacher",
          body: standardsIdeas,
        },
      ],
    };
  }

  return output;
}

function applyResourceAssistance(output, input) {
  const topic = input.topic || "the topic";
  const interest = relevantInterest(input);
  const place = communityPhrase(input);
  const standards = (input.standards || []).map((standard) => `Connect this resource to ${standard}.`);
  const standardsIdeas = standards.length
    ? standards
    : ["Choose a relevant standard to connect these ideas to."];

  if (input.assistanceLevel === "minimal" && !(input.customTasks || []).includes("discussionQuestions")) {
    return {
      ...output,
      title: `Ideas for ${topic}`,
      standards: input.standards || [],
      sections: [
        {
          label: "Brainstorm ideas",
          audience: "teacher",
          body: [
            `Identify a concrete example or question about ${topic} that students can investigate.`,
            ...(interest ? [`Use ${interest} as an optional entry point because it directly relates to the topic.`] : []),
            "Invite learners to contribute examples from their own experience.",
          ],
        },
        { label: "Standards connections", audience: "teacher", body: standardsIdeas },
      ],
    };
  }

  if (input.assistanceLevel === "collaborative") {
    return {
      ...output,
      standards: input.standards || [],
      sections: [
        {
          label: "Resource outline",
          audience: "teacher",
          body: [
            `Focus: ${topic} for ${input.grade || "the selected grade"} ${input.course || input.subject || "class"}.`,
            `Sequence: activate relevant prior knowledge, introduce the key concept, practice with support, apply it, and check understanding.`,
            ...(interest ? [`${interest} may be a useful optional example because it directly relates to this topic.`] : []),
            "Add topic-specific examples, student directions, expected responses, and timing.",
          ],
        },
        {
          label: "Activity ideas",
          audience: "teacher",
          body: [
            `Explore ${topic} through a task with a clear product and criteria for a strong response.`,
            `Ask learners to support their conclusions with evidence from the task.`,
          ],
        },
        {
          label: "Differentiation suggestions",
          audience: "teacher",
          body: [
            `Offer visual and written directions${input.lowTech ? ", including a no-device option" : ""}.`,
            `Use ${input.language || "English"} language supports and let learners choose how to share.`,
          ],
        },
        {
          label: "Assessment ideas",
          audience: "teacher",
          body: [
            `Ask learners to explain the central idea of ${topic} and apply it to a new example.`,
            "Use 3-5 questions that progress from understanding to application and reasoning.",
            "Accept a written response, diagram, or brief oral explanation against the same criteria.",
          ],
        },
        { label: "Standards connections", audience: "teacher", body: standardsIdeas },
      ],
    };
  }

  return output;
}

function applyCustomTasks(output, input) {
  const tasks = input.customTasks || [];
  if (!tasks.length) return null;
  if (tasks.includes("completeLesson")) return output;

  const topic = input.topic || "the topic";
  const place = communityPhrase(input);
  const interest = relevantInterest(input);
  const findSection = (pattern) =>
    output.sections.find((section) => pattern.test(section.label || ""));
  const bodyOf = (section, fallback) => section?.body || fallback;
  const sections = [];

  for (const task of tasks) {
    if (task === "brainstormIdeas") {
      sections.push({
        label: "Brainstorm ideas",
        audience: "teacher",
        body: [
          `Explore a concrete example of ${topic} using evidence and student reasoning.`,
          ...(interest ? [`Use ${interest} as an optional example because it directly relates to the topic.`] : []),
          "Invite learners to suggest other examples; do not assume a personal interest or experience.",
        ],
      });
    } else if (task === "lessonOutline") {
      const objective = findSection(/objective|overview/i);
      sections.push({
        label: "Lesson outline",
        audience: "teacher",
        body: [
          bodyOf(objective, `Focus the lesson on explaining and applying ${topic} with relevant evidence.`),
          "Add your own sequence, examples, and teacher directions.",
        ],
      });
    } else if (task === "draftActivities") {
      const activity = findSection(/main activity|activity|task|step/i);
      sections.push({
        label: "Activity ideas",
        audience: "teacher",
        body: bodyOf(activity, [
          `Explore ${topic} through a concrete task with a visible product and success criteria.`,
          `Ask learners to support their ideas with evidence and explain their reasoning.`,
        ]),
      });
    } else if (task === "discussionQuestions") {
      continue;
    } else if (task === "differentiationStrategies") {
      const differentiation =
        output.differentiation &&
        Object.values(output.differentiation).flat().filter(Boolean);
      const section = findSection(/differentiation|accessibility|support/i);
      sections.push({
        label: "Differentiation strategies",
        audience: "teacher",
        body: section?.body || differentiation || [
          `Offer visual and written directions for exploring ${topic}.`,
          `Provide language supports in ${input.language || "English"} and more than one way to share learning.`,
        ],
      });
    } else if (task === "draftAssessment") {
      const assessment = findSection(/assessment|question|exit|rubric|check/i);
      sections.push({
        label: "Assessment draft",
        audience: "teacher",
        body: bodyOf(assessment, [
          `Ask learners to explain one connection between ${topic} and ${place}.`,
          "Accept a written response, diagram, or brief oral explanation.",
        ]),
      });
    }
  }

  if (!sections.length) {
    sections.push({
      label: "Question focus",
      audience: "teacher",
      body: `Use the questions below to explore ${topic} at the selected grade and course level.`,
    });
  }

  return {
    kind: output.kind,
    title: output.title,
    meta: output.meta,
    standards: input.standards || [],
    sections,
  };
}

function discussionQuestionsFor(input) {
  const include =
    input.assistanceLevel === "collaborative" ||
    input.assistanceLevel === "full" ||
    (input.customTasks || []).includes("discussionQuestions");
  if (!include) return undefined;

  const topic = input.topic || input.course || input.subject || "this topic";
  const place = String(input.communityContext || "").trim().replace(/\.$/, "");
  const interest = relevantInterest(input);
  const tasks = input.customTasks || [];
  const questions = [];
  if (tasks.includes("brainstormIdeas")) {
    questions.push(`Which idea about ${topic} would be most meaningful to explore, and what makes you think so?`);
  }
  if (tasks.includes("lessonOutline")) {
    questions.push(`What should students be able to explain about ${topic} by the end of this resource?`);
  }
  if (tasks.includes("draftActivities")) {
    questions.push(`What example, observation, or evidence could help you investigate ${topic}?`);
  }
  if (tasks.includes("differentiationStrategies")) {
    questions.push(`What different ways could you use to make sense of ${topic} and share your thinking?`);
  }
  if (tasks.includes("draftAssessment")) {
    questions.push(`What evidence would show that you understand ${topic}?`);
  }
  questions.push(
    `What is the most important idea about ${topic}, and how would you explain it to someone else?`,
    `What evidence or example best supports an explanation of ${topic}?`,
    `How would you apply ${topic} to a new example that we have not discussed yet?`,
    `What is one plausible mistake about ${topic}, and how could you identify or correct it?`
  );
  if (place) {
    questions.push(`If useful, how could the provided context (${place}) help you investigate ${topic}?`);
  }
  if (interest) {
    questions.push(`How does ${interest} help illustrate ${topic}, and where does that comparison stop being useful?`);
  }
  return [...new Set(questions)].slice(0, 6);
}

export function generateActivity(input) {
  const place = communityPhrase(input);
  const topic = input.topic || "the topic";
  const interest = relevantInterest(input);
  const context = String(input.communityContext || "").trim();
  return {
    kind: "activity",
    title: context
      ? `${capitalize(place)} Challenge: Applying ${topic}`
      : `Applying ${topic}: Classroom Activity`,
    meta: [`${input.grade || "HS"} · ${input.course || input.subject}`, "Project-based"],
    sections: [
      {
        label: "Driving question",
        body: context
          ? `How can we use ${topic.toLowerCase()} to understand or respond to the provided context: ${context}?`
          : `What can ${topic.toLowerCase()} help us explain, and what evidence from the activity would support an answer?`,
      },
      {
        label: "The task",
        body: [
          context
            ? `Use the provided context as an optional case for investigating ${topic.toLowerCase()}; do not assume it represents every learner.`
            : `Use the example, data, or materials supplied by the teacher to investigate ${topic.toLowerCase()}.`,
          ...(interest ? [`The teacher may offer ${interest} as an optional example because it directly relates to the topic.`] : []),
          "Students identify relevant evidence and explain how it supports their reasoning.",
          `They build a model, recommendation, or design that applies the concept.`,
          `They present to an authentic audience (class, family night, or community partner).`,
        ],
      },
      {
        label: "Student roles (collaboration)",
        body: ["Data lead", "Design/build lead", "Communication & storytelling lead", "Community-connection lead"],
      },
      {
        label: "Multiple ways to participate (UDL)",
        body: `Students can take part by building, calculating, writing, designing visuals, or explaining out loud, and every role reaches the same objective.`,
      },
      {
        label: "Low tech resource path",
        body: lowTechNote(input) + " Materials favor low-cost or no-cost options; a paper-and-manipulatives version fully replaces the digital one.",
      },
      {
        label: "Public product",
        body: `A short pitch + artifact (poster, model, slide, or recorded explanation) shared with a real audience so the work matters beyond a grade.`,
      },
    ],
  };
}

export function generateAssessment(input, format = "quiz") {
  const place = communityPhrase(input);
  const topic = input.topic || "the topic";
  const context = String(input.communityContext || "").trim();
  const base = {
    kind: "assessment",
    meta: [`${input.grade || "HS"} · ${input.course || input.subject}`, `Format: ${format}`],
  };
  if (format === "exit") {
    return {
      ...base,
      title: `Exit Ticket: ${topic}`,
      sections: [
        { label: "Q1 · Recall", body: `Define or state one key idea about ${topic.toLowerCase()}.` },
        { label: "Q2 · Apply", body: context
          ? `Apply ${topic.toLowerCase()} to the context provided: ${context}.`
          : `Apply ${topic.toLowerCase()} to a new example and explain which evidence supports your answer.` },
        { label: "Q3 · Metacognition", body: `What still feels unclear about ${topic.toLowerCase()}? What would help?` },
        { label: "Low-Tech Version", body: "Provided as a quarter-page paper slip; no device required." },
      ],
    };
  }
  if (format === "rubric") {
    return {
      ...base,
      title: `Project Rubric: ${topic}`,
      sections: [
        { label: "Concept mastery", body: "Four levels: Emerging, Developing, Proficient, then Extending. Each level describes what the student can do." },
        { label: "Application to context", body: `Rewards authentic connection of ${topic.toLowerCase()} to ${place}.` },
        { label: "Communication", body: "Multiple valid modes accepted: written, visual, oral, or built (UDL)." },
        { label: "Collaboration and agency", body: "Credits student ownership, role contribution, and reflection." },
      ],
    };
  }
  if (format === "multimodal") {
    return {
      ...base,
      title: `Alternative Assessments: ${topic}`,
      sections: [
        { label: "Option A · Build / Model", body: `Construct a physical or digital model demonstrating ${topic.toLowerCase()}.` },
        { label: "Option B · Explain Aloud", body: `Record or deliver a 2-minute explanation using a new example of ${topic.toLowerCase()}.` },
        { label: "Option C · Analyze an example", body: `Analyze a teacher-provided example of ${topic.toLowerCase()} and explain what it shows.` },
        { label: "Shared scoring guide", body: "All three options are scored against the same objective and rubric." },
      ],
    };
  }
  // default: quiz
  return {
    ...base,
    title: `Differentiated Quiz: ${topic}`,
    sections: [
      { label: "Q1 (DOK 1)", body: `Identify/define a core term in ${topic.toLowerCase()}.` },
      { label: "Q2 (DOK 2)", body: `Solve a straightforward problem using ${topic.toLowerCase()}.` },
      { label: "Q3 (DOK 2) · apply", body: context
        ? `Apply the concept to the provided context and cite relevant evidence.`
        : `Apply the concept to a new example and explain your reasoning.` },
      { label: "Q4 (DOK 3) · choice", body: `Justify your reasoning. Respond in writing, with a diagram, or by recording an explanation.` },
      { label: "Q5 (DOK 3) · extension", body: `Predict or critique a new case using evidence; explain what additional information would strengthen your conclusion.` },
      { label: "Answer key & Alternatives", body: "Includes acceptable alternative responses so multiple valid approaches earn credit." },
      { label: "Access Notes", body: [readingNote(input), langNote(input)] },
    ],
  };
}

export function generateFeedback(input, format = "strengths") {
  const topic = input.topic || "this work";
  const work = input.workSummary || `the student's work on ${topic.toLowerCase()}`;
  const templates = {
    strengths: {
      title: "Strengths-Based Feedback",
      sections: [
        { label: "What you did well", body: `You showed your thinking clearly on ${topic.toLowerCase()}, especially the way you connected it to your own example. Your effort to explain your reasoning stands out.` },
        { label: "Your next power move", body: `Try extending one idea a step further: add a second example or check your reasoning against a real ${communityPhrase(input)} case. You're closer than you think.` },
        { label: "Tone check", body: "Warm, specific, zero deficit language. Reading level & language matched to the student." },
      ],
    },
    growth: {
      title: "Growth-Oriented Feedback",
      sections: [
        { label: "You're building", body: `Based on ${work}, you've got the foundation of ${topic.toLowerCase()} in place.` },
        { label: "Next step", body: "Your next move is one concrete, achievable action, framed as growth rather than correction." },
      ],
    },
    reflection: {
      title: "Student Reflection prompts",
      sections: [
        { label: "Prompt 1", body: `What part of ${topic.toLowerCase()} clicked for you, and what helped it click?` },
        { label: "Prompt 2", body: `Where did you get stuck, and what did you try?` },
        { label: "Prompt 3", body: `Which example helped you understand ${topic.toLowerCase()} best, and what made it useful?` },
      ],
    },
    family: {
      title: "Family-Friendly Note",
      sections: [
        { label: "Message home", body: `Your student is doing meaningful work in ${input.course || "class"} on ${topic.toLowerCase()}. They showed real strength recently and have a clear next step we're supporting. Thank you for all you do at home.` },
        { label: "Language & format", body: `${langNote(input)} Formatted to print and send home.` },
      ],
    },
  };
  return { kind: "feedback", meta: [`${input.grade || "HS"} · ${input.course || ""}`, format], ...templates[format] };
}

// ---- Revision (cohesive rewrite fallback) ----------------------------
// Used when the live /api/revise (Gemini) route is unavailable. Unlike the old
// "append a card" behavior, this rewrites the document in place — editing the
// relevant sections and title — so the result reads as one cohesive draft, the
// same promise the live path makes.
export function reviseMock(current, input, directive, actionId) {
  const doc = structuredClone(current);
  delete doc._source;
  doc.sections = doc.sections.map((s) => {
    const { _revised, ...rest } = s;
    return rest;
  });

  // Replace the body of the first section whose label matches any keyword; if
  // none match, prepend a new section so the change is still visible.
  const rewrite = (keywords, label, body) => {
    const idx = doc.sections.findIndex((s) =>
      keywords.some((k) => (s.label || "").toLowerCase().includes(k))
    );
    if (idx >= 0) doc.sections[idx] = { label: doc.sections[idx].label, body };
    else doc.sections.unshift({ label, body });
  };

  switch (actionId) {
    case "accessible":
      rewrite(
        ["accessib", "differ", "support"],
        "Accessibility supports",
        [
          "Language is simplified to the stated reading level with a vocabulary preview for every key term.",
          "Each direction is a short, numbered step, paired with a visual or diagram.",
          "Sentence frames scaffold discussion and writing so every student can enter the task.",
        ]
      );
      break;
    case "pbl":
      rewrite(
        ["main activity", "activity", "task"],
        "Main activity: Community Project",
        [
          `Teams take on an authentic ${communityPhrase(input)} problem connected to ${input.topic || "the concept"}.`,
          "They investigate, build a model or recommendation, and present to a real audience.",
          "Timeline, materials, and the assessment below are all reframed around this project.",
        ]
      );
      break;
    case "lowtech":
      rewrite(
        ["accessib", "resource", "low-tech", "tech"],
        "Low-Tech / Offline Path",
        "The whole resource runs without devices: paper handouts, printed data sets, and simple manipulatives replace every digital step. Nothing requires wifi."
      );
      break;
    case "multilingual":
      rewrite(
        ["accessib", "language", "support"],
        "Multilingual Support",
        `Key terms, directions, and sentence frames are provided in ${
          input.language && input.language !== "English" ? input.language : "students' home languages"
        }, with cognates highlighted and bilingual pairings woven through each section.`
      );
      break;
    case "cultural":
      rewrite(
        ["cultural", "community", "connection"],
        "Cultural and community connection",
        `Every example is re-grounded specifically in ${communityPhrase(input)} and student interests (${
          input.studentInterests || "student-named topics"
        }), so nothing reads as generic or stereotyped.`
      );
      break;
    default: {
      // Custom directive — weave an acknowledgement into the opening section so
      // the rewrite is cohesive rather than a tacked-on card.
      const note = `Revised per your request: ${String(directive || "").trim()}`;
      if (doc.sections.length) {
        const first = doc.sections[0];
        const prefix = Array.isArray(first.body) ? [note, ...first.body] : `${note}\n\n${first.body}`;
        doc.sections[0] = { label: first.label, body: prefix };
      }
      break;
    }
  }

  return doc;
}

// ---- CRP / UDL review checklist --------------------------------------
// #80/#105 Bias and fit review, with each finding anchored to the section it is
// about.
//
// The review used to return five document-level verdicts, so a teacher reading
// "add choice in how students respond" had to work out for themselves which of
// eight sections was the problem. Each check now reports WHERE it looked, and
// the results page renders the flag in the margin beside that section.
//
// This runs on the finished document only. It has no access to the drafting
// rationale, which is the point of #105: a reviewer that can read the writer's
// reasoning ends up grading the intention rather than the output.

const DEFICIT_WORDS = [
  "struggling",
  "low-level",
  "slow learner",
  "at-risk",
  "deficient",
  "poor students",
  "these kids",
  "low ability",
  "unmotivated",
];

// Everything the teacher would actually read in a section, flattened.
function sectionText(s) {
  const parts = [String(s?.label || ""), Array.isArray(s?.body) ? s.body.join(" ") : String(s?.body || "")];
  for (const st of s?.steps || []) parts.push(st.teacher, st.students);
  return parts.join(" ").toLowerCase();
}

// Finds the first section whose text matches, so a flag can point somewhere.
// Returns null rather than guessing when nothing matches: a flag pinned to the
// wrong paragraph is worse than one pinned to the document.
function findSection(sections, test) {
  const i = (sections || []).findIndex((s) => test(sectionText(s), s));
  return i === -1 ? null : i;
}

export function runReview(output, input) {
  const sections = output?.sections || [];
  const whole = sections.map(sectionText).join(" ");
  const hasContext = Boolean(String(input?.communityContext || "").trim());

  // Deficit language anchors to the section that actually contains it.
  let deficitWord = null;
  const deficitAt = findSection(sections, (t) => {
    const hit = DEFICIT_WORDS.find((w) => t.includes(w));
    if (hit) deficitWord = hit;
    return Boolean(hit);
  });

  const multiModeAt = findSection(sections, (t) =>
    /multiple|choice|diagram|aloud|record|option|visual|either/.test(t)
  );
  const hasMultiMode = multiModeAt !== null;

  const accessAt = findSection(sections, (t) =>
    /accessib|reading level|sentence frame|printable|low.tech|scaffold/.test(t)
  );
  const hasAccess =
    accessAt !== null ||
    Boolean(input?.lowTech) ||
    (input?.language && input.language !== "English") ||
    (output?.accessibilitySupports || []).length > 0;

  // The cultural connection is the section this product exists to get right, so
  // it is checked by name rather than by scanning the whole document.
  const culturalAt = findSection(sections, (_t, s) => /cultural|community/i.test(s?.label || ""));
  const culturalBody = culturalAt === null ? "" : sectionText(sections[culturalAt]);
  const culturalEmpty = culturalAt !== null && culturalBody.replace(/[^a-z]/g, "").length < 40;

  return [
    {
      id: "context",
      q: "Does the output reflect the specific student and community context?",
      pass: hasContext && !culturalEmpty,
      sectionIndex: culturalAt,
      note: !hasContext
        ? "No community context was entered, so this section has nothing specific to build on. Add one on the planning sheet and redraft."
        : culturalEmpty
        ? "The cultural connection came back thin or empty. That is the honest result for sparse input, not a filler prompt to accept."
        : "Community context was provided and this section builds on it. Check it matches your actual students.",
    },
    {
      id: "deficit",
      q: "Does it avoid deficit language?",
      pass: deficitAt === null,
      sectionIndex: deficitAt,
      note:
        deficitAt === null
          ? "No deficit-language flags detected."
          : `Possible deficit phrase here: "${deficitWord}". Rephrase around what students bring rather than what they lack.`,
    },
    {
      id: "udl",
      q: "Does it allow multiple ways to demonstrate learning?",
      pass: hasMultiMode,
      // A missing thing cannot be anchored, so this points at the assessment,
      // which is where the choice would go.
      sectionIndex: hasMultiMode
        ? multiModeAt
        : findSection(sections, (_t, s) => /assess|check|exit/i.test(s?.label || "")),
      note: hasMultiMode
        ? "More than one response mode is offered here."
        : "Only one way to respond is offered. Add a choice, for example write, diagram, or explain aloud.",
    },
    {
      id: "access",
      q: "Is it accessible for reading level, language, and tech?",
      pass: hasAccess,
      sectionIndex: accessAt,
      note: hasAccess
        ? "Accessibility supports are present, with UDL checkpoints cited in the supports block."
        : "No reading-level, language, or low-tech support was found. Add one before printing.",
    },
    {
      id: "stereotype",
      q: "Does the cultural framing stay specific rather than sliding into a stereotype?",
      // Deliberately not auto-passed. This is a judgement only the teacher can
      // make, so it reports as needing a look rather than as a check that passed.
      pass: null,
      sectionIndex: culturalAt,
      note: "You know your students. Read this section and confirm it describes them rather than a group they belong to.",
    },
  ];
}

// ---- Unified async entry point ---------------------------------------
// Simulates latency so the offline path exercises the same loading states.
export async function generate(input, opts = {}) {
  await delay(opts.instant ? 0 : 650 + Math.random() * 500);
  let output;
  switch (input.outputType) {
    case "activity":
      output = generateActivity(input);
      break;
    case "assessment":
      output = generateAssessment(input, opts.format || "quiz");
      break;
    case "feedback":
      output = generateFeedback(input, opts.format || "strengths");
      break;
    case "lesson":
    default:
      output = generateLesson(input);
      break;
  }
  const customOutput = applyCustomTasks(output, input);
  const finalOutput = customOutput || (input.outputType === "lesson"
    ? applyLessonAssistance(output, input)
    : applyResourceAssistance(output, input));
  const discussionQuestions = discussionQuestionsFor(input);
  return discussionQuestions
    ? { ...finalOutput, discussionQuestions }
    : finalOutput;
}

// The "optional real LLM hook" that used to live here is gone.
//
// It was a browser-side fetch to api.openai.com taking an `apiKey` argument, with
// a comment suggesting someone wire a key in. Dead, tree-shaken out of the bundle,
// and `connect-src 'self'` would have blocked it — so it was never a live
// vulnerability. It was removed because it is the exact pattern the whole design
// exists to prevent: the key belongs in process.env on the server (see
// api/generate.js), never in anything shipped to a browser. Leaving a worked
// example of the wrong thing in the tree is an invitation.
//
// This module is now purely the offline draft engine.

// ---- Export helpers --------------------------------------------------
export function outputToMarkdown(output) {
  let md = `# ${output.title || "Generated Output"}\n\n`;
  if (output.meta) md += `_${output.meta.join(" · ")}_\n\n`;
  for (const s of output.sections) {
    md += `## ${s.label}\n\n`;
    if (Array.isArray(s.body)) md += s.body.map((b) => `- ${b}`).join("\n") + "\n\n";
    else md += `${s.body}\n\n`;
  }
  md += `\n---\n_Generated by Lumen. Review AI output for accuracy and cultural fit before classroom use._\n`;
  return md;
}

export function outputToText(output) {
  return outputToMarkdown(output).replace(/[#_]/g, "");
}

// ---- utils ------------------------------------------------------------
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
