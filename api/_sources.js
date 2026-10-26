// Where the numbers in a draft came from — derived, never asked for.
//
// `sources` used to be a field the model wrote: a bare ARRAY<STRING> with no
// description and no validation anywhere in the codebase. That made it the
// single most fabrication-prone thing in the schema, for a reason that has
// nothing to do with how good the model is:
//
//   Lumen has no search tool, no document library and no corpus. Every specific
//   citation the model could emit was invented BY CONSTRUCTION.
//
// And an invented citation is worse than an invented number, because it makes
// the number look checked. "U.S. Energy Information Administration, Residential
// Energy Consumption Survey (2020)" is a real agency and a real survey; attached
// to a figure nobody retrieved, it launders a guess into a fact.
//
// So the field stopped being model output. Every legitimate value of it is
// already computable from what the app holds:
//
//   - a placeholder names its own source type, in its own text
//   - a figure traced to a teacher input names the field it came from
//   - a figure matching the lesson's own timing is the lesson's own arithmetic
//   - "no external data" is a fact about the document, checkable by scanning it
//
// There is no fifth category. A citation is not a category, it is a fabrication.
// The model cannot write this block, so it cannot fabricate one.

import { scanFigures, collectPlaceholders } from "./_figures.js";
import { splitSentences } from "../src/engine/figures.js";

// Citation shapes. Detection is the point; removal is deliberately rare (see
// stripCitations below).
const CITATION_PATTERNS = [
  { id: "url", label: "a web address", re: /\bhttps?:\/\/\S+|\bwww\.[a-z0-9-]+\.\w{2,}|\b[a-z0-9-]{2,}\.(?:com|org|net|edu|gov|io)\b/gi },
  { id: "doi", label: "a DOI", re: /\b10\.\d{4,9}\/\S+/g },
  { id: "isbn", label: "an ISBN", re: /\bISBN\b[\s:]*[\d-]{10,}|\b97[89][\d-]{10,}/gi },
  { id: "author-year", label: "an author-and-year citation", re: /\([A-Z][A-Za-z.'-]+(?:\s+(?:et al\.?|and\s+[A-Z][A-Za-z.'-]+))?,\s*(?:1[89]|20)\d{2}[a-z]?\)/g },
  { id: "etal", label: "an “et al.” reference", re: /\bet al\.?/gi },
  { id: "journal", label: "a journal or report reference", re: /\bvol\.?\s*\d+\b|\bpp?\.\s*\d+\b|\bJournal of\b|\bProceedings of\b|\b(?:Survey|Report|Bulletin)\s*\((?:19|20)\d{2}\)/gi },
];

// A sentence that is nothing but a citation — no verb of its own, just a
// reference. This is the only thing safe to remove outright.
const CITATION_ONLY = /^\s*(?:source|sources|reference|references|citation|adapted from|data from|retrieved from)\s*[:—-]/i;

// Shared with the figure scanner so the two agree on where a sentence ends —
// they both make whole-sentence decisions and must see the same sentences.
const sentencesOf = splitSentences;

/**
 * Finds citation-shaped text anywhere in the document, and removes ONLY whole
 * sentences that are nothing but a citation.
 *
 * Everything else is flagged and left in place. Regex-deleting a clause from the
 * middle of a lesson body would be a worse defect than the claim it removes —
 * the teacher would be handed a sentence with a hole in it and no idea why. The
 * same conservative posture as the self-certification filter.
 *
 * @returns {{doc, findings: Array<{id,label,text,field}>, removed: number}}
 */
export function stripCitations(doc) {
  const findings = [];
  let removed = 0;
  if (!doc || typeof doc !== "object") return { doc, findings, removed };

  const scrubText = (text, field) => {
    if (typeof text !== "string" || !text.trim()) return text;
    const kept = [];
    for (const sentence of sentencesOf(text)) {
      // Every pattern, not just the first. Breaking on the first match meant a
      // sentence carrying both a URL and an "et al." was recorded as one URL,
      // which under-counts exactly the sentences that are most citation-heavy.
      let hit = false;
      for (const p of CITATION_PATTERNS) {
        p.re.lastIndex = 0;
        const m = sentence.match(p.re);
        if (m && m.length) {
          findings.push({ id: p.id, label: p.label, text: m[0].slice(0, 120), field });
          hit = true;
        }
      }
      if (hit) {
        if (CITATION_ONLY.test(sentence)) {
          removed += 1;
          continue; // drop the whole sentence
        }
      }
      kept.push(sentence);
    }
    return kept.join(" ").trim();
  };

  for (const s of Array.isArray(doc.sections) ? doc.sections : []) {
    if (typeof s.body === "string") s.body = scrubText(s.body, s.label || "section");
  }
  if (typeof doc.familyBlurb === "string") {
    doc.familyBlurb = scrubText(doc.familyBlurb, "Family note");
  }
  return { doc, findings, removed };
}

/**
 * Builds the sources block from the document itself.
 *
 * `origin` is assigned by code and is one of:
 *   "placeholder"      a figure the draft correctly deferred on
 *   "your input"       traced to something the teacher typed
 *   "lesson timing"    the lesson's own minutes
 *   "no stated source" a figure that traced to nothing  <- carries the warning
 *   "none"             the declaration that no external data was used
 *
 * The last is only reachable when every other bucket is empty, which makes
 * "this draft uses no external data" a checked statement rather than a claim.
 */
export function deriveSources(doc, context = {}, scan = null) {
  const figures = scan || scanFigures(doc, context);
  const rows = [];

  for (const need of collectPlaceholders(doc)) {
    rows.push({ origin: "placeholder", figure: "", detail: need });
  }

  const seen = new Set();
  for (const t of figures.traced) {
    const key = `${t.origin}|${t.figure}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ origin: t.origin, figure: t.figure, detail: "matches what you entered" });
  }

  // Both buckets go in. `bare` is usually problem data, so it is described as
  // unresolved rather than accused — but it is still listed, because the whole
  // point of this block is that a number with no provenance is visible.
  for (const a of figures.asserted) {
    rows.push({
      origin: "no stated source",
      figure: a.figure,
      detail: `stated as fact in ${a.field}. Check it or replace it with a placeholder.`,
    });
  }
  for (const b of figures.bare) {
    rows.push({
      origin: "unresolved",
      figure: b.figure,
      detail: `in ${b.field}. If this is problem data it is fine; if it is a real-world figure, it has no source.`,
    });
  }

  if (!rows.length) {
    rows.push({ origin: "none", figure: "", detail: "This draft uses no external data." });
  }
  return { rows, stats: { placeholders: rows.filter((r) => r.origin === "placeholder").length,
    unsourced: figures.asserted.length, unresolved: figures.bare.length } };
}

// Re-exported from the client module so there is one definition. See
// src/engine/sourceRows.js for why the reader lives on that side.
export { normalizeSourceRows, ORIGIN_LABEL } from "../src/engine/sourceRows.js";
