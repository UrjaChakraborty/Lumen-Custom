// Front door for "Generate".
//
// AI generation always goes through the server endpoint. Failures are shown
// instead of silently substituting a deterministic local draft; the teacher can
// choose that alternative explicitly from the results screen.
import { generate as mockGenerate } from "./mockAI.js";
import { classifyResponse, classifyThrown, malformedPayload } from "./apiError.js";

// Exported so the UI can honour "use a local draft instead" without duplicating
// the shape the results screen expects.
export async function localDraft(input, opts = {}) {
  const mock = await mockGenerate(input, opts);
  return { ...mock, _source: "mock" };
}

export async function generateResource(input, opts = {}) {
  const body = opts.format ? { ...input, format: opts.format } : input;

  let res;
  try {
    res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Never present a local mock as an AI response. The results screen offers
    // the local engine as an explicit alternative after this error.
    throw classifyThrown(err);
  }

  if (!res.ok) {
    throw classifyResponse(res);
  }

  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.sections) || data.sections.length === 0) {
    throw malformedPayload();
  }

  return { ...data, _source: "gemini" };
}
