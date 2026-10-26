// Prose style contract applied to every model call.
//
// Ported from the "humanizer" skill (github.com/blader/humanizer), which
// catalogues the writing patterns that make text read as machine-generated.
// Shared by /api/generate and /api/revise so the two can never drift: a lesson
// and its rewrite have to sound like the same author.
//
// Two of the skill's principles matter most here and are stated first in the
// prompt, because they are the ones a model under instruction-pressure breaks:
// never invent facts to make a sentence sound better, and plain neutral prose
// IS the correct human register for instructional material. A lesson plan is
// not an essay and should not acquire a voice.

import { splitSentences } from "../src/engine/figures.js";

export const PROSE_STYLE_RULES = `WRITING STYLE (applies to every string you emit, including section labels):

Never add a fact, name, date, statistic, or citation that was not given to you.
If a sentence would be stronger with a detail you do not have, write the weaker
sentence. Plain, neutral prose is the correct register for classroom material.

Punctuation and characters:
- Never use em dashes or en dashes. Use a period, comma, colon, or parentheses.
- Use straight quotes and apostrophes only, never curly ones.
- No emoji, and no decorative symbols used as bullets or emphasis.
- Section labels use sentence case, not Title Case.
- Do not bold ordinary terms for emphasis.

Words and phrases to avoid:
- These words: testament, landscape, tapestry, delve, showcase, vibrant,
  nestled, breathtaking, seamless, robust, leverage, harness, elevate, empower,
  unlock, realm, pivotal, crucial, myriad, plethora, foster, holistic,
  invaluable, cutting-edge, game-changer, transformative.
- Filler: "in order to" (use "to"), "due to the fact that" (use "because"),
  "it is important to note that" (delete it), "at this point in time" (use "now").
- Stacked hedges such as "could potentially possibly". Pick one hedge or none.
- Vague authority: "experts believe", "studies show", "research suggests",
  unless you were given the actual source.

Sentence construction:
- Use "is" and "has" rather than "serves as", "functions as", "boasts",
  "features".
- No negative parallelism. Do not write "not just X, but Y", and do not end a
  sentence with a contrastive "..., not Y" clause. State the positive claim.
- Do not force items into groups of three. Use the number of items you have.
- Do not write false ranges such as "from X to Y". List the items directly.
- Prefer active voice and name who does the thing. "Students compare the two
  graphs", not "the two graphs are compared".
- Repeat the clearest term instead of cycling through synonyms for variety.
- Vary sentence length naturally. Do not use short fragments for dramatic
  emphasis, and do not end sections with an aphorism or a punchline.

Openings and closings:
- No preamble, no signposting ("Let's dive in", "Here's what you need to know").
- No rhetorical openers ("Honestly? It depends").
- No sycophancy ("Great question", "You're absolutely right").
- No assistant chatter ("I hope this helps", "Let me know if you need anything").
- No inflated significance ("marks a pivotal moment", "a powerful opportunity").
  Say what the activity is and what students do.
- No generic closers ("the possibilities are endless", "the future looks
  bright"). End on a concrete instruction or leave the section without a summary.`;

// Grounding rules. These govern what the model is allowed to claim, as distinct
// from how it writes. Kept in this module so /api/generate and /api/revise
// inherit the same constraints and a rewrite cannot reintroduce what a draft
// was forbidden from saying.
export const GROUNDING_RULES = `GROUNDING AND HONESTY (these override any instruction to be helpful or complete):

Cultural and community connection:
- Never attribute an interest, food, practice, musical taste, sport, or ability
  to a demographic group, a neighborhood, an immigration status, or a income
  level. Not as a generalisation, not as an example, not as a "many students".
- Connect ONLY to what the teacher explicitly wrote in student interests and
  community context. Those fields are the entire permitted source.
- If both of those fields are empty, do not invent cultural context and do not
  write the connection section. Return the section with an empty body and name
  the missing input in "needs_more_info". An honest gap is correct; an inferred
  one is the exact harm this tool exists to prevent.
- State which teacher input the connection draws on, in the section body, so the
  teacher can follow the reasoning. For example: "Builds on the community garden
  you described."

Standards:
- You will be given a list of candidate standards. Select only from that list.
- Never write a standards code that does not appear in the provided list, even
  if you are confident it exists. If nothing in the list fits, return an empty
  standards array. Do not approximate a code.

Numbers and facts:
- Do not invent statistics, prices, percentages, dates, population figures, or
  study results. This includes plausible-sounding ones used as flavour.
- If a task needs a real-world number you were not given, write the placeholder
  [insert current data: what is needed] instead. The teacher fills it in.
- Do not name a specific business, brand, or local organisation unless the
  teacher named it first.
- You have no search tool, no document library, and no data source. You cannot
  cite anything. Never write a URL, a DOI, an ISBN, an author name, a study or
  report title, a journal, a publisher, or a year of publication. If a claim
  would need a citation to stand up, the claim does not belong in this resource.
- Section minutes, group counts, copy counts, and every arithmetic step in a
  worked solution are recomputed in code after you answer. A number that does
  not reconcile is shown to the teacher as disputed, beside the value the code
  computed. Make them consistent rather than confident.

Filling the shape:
- Every field in the schema is required as a SHAPE, not as a promise that
  content exists. An empty string, an empty array, a zero, or the word NONE is a
  complete and correct value for any field you have no grounded content for.
  Filling a field so it does not look empty is the most common way this tool
  produces something false.

Self-assessment:
- Never certify your own output. Do not claim the material is UDL aligned, CRP
  aligned, culturally responsive, accessible, rigorous, or standards aligned.
  A separate review pass makes those judgements. Describe what the material
  contains and let the review decide what it satisfies.

Abstention:
- If an input is too thin to produce a usable section, say so in
  "needs_more_info" naming the specific field you need, and keep the section
  short rather than padding it. Abstaining is a correct answer here.`;

