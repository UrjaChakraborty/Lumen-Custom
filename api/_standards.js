// Local standards dataset and lookup.
//
// A model asked for a standards code from memory will produce something that
// looks exactly right and is wrong: correct prefix, plausible numbering, no
// such standard. A department chair spots that immediately, so codes never come
// from the model. Candidates are retrieved here by subject and topic, passed
// into the prompt, and the model may only select from what it was given. What
// it returns is then checked against this file again before anything renders.
//
// Scope note: this is a working subset of high school NGSS and CCSS-M, not the
// full corpus. Codes absent from it are treated as "no match" rather than
// guessed at, which is the safe direction to fail. Extend the arrays to widen
// coverage; nothing else needs to change.

export const STANDARDS = [
  // ── NGSS: Life Science ────────────────────────────────────────────────
  {
    code: "HS-LS1-5",
    framework: "NGSS",
    subjects: ["science", "biology", "life science"],
    keywords: ["photosynthesis", "light energy", "chemical energy", "glucose", "chloroplast"],
    text: "Use a model to illustrate how photosynthesis transforms light energy into stored chemical energy.",
  },
  {
    code: "HS-LS1-6",
    framework: "NGSS",
    subjects: ["science", "biology", "life science"],
    keywords: ["carbon", "amino acid", "macromolecule", "protein", "organic molecule"],
    text: "Construct and revise an explanation based on evidence for how carbon, hydrogen, and oxygen from sugar molecules may combine with other elements to form amino acids and other large carbon-based molecules.",
  },
  {
    code: "HS-LS1-7",
    framework: "NGSS",
    subjects: ["science", "biology", "life science"],
    keywords: ["cellular respiration", "energy release", "bond", "atp", "aerobic"],
    text: "Use a model to illustrate that cellular respiration is a chemical process whereby the bonds of food molecules and oxygen molecules are broken and the bonds in new compounds are formed, resulting in a net transfer of energy.",
  },
  {
    code: "HS-LS2-3",
    framework: "NGSS",
    subjects: ["science", "biology", "environmental science"],
    keywords: ["aerobic", "anaerobic", "ecosystem", "cycling of matter", "energy flow"],
    text: "Construct and revise an explanation based on evidence for the cycling of matter and flow of energy in aerobic and anaerobic conditions.",
  },
  {
    code: "HS-LS3-1",
    framework: "NGSS",
    subjects: ["science", "biology", "life science"],
    keywords: ["dna", "gene", "inheritance", "chromosome", "trait", "genetics"],
    text: "Ask questions to clarify relationships about the role of DNA and chromosomes in coding the instructions for characteristic traits passed from parents to offspring.",
  },
  {
    code: "HS-LS3-3",
    framework: "NGSS",
    subjects: ["science", "biology", "life science"],
    keywords: ["variation", "probability", "population", "genetics", "distribution"],
    text: "Apply concepts of statistics and probability to explain the variation and distribution of expressed traits in a population.",
  },
  // ── NGSS: Earth and Environmental ─────────────────────────────────────
  {
    code: "HS-ESS3-1",
    framework: "NGSS",
    subjects: ["science", "environmental science", "earth science"],
    keywords: ["natural resource", "hazard", "climate", "human activity", "sustainability"],
    text: "Construct an explanation based on evidence for how the availability of natural resources, occurrence of natural hazards, and changes in climate have influenced human activity.",
  },
  {
    code: "HS-ESS3-4",
    framework: "NGSS",
    subjects: ["science", "environmental science", "earth science"],
    keywords: ["urban heat", "climate resilience", "mitigation", "human impact", "solution"],
    text: "Evaluate or refine a technological solution that reduces impacts of human activities on natural systems.",
  },
  // ── NGSS: Physical Science ────────────────────────────────────────────
  {
    code: "HS-PS1-2",
    framework: "NGSS",
    subjects: ["science", "chemistry", "physical science"],
    keywords: ["chemical reaction", "periodic table", "valence", "bonding", "outermost"],
    text: "Construct and revise an explanation for the outcome of a simple chemical reaction based on the outermost electron states of atoms, trends in the periodic table, and knowledge of the patterns of chemical properties.",
  },
  {
    code: "HS-PS2-1",
    framework: "NGSS",
    subjects: ["science", "physics", "physical science"],
    keywords: ["motion", "force", "acceleration", "newton", "mass"],
    text: "Analyze data to support the claim that Newton's second law of motion describes the mathematical relationship among the net force on a macroscopic object, its mass, and its acceleration.",
  },
  // ── CCSS Mathematics ──────────────────────────────────────────────────
  {
    code: "HSA.REI.C.6",
    framework: "CCSS-M",
    subjects: ["mathematics", "math", "algebra", "algebra i", "algebra 1"],
    keywords: ["system of equations", "systems", "linear", "solve", "simultaneous"],
    text: "Solve systems of linear equations exactly and approximately, focusing on pairs of linear equations in two variables.",
  },
  {
    code: "HSF.IF.B.4",
    framework: "CCSS-M",
    subjects: ["mathematics", "math", "algebra", "algebra i", "algebra ii"],
    keywords: ["function", "graph", "key feature", "intercept", "interpret", "slope"],
    text: "For a function that models a relationship between two quantities, interpret key features of graphs and tables in terms of the quantities, and sketch graphs showing key features given a verbal description.",
  },
  {
    code: "HSF.LE.A.1",
    framework: "CCSS-M",
    subjects: ["mathematics", "math", "algebra", "algebra i"],
    keywords: ["linear", "exponential", "growth", "rate of change", "model"],
    text: "Distinguish between situations that can be modeled with linear functions and with exponential functions.",
  },
  {
    code: "HSA.SSE.A.1",
    framework: "CCSS-M",
    subjects: ["mathematics", "math", "algebra", "algebra i", "algebra ii"],
    keywords: ["expression", "interpret", "structure", "term", "coefficient", "quadratic"],
    text: "Interpret expressions that represent a quantity in terms of its context.",
  },
  {
    code: "HSG.SRT.B.5",
    framework: "CCSS-M",
    subjects: ["mathematics", "math", "geometry"],
    keywords: ["congruence", "similarity", "triangle", "proof", "geometric figure"],
    text: "Use congruence and similarity criteria for triangles to solve problems and to prove relationships in geometric figures.",
  },
  {
    code: "HSS.ID.B.6",
    framework: "CCSS-M",
    subjects: ["mathematics", "math", "statistics", "algebra ii"],
    keywords: ["data", "scatter plot", "fit", "residual", "correlation", "two variable"],
    text: "Represent data on two quantitative variables on a scatter plot, and describe how the variables are related.",
  },
  {
    code: "HSF.BF.A.1",
    framework: "CCSS-M",
    subjects: ["mathematics", "math", "algebra ii", "precalculus"],
    keywords: ["build function", "model", "combine function", "composition"],
    text: "Write a function that describes a relationship between two quantities.",
  },
  {
    code: "HSC.CALC.1",
    framework: "CCSS-M",
    subjects: ["mathematics", "math", "calculus", "ap calculus ab", "ap calculus bc"],
    keywords: ["derivative", "rate of change", "tangent", "instantaneous", "differentiation"],
    text: "Interpret the derivative as an instantaneous rate of change and as the slope of the tangent line to a curve at a point.",
  },
];

