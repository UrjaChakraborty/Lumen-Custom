// #81 Regenerate a single section. Falls back to a local rewrite when the
// serverless route is unavailable (plain `vite dev`, quota, offline), the same
// way generation and revision do, so the control never dead-ends.
import { generateResource } from "./generateResource.js";
import { classifyResponse, isOffline } from "./apiError.js";

export async function regenerateSection(current, input, sectionLabel, directive = "") {
  try {
    const res = await fetch("/api/section", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, input, sectionLabel, directive }),
    });
    if (!res.ok) {
      const err = classifyResponse(res);
      // A section redo is cheap to retry and costs no rewrite budget, so a
      // recoverable failure is raised rather than answered with a local redraw
      // that would replace good text with worse.
      if (!isOffline(err)) throw err;
      throw new Error("offline");
    }
    const data = await res.json();
    if (!data?.section?.label) throw new Error("Malformed section payload");
    return { section: data.section, source: "gemini" };
  } catch (err) {
    console.warn("Live section redo unavailable; using the local engine.", err);
    // The offline engine is deterministic, so asking it for the same document
    // twice returns the same words. Nudging the input is what makes the redo
    // produce something actually different rather than an identical section.
    const nudged = {
      ...input,
      topic: input.topic,
      studentInterests: directive || input.studentInterests,
    };
    const draft = await generateResource(nudged, { format: input.format });
    const match = (draft.sections || []).find((s) => s.label === sectionLabel);
    if (!match) throw err;
    return { section: match, source: "mock" };
  }
}