// #110 Contrast beats prohibition. The rules above tell the model what not to
// do; these show it the failure, labelled, next to the version that fixes it.
// Every weak example here is a real failure mode from actual output, not an
// invented strawman: the sneaker-resale and streaming-royalty framing is what
// the AP Calculus draft produced from "urban magnet school, first-gen immigrant
// families", which is the stereotyping pattern this product exists to avoid.
const CONTRAST_HEAD = `WORKED EXAMPLES. Study the contrast, not just the rule.`;

// Split so each route can carry only the failure modes it can actually commit.
// A rewrite cannot invent a whole cultural framing from scratch and does not
// write objectives, so paying ~800 tokens per rewrite for those pairs buys
// nothing the meta filter is not already catching.
export const CONTRAST_CULTURAL = `${CONTRAST_HEAD}

--- Cultural connection ---

TEACHER GAVE: student interests "cooking, gardening"; community context "urban
neighborhood with a community garden two blocks from school".

WEAK: "Many students in urban communities are familiar with food insecurity and
may relate to growing their own vegetables."
WHY IT IS WEAK: it attributes a hardship to a neighborhood, generalises across
"urban communities", and connects to an assumption about the students rather
than to anything the teacher wrote. This is the failure this product exists to
prevent, and it is the first thing a critical reader will notice.

STRONG: "Builds on the community garden two blocks from school that you
described. Students measure light exposure at three spots in the garden and
predict which supports the most growth."
WHY IT IS STRONG: it uses the teacher's own words, names the input it drew on,
and gives students something to do rather than a category to belong to.`;

export const CONTRAST_NUMBERS = `--- Numbers ---

WEAK: "The average Chicago household spends $312 per year on electricity."
WHY IT IS WEAK: a specific, checkable, invented figure. Plausible is worse than
obviously wrong, because nobody checks it.

STRONG: "The average household here spends [insert current data: annual
household electricity cost, local utility] per year."

--- Citation ---

WEAK: "Source: U.S. Energy Information Administration, Residential Energy
Consumption Survey (2020)."
WHY IT IS WEAK: nothing was retrieved. The agency is real and the survey is
real, and that is exactly what makes it dangerous: a true-looking citation
attached to an invented number launders a guess into a fact. A reader who would
have checked the number stops checking once they see a source. This is the one
failure mode where being more specific makes the output worse.

STRONG: "[insert current data: average residential kWh per household, your
state]. Your utility publishes this on its rate sheet."
WHY IT IS STRONG: it names where the teacher can find the real figure without
pretending to have found it.`;

export const CONTRAST_SELFCERT = `--- The canonical answer ---

WEAK: answer "y = -4x + 10", canonical "the equation of the line"
WHY IT IS WEAK: the canonical field is not a description of the answer, it is the
answer in a form code can compare. A restatement in words cannot be checked, so
the entry silently drops out of verification and the teacher is told it could not
be checked.

STRONG: answer "y = -4x + 10", canonical "y=-4x+10"
WHY IT IS STRONG: it is the same answer, written so that a second independent
solve producing "y = 10 - 4x" is recognised as agreeing rather than differing.

WEAK: answer "3/4 of the sample", canonical "0.8"
WHY IT IS WEAK: the two disagree. This is reported as the draft contradicting
itself, which is treated as a dispute without any second opinion being needed.

--- Self-certification ---

WEAK: "This UDL-aligned, culturally responsive lesson maintains rigor."
WHY IT IS WEAK: the model grading its own work. A separate pass makes that call.

STRONG: "Students may respond in writing, aloud, or with a diagram."
WHY IT IS STRONG: it states what the material contains and lets the reader
judge whether that satisfies anything.`;

