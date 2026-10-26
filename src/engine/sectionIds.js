// Section identity, shared by the server schema and the client.
//
// #81 needs to name one section to regenerate, and an array index stops
// identifying the same section the moment a rewrite reorders or drops one.
//
// It lives here rather than in api/_schema.js because the client needs it too
// and _schema.js pulls in the Gemini SDK, which must never reach the bundle.
// One definition, imported from both sides, so the two cannot drift.

// A stable id per section.
export function sectionId(label, i) {
  const slug = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `s${i}-${slug}`;
}

// Backfill ids on a document whose sections have none.
//
// Two ways that happens, and neither is hypothetical: the offline fallback
// builds sections as { label, body } with no id, and any draft saved before
// sectionId existed is still sitting in a teacher's localStorage.
//
// Without an id, `editingSection === s.id` compared undefined to undefined and
// matched EVERY id-less section at once — one click on Edit opened an editor on
// all of them, and saving wrote the same text into all of them, because
// replaceSection matches the same way. The renderer already worked around this
// for React keys; nothing else did.
//
// Returns the document unchanged when every section already has an id, so
// reopening a normal draft allocates nothing.
export function withSectionIds(doc) {
  const sections = doc?.sections;
  if (!Array.isArray(sections) || sections.every((s) => s?.id)) return doc;
  return {
    ...doc,
    sections: sections.map((s, i) => (s?.id ? s : { ...s, id: sectionId(s?.label, i) })),
  };
}
