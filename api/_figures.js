// Server-side entry point for the figure scanner.
//
// The implementation lives in src/engine/figures.js and is re-exported here
// rather than duplicated, for the same reason api/_pii.js imports the PII
// patterns instead of restating them: two copies of "what counts as a fabricated
// figure" would drift, and the copy that drifts is the one that stops matching.
//
// The client imports the same module directly, which is what lets the
// "Numbers and sources" row stay live after a rewrite — it is a pure function of
// the document, so it does not need the server to recompute it.

export { scanFigures, collectPlaceholders, splitSentences } from "../src/engine/figures.js";
