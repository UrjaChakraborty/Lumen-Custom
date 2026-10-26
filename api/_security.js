// api/_security.js
// Shared, dependency-free security guards for the serverless API routes.
// Vercel does NOT expose files whose names start with "_" as routes, so this
// module is import-only and never reachable over HTTP.
//
// Layers implemented here (see also vercel.json for edge/static headers):
//   1. Trusted client-IP resolution — everything below depends on identifying
//      the caller correctly, so this is the first thing that has to be right
//   2. Per-IP rate limiting (burst abuse / cost-DoS on the paid Gemini calls)
//   3. A global ceiling across all callers, because per-IP limits alone cannot
//      bound spend when the traffic is distributed
//   4. Same-origin enforcement (blocks cross-site / CSRF-style browser abuse)
//   5. Payload-size caps + strict allowlist sanitization (injection / oversized
//      body abuse, and bounding how much text we ever forward to Gemini)
//   6. Baseline per-response headers (no-store, nosniff, noindex, Vary)
//
// Two limitations, stated plainly rather than implied away:
//
// * Rate-limit state lives in module memory, so it is per-warm-instance, not
//   globally consistent across Vercel regions or instances. It reliably
//   throttles a client hammering a warm instance; for a hard multi-instance
//   guarantee back it with Vercel KV or Upstash Redis. The global ceiling has
//   the same caveat and is a cost brake, not a distributed quota.
// * Network-layer (L3/L4) volumetric DDoS is absorbed by the host edge, not
//   here. Nothing in this file would survive being the only thing in the path.

// ── Client IP ────────────────────────────────────────────────────────────
//
// This function decides who gets rate limited, so getting it wrong disables
// every protection built on top of it.
//
// It used to read the LEFTMOST value of x-forwarded-for. That field is a list
// the client can prefill: sending "X-Forwarded-For: 10.0.0.1" makes the leftmost
// entry attacker-chosen, and rotating it per request put every request in its
// own bucket. Measured before this fix: 25 requests with a rotating header
// produced zero 429s against a limit of 15. The rate limit, the cost ceiling
// and the abuse controls were all bypassable with one header.
//
// The trust model now, in order:
//   1. x-vercel-forwarded-for — set by Vercel's edge, which overwrites anything
//      the client sent, so it is authoritative there and nowhere else.
//   2. RIGHTMOST x-forwarded-for entry — each proxy APPENDS, so the last entry
//      is the one added by the hop closest to us. Client-supplied values can
//      only ever sit to the left of it.
//   3. socket address — the only value nobody can forge.
//
// Trust must be EARNED, not assumed. Taking the rightmost x-forwarded-for entry
// is only safe when a proxy we control actually appends one; if nothing
// appends, the rightmost entry is still whatever the client sent and the bypass
// is wide open. That is exactly what happened on the first attempt at this fix:
// the security suite still measured 0 of 25 requests refused with a rotating
// header, because in local dev no proxy appends anything.
//
// So proxy headers are consulted only when we can positively identify the proxy:
//   * running on Vercel (VERCEL=1), whose edge sets x-vercel-forwarded-for and
//     overwrites client-supplied values, or
//   * an operator explicitly opting in with TRUST_PROXY=true because they know
//     their own topology.
// Everywhere else, only the socket address counts. It is the one value a client
// cannot choose.
const ON_VERCEL = process.env.VERCEL === "1";
const TRUST_PROXY = process.env.TRUST_PROXY === "true" || ON_VERCEL;

// Vercel sets VERCEL_ENV to "production" on production deployments.
const IS_PRODUCTION =
  process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

// Rejects anything that is not plausibly an address, so a header full of junk
// cannot become a bucket key (or a log-injection vector).
const IP_SHAPE = /^[0-9a-fA-F:.]{3,45}$/;
const cleanIp = (v) => {
  const s = String(v || "").trim().replace(/^\[|\]$/g, "");
  return IP_SHAPE.test(s) ? s : null;
};