const norm = (s) => String(s || "").toLowerCase().trim();

// Candidate retrieval. Scores by subject/course overlap plus topic keyword
// matches, then returns the top few. The model never sees the whole corpus,
// only a short relevant slate, which keeps it from pattern-matching a code it
// half-remembers from training.
export function findCandidateStandards(input, limit = 8) {
  const subject = norm(input?.subject);
  const course = norm(input?.course);
  const topic = norm(input?.topic);
  const haystack = `${topic} ${course} ${subject}`;

  const scored = STANDARDS.map((s) => {
    let score = 0;
    let topicHit = false;
    for (const subj of s.subjects) {
      if (subject && subj.includes(subject)) score += 2;
      if (course && subj.includes(course)) score += 3;
    }
    for (const kw of s.keywords) {
      if (haystack.includes(kw)) {
        score += 4;
        topicHit = true;
      }
    }
    // A topic keyword must match. Subject and course only RANK the results;
    // they cannot qualify one on their own. Without this, "Science" alone
    // returned the whole life-science shelf for an astronomy lesson, handing
    // the model a slate of plausible-looking but unrelated codes to pick from.
    // Returning nothing is the honest answer for a topic outside the dataset.
    return { s, score: topicHit ? score : 0 };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);

  return scored;
}

// Format for the prompt: the model picks from these lines and nothing else.
export function formatCandidatesForPrompt(candidates) {
  if (!candidates.length) return "(no candidate standards were retrieved for this topic)";
  return candidates.map((c) => `${c.code} [${c.framework}]: ${c.text}`).join("\n");
}

const CODE_INDEX = new Map(STANDARDS.map((s) => [s.code.toUpperCase(), s]));

// Post-generation gate. Anything the model returns that is not in the dataset is
// dropped rather than displayed, because a plausible invented code is worse than
// no code at all. Returns the kept entries plus what was rejected, so the caller
// can log and the UI can say "no standard matched".
export function validateStandards(codes) {
  const valid = [];
  const rejected = [];
  for (const raw of Array.isArray(codes) ? codes : []) {
    const key = String(raw || "").toUpperCase().trim();
    const hit = CODE_INDEX.get(key);
    if (hit) {
      if (!valid.some((v) => v.code === hit.code)) valid.push(hit);
    } else if (key) {
      rejected.push(raw);
    }
  }
  return { valid, rejected };
}
