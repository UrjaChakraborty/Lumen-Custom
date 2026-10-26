// Reading the derived sources block, on the client.
//
// This lives in src/ rather than in api/_sources.js for a reason worth stating,
// because the build does not catch it. Vite bundles a cross-boundary import
// fine, so `npm run build` passed — but the dev server routes every /api/* path
// to the serverless handler, so a browser asking for /api/_sources.js got a 404
// and the whole page rendered blank. Production green, development broken.
//
// The rule the codebase follows: the SERVER may import from src/ (api/_pii.js
// and api/_figures.js both do), the client never imports from api/. Derivation
// stays server-side; reading the result is a client concern and belongs here.

export const ORIGIN_LABEL = {
  placeholder: "you fill this in",
  "your input": "from what you entered",
  "lesson timing": "the lesson's own timing",
  "no stated source": "no source",
  unresolved: "not traced",
  none: "",
  unchecked: "from an older draft",
};

// Documents saved before `sources` became derived carry an array of plain
// strings. Render them rather than dropping a teacher's saved content.
export function normalizeSourceRows(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) =>
    typeof row === "string"
      ? { origin: "unchecked", figure: "", detail: row }
      : { origin: row?.origin || "unchecked", figure: row?.figure || "", detail: row?.detail || "" }
  );
}

export function sourceRowsForDisplay(value) {
  return normalizeSourceRows(value).filter((row) => row.origin !== "none");
}
