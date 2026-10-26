// Front door for "Revise": rewrites the WHOLE resource through /api/revise.
//
// Only a genuinely absent API falls back to the local rewrite. Everything else
// is classified and thrown so the caller can offer a retry, because a rewrite
// is more costly to lose than a first draft: the teacher has already read and
// accepted this document, and spent one of ten rewrites asking for the change.
// Quietly answering that with a weaker local rewrite discards both.
//
// Returns the same { kind, title, meta, sections } shape either way, plus a
// `_source` flag ("gemini" | "mock") the UI uses to tell the teacher which one
// they're looking at.
import { reviseMock } from "./mockAI.js";
import { classifyResponse, classifyThrown, malformedPayload, isOffline } from "./apiError.js";

export async function reviseResource(current, input, directive, opts = {}) {
  const body = {
    input: opts.format ? { ...input, format: opts.format } : input,
    current,
    directive,
  };

  let res;
  try {
    res = await fetch("/api/revise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Nothing answered at all, which in plain `vite dev` is simply the truth.
    // The local rewrite is the honest response, not a downgrade we chose.
    if (!isOffline(classifyThrown(err))) throw classifyThrown(err);
    const mock = reviseMock(current, input, directive, opts.actionId);
    return { ...current, ...mock, _source: "mock" };
  }

  if (!res.ok) {
    const err = classifyResponse(res);
    if (isOffline(err)) {
      const mock = reviseMock(current, input, directive, opts.actionId);
      return { ...current, ...mock, _source: "mock" };
    }
    // A rewrite is far more costly to lose than a first draft: the teacher has
    // already accepted this document and spent one of ten rewrites on it.
    // Silently swapping in a local rewrite would discard their work, so a
    // recoverable failure is raised for the caller to retry.
    throw err;
  }

  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.sections) || data.sections.length === 0) {
    throw malformedPayload();
  }

  // Spread the draft first so any block the rewrite did not return survives.
  return { ...current, ...data, _source: "gemini" };
}