export function getClientIp(req) {
  const h = req.headers || {};
  const socketIp = cleanIp(req.socket?.remoteAddress);

  if (TRUST_PROXY) {
    // Only meaningful on Vercel, whose edge sets and overwrites this. Off
    // Vercel it would be just another client-supplied header.
    if (ON_VERCEL) {
      const vercel = cleanIp(h["x-vercel-forwarded-for"]);
      if (vercel) return vercel;
    }

    const xff = h["x-forwarded-for"];
    if (typeof xff === "string" && xff.length) {
      const parts = xff.split(",").map((p) => cleanIp(p)).filter(Boolean);
      // Rightmost, not leftmost. See the note above.
      if (parts.length) return parts[parts.length - 1];
    }

    const real = cleanIp(h["x-real-ip"]);
    if (real) return real;
  }

  return socketIp || "unknown";
}

// ── In-memory fixed-window rate limiter ────────────────────────────────────
//
// Global ceiling across ALL clients per window. Configurable so a deployment
// with a real quota can raise or lower it without a code change.
const GLOBAL_LIMIT = Number(process.env.GLOBAL_RATE_LIMIT) || 120;

const buckets = new Map();

export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.reset) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  // Bound memory: sweep expired buckets occasionally.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now >= v.reset) buckets.delete(k);
  }
  return {
    allowed: b.count <= limit,
    remaining: Math.max(0, limit - b.count),
    retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)),
    reset: Math.ceil(b.reset / 1000),
    limit,
  };
}

// ── Same-origin guard ──────────────────────────────────────────────────────
// Rejects browser requests whose Origin doesn't match the served host (cross-
// site / hotlink abuse). Requests with no Origin (curl, server-to-server, some
// health checks) are allowed through — they remain subject to rate limiting,
// validation, and can only ever produce a draft, never read data.
export function isAllowedOrigin(req) {
  const h = req.headers || {};
  const origin = h.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    if (o.host === h.host) return true;
    // Localhost is trusted only outside production. In production it is another
    // origin like any other: a developer's local page should not be able to
    // drive the deployed API and spend its quota.
    if (!IS_PRODUCTION && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o.host)) return true;
    return false;
  } catch {
    return false;
  }
}

// ── Content-Type guard ─────────────────────────────────────────────────────
// These three types are exactly what a cross-site HTML form can produce. A form
// POST needs no CORS preflight, so it is the classic way to reach an API from a
// page the user never meant to trust.
//
// The Origin check above already blocks that and is the control that matters.
// This is the second lock: it costs nothing, and it means a bug or a proxy quirk
// in Origin handling does not leave the door open by itself. Anything else —
// including a missing Content-Type from curl or a health check — is left alone,
// because that was never the browser-driven attack this closes.
const FORM_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
];

export function isAllowedContentType(req) {
  const raw = req.headers?.["content-type"];
  if (!raw) return true;
  const type = String(raw).split(";")[0].trim().toLowerCase();
  return !FORM_CONTENT_TYPES.includes(type);
}

// ── Body parsing + size cap ────────────────────────────────────────────────
// Forms are tiny; a full draft (for /api/revise) is a few KB. 64 KB is a
// generous ceiling that still blocks oversized-payload abuse.
export const MAX_BODY_BYTES = 64 * 1024;

export function parseBody(req) {
  const raw = req.body;
  if (typeof raw === "string") {
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return { error: "too_large" };
    if (!raw) return { data: {} };
    try {
      return { data: JSON.parse(raw) };
    } catch {
      return { error: "invalid_json" };
    }
  }
  if (raw && typeof raw === "object") {
    try {
      if (Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_BODY_BYTES) {
        return { error: "too_large" };
      }
    } catch {
      return { error: "invalid_json" };
    }
    return { data: raw };
  }
  return { data: {} };
}

// ── Input sanitization ─────────────────────────────────────────────────────
const MAX_FIELD = 2000;
const MAX_LONG = 8000;
const MAX_ARRAY = 40;
const ALLOWED_OUTPUT = new Set(["lesson", "activity", "assessment", "feedback"]);

// Matches ASCII control chars (U+0000–U+001F and U+007F). Tab/newline/CR are
// included and collapsed to spaces — the prompts are single-value fields.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

