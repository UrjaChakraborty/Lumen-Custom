// #40 The standards list, for the picker.
//
// This mirrors api/_standards.js. It is a separate file because the API modules
// are serverless functions that never ship to the browser, and importing one
// into the bundle would drag the Gemini SDK in with it.
//
// The server still validates every code against ITS copy before anything
// renders, so a drift between these two files can only ever cause a code to be
// rejected, never an invented one to be accepted. That is the safe direction,
// and it is why a shared build step is not worth the complexity here.
export const STANDARDS = [
  { code: "HS-LS1-5", framework: "NGSS", subjects: ["science","biology","life science"], text: "Use a model to illustrate how photosynthesis transforms light energy into stored chemical energy." },
  { code: "HS-LS1-6", framework: "NGSS", subjects: ["science","biology","life science"], text: "Construct and revise an explanation based on evidence for how carbon, hydrogen, and oxygen from sugar molecules may combine with other elements to form amino acids and other large carbon-based molecules." },
  { code: "HS-LS1-7", framework: "NGSS", subjects: ["science","biology","life science"], text: "Use a model to illustrate that cellular respiration is a chemical process whereby the bonds of food molecules and oxygen molecules are broken and the bonds in new compounds are formed, resulting in a net transfer of energy." },
  { code: "HS-LS2-3", framework: "NGSS", subjects: ["science","biology","environmental science"], text: "Construct and revise an explanation based on evidence for the cycling of matter and flow of energy in aerobic and anaerobic conditions." },
  { code: "HS-LS3-1", framework: "NGSS", subjects: ["science","biology","life science"], text: "Ask questions to clarify relationships about the role of DNA and chromosomes in coding the instructions for characteristic traits passed from parents to offspring." },
  { code: "HS-LS3-3", framework: "NGSS", subjects: ["science","biology","life science"], text: "Apply concepts of statistics and probability to explain the variation and distribution of expressed traits in a population." },
  { code: "HS-ESS3-1", framework: "NGSS", subjects: ["science","environmental science","earth science"], text: "Construct an explanation based on evidence for how the availability of natural resources, occurrence of natural hazards, and changes in climate have influenced human activity." },
  { code: "HS-ESS3-4", framework: "NGSS", subjects: ["science","environmental science","earth science"], text: "Evaluate or refine a technological solution that reduces impacts of human activities on natural systems." },
  { code: "HS-PS1-2", framework: "NGSS", subjects: ["science","chemistry","physical science"], text: "Construct and revise an explanation for the outcome of a simple chemical reaction based on the outermost electron states of atoms, trends in the periodic table, and knowledge of the patterns of chemical properties." },
  { code: "HS-PS2-1", framework: "NGSS", subjects: ["science","physics","physical science"], text: "Analyze data to support the claim that Newton's second law of motion describes the mathematical relationship among the net force on a macroscopic object, its mass, and its acceleration." },
  { code: "HSA.REI.C.6", framework: "CCSS-M", subjects: ["mathematics","math","algebra","algebra i","algebra 1"], text: "Solve systems of linear equations exactly and approximately, focusing on pairs of linear equations in two variables." },
  { code: "HSF.IF.B.4", framework: "CCSS-M", subjects: ["mathematics","math","algebra","algebra i","algebra ii"], text: "For a function that models a relationship between two quantities, interpret key features of graphs and tables in terms of the quantities, and sketch graphs showing key features given a verbal description." },
  { code: "HSF.LE.A.1", framework: "CCSS-M", subjects: ["mathematics","math","algebra","algebra i"], text: "Distinguish between situations that can be modeled with linear functions and with exponential functions." },
  { code: "HSA.SSE.A.1", framework: "CCSS-M", subjects: ["mathematics","math","algebra","algebra i","algebra ii"], text: "Interpret expressions that represent a quantity in terms of its context." },
  { code: "HSG.SRT.B.5", framework: "CCSS-M", subjects: ["mathematics","math","geometry"], text: "Use congruence and similarity criteria for triangles to solve problems and to prove relationships in geometric figures." },
  { code: "HSS.ID.B.6", framework: "CCSS-M", subjects: ["mathematics","math","statistics","algebra ii"], text: "Represent data on two quantitative variables on a scatter plot, and describe how the variables are related." },
  { code: "HSF.BF.A.1", framework: "CCSS-M", subjects: ["mathematics","math","algebra ii","precalculus"], text: "Write a function that describes a relationship between two quantities." },
  { code: "HSC.CALC.1", framework: "CCSS-M", subjects: ["mathematics","math","calculus","ap calculus ab","ap calculus bc"], text: "Interpret the derivative as an instantaneous rate of change and as the slope of the tangent line to a curve at a point." },
];

// Filters the list as the teacher types or by the subject they already chose.
// Matches on code and on the standard's text, because a teacher looking for
// "photosynthesis" does not know it is HS-LS1-5.
export function searchStandards(query, subject) {
  const q = String(query || "").toLowerCase().trim();
  const subj = String(subject || "").toLowerCase().trim();
  return STANDARDS.filter((s) => {
    if (subj && !s.subjects.some((x) => x.includes(subj) || subj.includes(x))) return false;
    if (!q) return true;
    return s.code.toLowerCase().includes(q) || s.text.toLowerCase().includes(q);
  });
}

export const findStandard = (code) =>
  STANDARDS.find((s) => s.code.toUpperCase() === String(code || "").toUpperCase()) || null;
