// Server-side enforcement of the PII screen.
//
// The screen used to be client-side only, and only on ONE of the three routes
// that reach the model. `/api/revise` and `/api/section` both take a
// plain-language directive the teacher types, and both sent it to Gemini
// unscreened. A request naming a student, their IEP status, their reading level
// and their 8-digit student ID returned HTTP 200 and went to Google — while the
// Method page told a union rep, in as many words, that Lumen "blocks the request
// if it finds a name beside a grade or an IEP reference, a student ID, an email
// address, a phone number, or a date of birth".
//
// Two things are wrong with a browser-only control. It is not a control at all
// against anything but the app's own UI, and — the reason it actually failed
// here — it has to be remembered at every call site. Six months of new features
// is six more chances to forget. This runs where the model call is made, so a
// future route cannot skip it by omission.
//
// The patterns are imported rather than restated. Two copies of "what counts as
// PII" would drift, and the copy that drifts is the one that stops matching.

import { screenForPII } from "../src/engine/piiScreen.js";

/**
 * @returns {Array} findings — empty when the payload is clean.
 */
export function screenRequest({ input, directive } = {}) {
  const findings = [...screenForPII(input || {})];
  if (typeof directive === "string" && directive.trim()) {
    findings.push(...screenForPII({ directive }));
  }
  return findings;
}

/**
 * Refuses the request. 400 rather than 422: from the caller's side the payload
 * is simply not something this API accepts.
 *
 * The matched samples go back in the response so the teacher sees exactly what
 * tripped it — it is their own text returning to their own browser. They are
 * deliberately NOT logged: `logRequest` records shape only, and writing the
 * matched substrings to a server log would create the very record this screen
 * exists to prevent.
 */
export function refusePII(res, findings) {
  return res.status(400).json({
    error:
      "This looks like it identifies a student, so it was not sent. Edit the highlighted text and try again.",
    code: "pii_detected",
    findings: findings.map((f) => ({
      field: f.field,
      fieldLabel: f.fieldLabel,
      id: f.id,
      label: f.label,
      samples: f.samples,
    })),
  });
}