// Bidirectional formatting characters, removed rather than spaced.
//
// These are the "Trojan Source" class: U+202E and friends reorder how the
// SURROUNDING text renders without changing the characters themselves, so a
// string can display as something other than what it is. That matters here in
// two places a teacher would not expect. A restored backup is untrusted — anyone
// can send a teacher a .json file — and a title carrying an override can spoof the
// text around it in the materials list. And an exported handout or Markdown file
// carries the characters with it, so the spoof travels to whoever opens it.
//
// Dropped, not replaced with a space: they are zero-width, so substituting a
// space would visibly corrupt legitimate right-to-left text (Arabic, Hebrew)
// that a Chicago classroom may genuinely use. Removing only the explicit
// override/embedding/isolate controls leaves ordinary RTL text rendering
// correctly via the Unicode bidi algorithm.
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function cleanString(v, max = MAX_FIELD) {
  if (typeof v !== "string") return "";
  return v.replace(CONTROL_CHARS, " ").replace(BIDI_CONTROLS, "").slice(0, max).trim();
}

const STRING_FIELDS = [
  "subject",
  "course",
  "grade",
  "topic",
  "studentInterests",
  "communityContext",
  "culturalAssets",
  "language",
  "readingLevel",
  "resourceLevel",
  "outputType",
  "assistanceLevel",
  "format",
  "workSummary",
  // #41/#42 These reach the prompt as text. They were missing from this
  // allowlist while being present in the schema, the UI and the prompt, so they
  // were silently stripped on every request and the model never saw them.
  //
  // `unit` and `date` are deliberately NOT here. Per #39 they exist for grouping
  // in My materials and for the plan header, both of which are client side, and
  // nothing on the server reads them. An allowlist should permit what is used,
  // not everything the client happens to send.
  "lessonStructure",
  "lastClass",
];

const ALLOWED_CUSTOM_TASKS = new Set([
  "brainstormIdeas",
  "lessonOutline",
  "draftActivities",
  "discussionQuestions",
  "differentiationStrategies",
  "draftAssessment",
  "completeLesson",
]);

// Numeric fields, bounded rather than cleaned as strings.
//
// periodLength being absent from the allowlist was the most consequential of
// these: verifyTiming() received undefined, returned {ok:true, reason:"no timing
// data"}, and the timing check silently never ran. The prompt fell back to
// "Period length: 50 minutes" for every request, so a teacher asking for a 90
// minute block got a 50 minute lesson and no warning. classSize has the same
// shape of failure in the grouping plan and the copy counts.
const NUMBER_FIELDS = {
  // Shortest real period to a double block. Outside this a teacher has mistyped.
  periodLength: { min: 5, max: 240 },
  classSize: { min: 1, max: 100 },
};

export function sanitizeInput(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const f of STRING_FIELDS) {
    if (src[f] != null) out[f] = cleanString(src[f]);
  }
  if (Array.isArray(src.learningNeeds)) {
    out.learningNeeds = src.learningNeeds
      .slice(0, MAX_ARRAY)
      .map((x) => cleanString(x, 120))
      .filter(Boolean);
  }
  if (Array.isArray(src.customTasks)) {
    out.customTasks = [...new Set(src.customTasks.slice(0, 7).filter((task) => ALLOWED_CUSTOM_TASKS.has(task)))];
    if (out.customTasks.includes("completeLesson")) out.customTasks = ["completeLesson"];
  }
  for (const [f, { min, max }] of Object.entries(NUMBER_FIELDS)) {
    if (src[f] == null || src[f] === "") continue;
    const n = Number(src[f]);
    if (Number.isFinite(n)) out[f] = Math.min(max, Math.max(min, Math.round(n)));
  }

  // #40 Standards the teacher picked. Codes only, bounded and uppercased. The
  // dataset check in validateStandards() is still the gate that decides what
  // renders; this just stops an unbounded array reaching the prompt.
  if (Array.isArray(src.standards)) {
    out.standards = src.standards
      .slice(0, 12)
      .map((x) => cleanString(x, 40).toUpperCase())
      .filter(Boolean);
  }
  out.neurodiverseSupport = Boolean(src.neurodiverseSupport);
  out.lowTech = Boolean(src.lowTech);
  if (out.outputType && !ALLOWED_OUTPUT.has(out.outputType)) out.outputType = "lesson";
  if (!["minimal", "collaborative", "full"].includes(out.assistanceLevel)) {
    out.assistanceLevel = "full";
  }
  return out;
}

// Sanitize a "current" resource sent to /api/revise so we never forward
// unbounded attacker-controlled structure to the model.
// Bounded string-array cleaner, used for every list-shaped block below.
const cleanList = (a, max = MAX_FIELD) =>
  Array.isArray(a) ? a.slice(0, MAX_ARRAY).map((x) => cleanString(x, max)).filter(Boolean) : [];

