// A normal form for answers, so two answers can be compared instead of matched.
//
// WHY THIS EXISTS
//
// The answer key is the strongest check in the product: every numeric answer is
// re-solved blind, at temperature 0, by a model that never sees the proposed
// answer, and a disagreement is marked rather than overwritten. It costs a model
// call, which is the scarcest thing in the pipeline.
//
// And it only ever compared one shape. The old comparison ran the draft answer
// and the solved answer through a regex that returned null unless the string
// contained EXACTLY ONE number. Measured against real output:
//
//   "m = 2"                vs "2"                 -> confirmed
//   "7.5 meters per minute" vs "7.5"              -> confirmed
//   "y = -4x + 10"         vs "y = 10 - 4x"       -> NOT COMPARABLE
//   "y=-4x+10"             vs "y = -4x + 10"      -> NOT COMPARABLE
//   "3/4"                  vs "0.75"              -> NOT COMPARABLE
//   "x = 2, y = 5"         vs "x=2, y=5"          -> NOT COMPARABLE
//
// The bottom four are not hard problems. Two are the same answer with different
// whitespace; one is a fraction against its own decimal. On a live Algebra I quiz
// the check confirmed three of five, and both misses were shapes a teacher writes
// constantly. The panel said "could not be re-solved", which was honest, but the
// gap was a regex rather than a limit on what is knowable.
//
// THE RULE THAT KEEPS THIS HONEST
//
// The model also emits a `canonical` field. That is a self-report, and this
// codebase does not trust self-reports. So the model's canonical is never taken
// at face value: code canonicalises the PROSE answer independently, and if the
// two disagree the model has contradicted itself inside one response — which is
// a dispute in its own right, raised before the solver is consulted at all.
//
// `canonical` is therefore not a claim to believe. It is a second statement that
// has to agree with the first.
//
// Anything this module cannot parse returns kind "" — which means UNCHECKED, not
// "probably fine". A sixth state would quietly undo the three-state rule the
// whole verification panel rests on.

// Closed vocabulary for categorical answers. Deliberately small: these are the
// ones that actually recur in STEM keys, and a longer list starts matching
// ordinary prose.
const CATEGORICAL = {
  positive: "positive",
  negative: "negative",
  zero: "zero",
  undefined: "undefined",
  increasing: "increasing",
  decreasing: "decreasing",
  constant: "constant",
  yes: "yes",
  no: "no",
  true: "true",
  false: "false",
  linear: "linear",
  nonlinear: "nonlinear",
  proportional: "proportional",
};

const NUM = String.raw`-?\d+(?:\.\d+)?`;

function round(n) {
  // 6 places is well past classroom precision and short of float noise.
  return Number.parseFloat(n.toFixed(6));
}

// "3/4" -> 0.75, "2" -> 2, "-1.5" -> -1.5. Returns null when not a lone value.
function asNumber(text) {
  const t = String(text).trim();
  const frac = t.match(new RegExp(`^(${NUM})\\s*/\\s*(${NUM})$`));
  if (frac) {
    const d = Number(frac[2]);
    if (!d) return null;
    return round(Number(frac[1]) / d);
  }
  if (new RegExp(`^${NUM}$`).test(t)) return round(Number(t));
  return null;
}

// ── Linear expression normalisation ────────────────────────────────────────
// Enough algebra to make "y = -4x + 10" and "y = 10 - 4x" the same string, and
// to keep "y = 4x + 10" different from both. Not a CAS: linear terms with
// numeric coefficients, single-letter variables, optional integer powers.
function parseTerms(expr) {
  const cleaned = String(expr).replace(/\s+/g, "");
  if (!cleaned) return null;
  // Reject anything with grouping or operators this parser does not model,
  // rather than silently mis-parsing it into a confident wrong answer.
  if (/[()\[\]{}]|[*/]/.test(cleaned)) return null;

  const terms = new Map();
  const re = /([+-]?)(\d+(?:\.\d+)?)?([a-zA-Z](?:\^\d+)?)?/g;
  let matched = 0;
  let m;
  while ((m = re.exec(cleaned))) {
    if (!m[0]) {
      re.lastIndex += 1;
      if (re.lastIndex > cleaned.length) break;
      continue;
    }
    matched += m[0].length;
    const sign = m[1] === "-" ? -1 : 1;
    const coeff = m[2] === undefined ? 1 : Number(m[2]);
    const varPart = m[3] || "";
    if (m[2] === undefined && !varPart) continue; // stray sign
    const key = varPart.toLowerCase();
    terms.set(key, round((terms.get(key) || 0) + sign * coeff));
  }
  if (matched !== cleaned.length) return null;
  return terms;
}

function termsToString(terms) {
  const entries = [...terms.entries()].filter(([, c]) => c !== 0);
  if (!entries.length) return "0";
  // Variables first, alphabetically; the bare constant last.
  entries.sort((a, b) => {
    if (a[0] === "") return 1;
    if (b[0] === "") return -1;
    return a[0].localeCompare(b[0]);
  });
  // Sign-normalise so `a = b` and `b = a` agree: make the leading term positive.
  const lead = entries[0][1];
  const flip = lead < 0 ? -1 : 1;
  return entries
    .map(([v, c], i) => {
      const val = round(c * flip);
      const sign = val < 0 ? "-" : i === 0 ? "" : "+";
      const mag = Math.abs(val);
      const shown = v && mag === 1 ? "" : String(mag);
      return `${sign}${shown}${v}`;
    })
    .join("");
}