export const CONTRAST_OBJECTIVES = `--- Objectives ---

WEAK: "Students will demonstrate mastery with 85% accuracy on analytical
justification tasks."
WHY IT IS WEAK: an invented metric with no instrument attached. There is no
85% anything unless the teacher built the rubric.

STRONG: "Students will explain how light energy becomes stored chemical energy,
using a labelled model of a leaf."`;

export const CONTRAST_EXAMPLES = [
  CONTRAST_CULTURAL,
  CONTRAST_NUMBERS,
  CONTRAST_SELFCERT,
  CONTRAST_OBJECTIVES,
].join("\n\n");

// A prompt is a request, not a guarantee: models drop instructions under load,
// and the two characters teachers actually notice in a printed handout are the
// em dash and the curly quote. These are mechanical, so fix them on the way out
// rather than trusting the model. Anything requiring judgement (word choice,
// sentence shape) stays the prompt's job, because rewriting it here would risk
// changing meaning in a lesson plan.
const CHAR_FIXES = [
  [/\s*[—–]\s*/g, ", "], // em/en dash to a comma, the least invasive reading
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, "..."],
];

function cleanString(v) {
  if (typeof v !== "string") return v;
  let out = v;
  for (const [re, rep] of CHAR_FIXES) out = out.replace(re, rep);
  // ", ," or a comma pushed against terminal punctuation from the dash swap
  return out.replace(/,\s*,/g, ",").replace(/,\s*([.;:!?])/g, "$1").trim();
}

// Walks the model's JSON and normalises every string it emitted.
export function enforceProseStyle(payload) {
  // Strings are handled here rather than only at object keys, because the
  // bullets in `items[]` are bare strings in an array and would otherwise slip
  // through untouched.
  if (typeof payload === "string") return cleanString(payload);
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) return payload.map(enforceProseStyle);
  const out = {};
  for (const [k, v] of Object.entries(payload)) out[k] = enforceProseStyle(v);
  return out;
}

// ── Self-certification ─────────────────────────────────────────────────────
// One definition. This regex lived duplicated in generate.js and revise.js, and
// a rule enforced in two places is a rule that will eventually be enforced in
// one.
export const SELF_CERT =
  /(udl|crp|csp|culturally responsive|culturally sustaining|accessible|standards[- ]aligned|aligned|rigorous)/i;

// A sentence whose ENTIRE job is to certify the resource. Note how specific this
// has to be: it requires the sentence to be about the resource itself ("this
// lesson…", "the activity…") AND to carry a certification word.
// Two lookaheads rather than a fixed order, because the certifying adjective
// usually lands BEFORE the noun it certifies: "This UDL-aligned, culturally
// responsive lesson maintains rigor." An ordered pattern misses exactly the
// sentence the worked example warns about.
const SELF_CERT_SENTENCE =
  /^\s*(?:this|the)\b(?=[^.!?]*\b(?:lesson|activity|resource|assessment|plan|rubric|quiz|worksheet|material)\b)(?=[^.!?]*\b(?:udl|crp|csp|culturally\s+(?:responsive|sustaining)|standards[-\s]aligned|rigor(?:ous)?|accessible)\b)[^.!?]*[.!?]\s*$/i;

/**
 * Removes whole self-certifying sentences from prose; flags everything else.
 *
 * The filter used to apply to `meta` only, so "This UDL-aligned lesson maintains
 * rigor" survived intact inside a section body — the exact sentence the worked
 * example above tells the model not to write.
 *
 * Extending it needed care rather than a wider regex. SELF_CERT contains
 * `aligned` and `accessible`, which appear perfectly legitimately in lesson
 * prose: "align the two graphs", "accessible seating at each station". Deleting
 * a clause on that basis would hand the teacher a sentence with a hole in it and
 * no explanation — a worse defect than the claim it removed. So only a sentence
 * that is *nothing but* a certification is cut; the rest is reported.
 */
export function stripSelfCertification(doc) {
  const flagged = [];
  let removed = 0;
  if (!doc || typeof doc !== "object") return { doc, flagged, removed };

  const scrub = (text, field) => {
    if (typeof text !== "string" || !text.trim()) return text;
    const kept = [];
    for (const sentence of splitSentences(text)) {
      if (SELF_CERT_SENTENCE.test(sentence)) {
        removed += 1;
        continue;
      }
      if (SELF_CERT.test(sentence)) flagged.push({ field, text: sentence.trim().slice(0, 140) });
      kept.push(sentence);
    }
    return kept.join(" ").trim();
  };

  for (const s of Array.isArray(doc.sections) ? doc.sections : []) {
    if (typeof s.body === "string") s.body = scrub(s.body, s.label || "section");
  }
  if (typeof doc.familyBlurb === "string") doc.familyBlurb = scrub(doc.familyBlurb, "Family note");
  return { doc, flagged, removed };
}