// Bounded cleaner for the { a, b } record shape most blocks use.
const cleanPairs = (a, k1, k2) =>
  Array.isArray(a)
    ? a
        .slice(0, MAX_ARRAY)
        .map((x) => ({ [k1]: cleanString(x?.[k1], MAX_FIELD), [k2]: cleanString(x?.[k2], MAX_LONG) }))
        .filter((x) => x[k1] || x[k2])
    : [];

// Small, total, and used for every count that travels with a document.
function clampInt(v, lo, hi) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
}

export function sanitizeCurrent(current) {
  if (!current || typeof current !== "object") return null;
  const sections = Array.isArray(current.sections)
    ? current.sections.slice(0, MAX_ARRAY).map((s) => ({
        label: cleanString(s?.label, 300),
        body: Array.isArray(s?.body)
          ? s.body.slice(0, MAX_ARRAY).map((b) => cleanString(b, MAX_FIELD))
          : cleanString(s?.body, MAX_LONG),
        // Carried through so a rewrite can preserve or adjust them rather than
        // silently dropping the timing and audience tags the draft established.
        steps: cleanPairs(s?.steps, "teacher", "students"),
        minutes: Number.isFinite(Number(s?.minutes)) ? Math.round(Number(s.minutes)) : null,
        // Fails CLOSED. An unrecognised value means the model did not answer, and
        // the two directions are not symmetric: showing a teacher note to a
        // teacher is an annoyance, showing an answer key to a class is the exact
        // failure the typed-block split exists to prevent. Mirrored in
        // normalizeSections (_schema.js).
        audience: ["student", "teacher", "both"].includes(s?.audience) ? s.audience : "teacher",
      }))
    : [];

  const m = current.materials || {};
  const d = current.differentiation || {};
  return {
    kind: cleanString(current.kind, 40),
    title: cleanString(current.title, 400),
    // periodLength and standards are what the REVISE route checks against, and
    // both used to be dropped here. The consequences were not cosmetic:
    //
    //   verifyTiming(sections, current.periodLength)  ->  target = 0
    //     -> { ok: true, reason: "no timing data" }
    //
    // so a rewrite carrying 75 minutes of content for a 50-minute period
    // reported a PASS. The client recomputes timing from its own input, which is
    // the only reason teachers never saw it; the server response and the logs
    // carried a verdict nothing had earned.
    //
    // standards was the same shape of bug one layer further: revise.js tells the
    // model "return only codes that are already on the resource" while
    // currentToPromptJson had no codes to show it.
    periodLength: Number.isFinite(Number(current.periodLength))
      ? Math.min(240, Math.max(5, Math.round(Number(current.periodLength))))
      : null,
    // Same omission, same consequence as periodLength: verifyGrouping and
    // verifyPrintCounts both check against the class size, and checkReadability
    // needs the band. Dropped here, all three quietly report "unchecked" forever.
    classSize: Number.isFinite(Number(current.classSize))
      ? Math.min(100, Math.max(1, Math.round(Number(current.classSize))))
      : null,
    readingLevel: cleanString(current.readingLevel, 40),
    standards: Array.isArray(current.standards)
      ? current.standards.slice(0, 12).map((s) => cleanString(s?.code ?? s, 40)).filter(Boolean)
      : [],
    discussionQuestions: cleanList(current.discussionQuestions, 500).slice(0, 5),
    meta: Array.isArray(current.meta)
      ? current.meta.slice(0, 12).map((m2) => cleanString(m2, 200))
      : [],
    // The structured blocks travel with the document. Without these the rewrite
    // handler has nothing to merge against and every revision blanks them.
    materials: {
      print: cleanList(m.print),
      gather: cleanList(m.gather),
      setup: cleanList(m.setup),
    },
    vocabulary: Array.isArray(current.vocabulary)
      ? current.vocabulary.slice(0, MAX_ARRAY).map((v) => ({
          term: cleanString(v?.term, 200),
          definition: cleanString(v?.definition, MAX_FIELD),
          cognate: cleanString(v?.cognate, 200),
          frame: cleanString(v?.frame, MAX_FIELD),
        }))
      : [],
    misconceptions: cleanPairs(current.misconceptions, "misconception", "response"),
    differentiation: {
      below: cleanList(d.below),
      on: cleanList(d.on),
      above: cleanList(d.above),
      accommodations: cleanList(d.accommodations),
    },
    safety: cleanList(current.safety),
    familyBlurb: cleanString(current.familyBlurb, MAX_LONG),
    sources: cleanList(current.sources),
    answerKey: Array.isArray(current.answerKey)
      ? current.answerKey.slice(0, MAX_ARRAY).map((a) => ({
          question: cleanString(a?.question, MAX_FIELD),
          answer: cleanString(a?.answer, MAX_FIELD),
          // The normal form travels with the answer. Without it a rewrite hands
          // reconcile() a key with no canonical, so every equation, fraction and
          // multi-part answer drops back out of verification the moment a
          // teacher clicks a rewrite — the check silently narrows to what it
          // could do before src/engine/canonical.js existed.
          canonical: cleanString(a?.canonical, 200),
          work: cleanString(a?.work, MAX_LONG),
        }))
      : [],
    exitTicket: current.exitTicket
      ? {
          prompt: cleanString(current.exitTicket.prompt, MAX_FIELD),
          questions: cleanList(current.exitTicket.questions),
          key: cleanList(current.exitTicket.key),
          minutes: Number(current.exitTicket.minutes) || 0,
        }
      : null,
    // Carried, because a rewrite that silently drops the rubric is the same class
    // of bug as the dropped periodLength and the dropped grouping counts.
    rubric: current.rubric
      ? {
          levelNames: cleanList(current.rubric.levelNames),
          criteria: (Array.isArray(current.rubric.criteria) ? current.rubric.criteria : [])
            .slice(0, MAX_ARRAY)
            .map((c) => ({
              name: cleanString(c?.name, MAX_FIELD),
              levels: cleanList(c?.levels),
            })),
        }
      : null,
    homework: current.homework
      ? {
          task: cleanString(current.homework.task, MAX_LONG),
          extension: cleanString(current.homework.extension, MAX_LONG),
        }
      : null,
    grouping: current.grouping
      ? {
          formation: cleanString(current.grouping.formation, MAX_LONG),
          // Same failure as classSize above: verifyGrouping needs the typed
          // counts, and without them a rewrite of a draft whose grouping
          // reconciled reports "no stated counts" instead of "pass".
          groupCount: clampInt(current.grouping.groupCount, 0, 100),
          groupSize: clampInt(current.grouping.groupSize, 0, 100),
          leftover: clampInt(current.grouping.leftover, 0, 100),
          roles: cleanPairs(current.grouping.roles, "role", "does"),
        }
      : null,
    sections,
  };
}