function asEquation(text) {
  const parts = String(text).split("=");
  if (parts.length !== 2) return null;
  const left = parseTerms(parts[0]);
  const right = parseTerms(parts[1]);
  if (!left || !right) return null;
  // Move everything to one side: lhs - rhs = 0.
  const diff = new Map(left);
  for (const [v, c] of right.entries()) diff.set(v, round((diff.get(v) || 0) - c));
  const s = termsToString(diff);
  return s === "0" ? null : s;
}

function asCategorical(text) {
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const hits = [...new Set(words.map((w) => CATEGORICAL[w]).filter(Boolean))];
  // Exactly one category word, or the answer is prose that happens to contain
  // one ("the slope is negative because the line decreases" -> negative,
  // decreasing -> ambiguous, so unchecked).
  return hits.length === 1 ? hits[0] : null;
}

function asTuple(text) {
  // A coordinate pair arrives as "(0, 5)" at least as often as "0,5", and the
  // brackets were enough to make it unparseable. Stripped only when they wrap
  // the WHOLE answer, so "f(x) = 2" is not quietly mangled into a tuple.
  const unwrapped = String(text).trim().replace(/^[([{]\s*(.*?)\s*[)\]}]$/, "$1");
  const parts = unwrapped.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 6) return null;
  const forms = parts.map((p) => {
    // "x = 2" inside a tuple is a value, not an equation.
    const assigned = p.match(new RegExp(`^[a-zA-Z]\\s*=\\s*(.+)$`));
    const v = asNumber(assigned ? assigned[1] : p);
    return v === null ? null : String(v);
  });
  return forms.every((f) => f !== null) ? forms.join(",") : null;
}

/**
 * @returns {{form: string, kind: "number"|"equation"|"categorical"|"tuple"|""}}
 *   kind "" means this module could not put the answer in a normal form. That
 *   is UNCHECKED. It is never treated as agreement.
 */
export function canonicalize(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { form: "", kind: "" };

  // "m = 2", "slope = 3/4" — an assignment to a bare value is a number, not an
  // equation. Strip the label and fall through.
  const assigned = text.match(/^[a-zA-Z][a-zA-Z0-9_]{0,12}\s*=\s*(.+)$/);
  const bare = assigned ? assigned[1].trim() : text;

  // A percent is its OWN kind, not a number.
  //
  // "25%" against "0.25" and "25%" against "25" cannot both be agreements, and
  // there is no way to tell from the string which convention the solver used.
  // Picking one would manufacture a disagreement roughly half the time — a false
  // dispute on a correct answer key is worse than an honest "not checked",
  // because it sends a teacher hunting for a mistake that is not there.
  const pctMatch = bare.match(new RegExp(`^(${NUM})\\s*%$`));
  if (pctMatch) return { form: String(round(Number(pctMatch[1]))), kind: "percent" };

  // Units and trailing prose: "7.5 meters per minute" is the number 7.5.
  const leadingNumber = bare.match(new RegExp(`^(${NUM}(?:\\s*/\\s*${NUM})?)\\b`));
  if (leadingNumber) {
    const n = asNumber(leadingNumber[1]);
    if (n !== null) {
      const rest = bare.slice(leadingNumber[0].length).trim();
      // A second number in the tail means this is not a lone value.
      if (!new RegExp(NUM).test(rest)) return { form: String(n), kind: "number" };
    }
  }

  const n = asNumber(bare);
  if (n !== null) return { form: String(n), kind: "number" };

  const tuple = asTuple(text);
  if (tuple) return { form: tuple, kind: "tuple" };

  const eq = asEquation(text);
  if (eq) return { form: eq, kind: "equation" };

  const cat = asCategorical(text);
  if (cat) return { form: cat, kind: "categorical" };

  return { form: "", kind: "" };
}

/** Two answers agree when they reduce to the same normal form. */
export function canonicalEqual(a, b) {
  const x = canonicalize(a);
  const y = canonicalize(b);
  if (!x.kind || !y.kind) return null; // unknown, NOT equal

  // One genuine cross-kind equivalence: the word "zero" and the number 0 are the
  // same answer, and a slope question routinely gets one from the draft and the
  // other from the solver. This is the ONLY bridge in the closed vocabulary that
  // has a numeric twin, so it is written out rather than generalised — a general
  // word-to-number map would start matching "one" in prose.
  const zeroish = (c) =>
    (c.kind === "categorical" && c.form === "zero") || (c.kind === "number" && c.form === "0");
  if (zeroish(x) && zeroish(y)) return true;

  // Different kinds means the two answers are not expressed in comparable terms
  // (a percent against a bare decimal, an equation against a lone number). That
  // is unchecked. Claiming disagreement here would invent disputes out of
  // notation differences, which is the failure mode that makes a verification
  // panel get ignored.
  if (x.kind !== y.kind) return null;
  return x.form === y.form;
}
