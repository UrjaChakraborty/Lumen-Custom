// Server-side entry point for the answer canonicaliser.
//
// Implementation lives in src/engine/canonical.js and is re-exported here, the
// same arrangement as _figures.js and _pii.js. One definition of "these two
// answers are the same answer" — two would drift, and the one that drifts is the
// one that stops catching wrong keys.
//
// The client imports the src module directly (never this file: importing from
// api/ in the browser 404s under the dev server), which is what lets the answer
// row be recomputed after a rewrite instead of shown stale.

export { canonicalize, canonicalEqual } from "../src/engine/canonical.js";