// ── Combined guard: origin + rate limit + baseline headers ─────────────────
// Returns true if the request may proceed; otherwise it has already written a
// 403/429 response and the caller should return immediately.
export function runGuards(req, res, { limit = 15, windowMs = 60_000 } = {}) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");

  if (!isAllowedOrigin(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return false;
  }

  if (!isAllowedContentType(req)) {
    res.status(415).json({ error: "Unsupported content type." });
    return false;
  }

  const ip = getClientIp(req);
  const rl = rateLimit(`api:${ip}`, { limit, windowMs });
  res.setHeader("X-RateLimit-Limit", String(rl.limit));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(rl.reset));
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
    return false;
  }

  // Global ceiling, checked AFTER the per-IP limit so one abusive client is
  // still attributed to itself rather than eating the shared budget.
  //
  // Per-IP limiting cannot bound spend on its own: a hundred hosts each staying
  // politely under fifteen requests a minute is fifteen hundred Gemini calls a
  // minute, and every one of them is billable. This is the ceiling on the bill.
  // It is deliberately generous enough that a school full of teachers on one
  // NAT address never reaches it.
  const gl = rateLimit("api:__global__", { limit: GLOBAL_LIMIT, windowMs });
  if (!gl.allowed) {
    res.setHeader("Retry-After", String(gl.retryAfter));
    // 503, not 429: the caller did nothing wrong and retrying immediately is
    // not the fix. This is the service shedding load.
    res.status(503).json({
      error: "Lumen is at capacity right now. Please try again in a minute.",
    });
    return false;
  }
  return true;
}
