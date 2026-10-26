// Client-side security checks. Run with `npm run security:client`.
//
// The server suite (evals/security.mjs) covers the API. This covers the parts of
// the attack surface that live in the browser, which grew when restore-from-
// backup was added: the app now parses a JSON file the user hands it and writes
// the result into localStorage. That is untrusted input by definition — a
// teacher can be sent a "backup" by anyone.
//
// Also asserts the production CSP still matches the built page, because nothing
// else does. The policy pins a sha256 hash of the one inline script in
// index.html; edit that script and the hash goes stale, and the failure mode is
// the app breaking in production while every local test passes.

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { parseBackup, restoreBackup, mergeById } = await import("../src/data/backup.js");
const { loadClasses } = await import("../src/data/classes.js");
const { loadMaterials, groupMaterials, searchMaterials, estimatePages } = await import(
  "../src/data/materials.js"
);
const { screenForPII } = await import("../src/engine/piiScreen.js");
const { canonicalize } = await import("../src/engine/canonical.js");
const { scanFigures } = await import("../src/engine/figures.js");
const { deriveSources: deriveSrc } = await import("../api/_sources.js");

let passed = 0;
let failed = 0;
const failures = [];
function check(group, name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
  } else {
    failed++;
    failures.push(`${group}: ${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  \x1b[31m${detail}\x1b[0m` : ""}`);
  }
}

const envelope = (extra) => JSON.stringify({ format: "lumen-backup", version: 1, ...extra });

// ── Prototype pollution ────────────────────────────────────────────────────
// A poisoned backup must not be able to add properties to Object.prototype.
// Object spread uses CreateDataProperty rather than Set, so `{...evil}` is safe
// where Object.assign and hand-rolled recursive merges are not; these assert the
// property rather than trusting that nobody ever swaps the one for the other.
console.log("\n\x1b[1mprototype pollution via restore\x1b[0m");
{
  const vectors = {
    "__proto__ inside a class": envelope({
      classes: [JSON.parse('{"id":"a","__proto__":{"polluted":"yes"}}')],
    }),
    "__proto__ inside a material": envelope({
      materials: [JSON.parse('{"id":"m","__proto__":{"polluted":"yes"}}')],
    }),
    "__proto__ at the envelope root": '{"format":"lumen-backup","version":1,"__proto__":{"polluted":"yes"},"classes":[]}',
    "constructor.prototype nesting": envelope({
      classes: [JSON.parse('{"id":"a","constructor":{"prototype":{"polluted":"yes"}}}')],
    }),
    "id literally named __proto__": envelope({ classes: [{ id: "__proto__", label: "x" }] }),
    "deeply nested __proto__": envelope({
      materials: [JSON.parse('{"id":"m","output":{"sections":[{"__proto__":{"polluted":"yes"}}]}}')],
    }),
  };

  for (const [name, text] of Object.entries(vectors)) {
    const parsed = parseBackup(text);
    if (parsed.ok) {
      restoreBackup(parsed.data, {
        classes: [],
        setClasses: () => true,
        materials: [],
        setMaterials: () => true,
      });
    }
    const polluted =
      {}.polluted !== undefined || [].polluted !== undefined || Object.prototype.polluted !== undefined;
    check("proto", `survives ${name}`, !polluted, polluted ? "Object.prototype was modified" : "");
    delete Object.prototype.polluted;
  }

  // The same data going back through the real loaders, which spread onto blanks.
  store.set(
    "lumen-classes",
    '[{"id":"a","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}}}]'
  );
  const loaded = loadClasses();
  check(
    "proto",
    "loadClasses spread does not pollute",
    {}.polluted === undefined && {}.polluted2 === undefined,
    `${loaded.length} loaded`
  );
  delete Object.prototype.polluted;
  delete Object.prototype.polluted2;
  store.clear();
}

// ── Malformed / hostile shapes ─────────────────────────────────────────────
// A crash is a denial of service on the teacher's own saved work: if a poisoned
// file can throw inside a loader, the page white-screens and every subsequent
// visit hits the same stored value.
console.log("\n\x1b[1mhostile shapes do not crash\x1b[0m");
{
  const hostile = [
    ["classes as a string", envelope({ classes: "not an array" })],
    ["classes as a number", envelope({ classes: 42 })],
    ["material with a string output", envelope({ materials: [{ id: "m", output: "nope" }] })],
    ["material with null output", envelope({ materials: [{ id: "m", output: null }] })],
    ["material with an array title", envelope({ materials: [{ id: "m", title: ["a"] }] })],
    ["1000-deep nesting", envelope({ materials: [{ id: "m", output: JSON.parse("[".repeat(1000) + "]".repeat(1000)) }] })],
    ["huge id string", envelope({ classes: [{ id: "x".repeat(200_000) }] })],
  ];
  for (const [name, text] of hostile) {
    let threw = null;
    try {
      const p = parseBackup(text);
      if (p.ok) {
        restoreBackup(p.data, { classes: [], setClasses: () => true, materials: [], setMaterials: () => true });
        groupMaterials(p.data.materials, p.data.classes);
        searchMaterials(p.data.materials, "anything");
        p.data.materials.forEach((m) => estimatePages(m.output));
      }
    } catch (e) {
      threw = e.message;
    }
    check("shape", `survives ${name}`, threw === null, threw || "");
  }

  // Corrupted storage must degrade to empty, never throw on boot.
  for (const bad of ["{not json", "null", '"a string"', "12345", "[[[["]) {
    store.set("lumen-classes", bad);
    store.set("lumen-materials", bad);
    let threw = null;
    try {
      loadClasses();
      loadMaterials();
    } catch (e) {
      threw = e.message;
    }
    check("shape", `corrupted storage (${bad.slice(0, 10)}) loads as empty`, threw === null, threw || "");
  }
  store.clear();
}

// ── Injection payloads stay inert data ─────────────────────────────────────
// React escapes text, so the real risk is a payload reaching a URL or being
// pre-parsed. Assert the values survive as literal strings and that nothing in
// the pipeline turns them into markup or a scheme-bearing URL.
console.log("\n\x1b[1minjection payloads stay data\x1b[0m");
{
  const payloads = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "{{constructor.constructor('alert(1)')()}}",
    // Printable payloads only. Control and bidi characters are asserted in the
    // block below, because those ARE stripped rather than preserved: keeping a
    // payload inert as data and neutering a rendering-spoof character are two
    // different jobs, and one test should not assert both.
  ];
  for (const p of payloads) {
    const parsed = parseBackup(envelope({ materials: [{ id: "m", title: p, unit: p, topic: p }] }));
    const kept = parsed.ok ? parsed.data.materials[0] : null;
    check(
      "inject",
      `payload is preserved verbatim, not interpreted: ${p.slice(0, 26)}`,
      kept?.title === p,
      kept ? "" : "row dropped"
    );
  }
  // Search must not treat a payload as a pattern (no regex construction).
  let threw = null;
  try {
    searchMaterials([{ id: "m", title: "x", output: { sections: [] } }], "((((((((((");
  } catch (e) {
    threw = e.message;
  }
  check("inject", "search treats input as a literal, not a regex", threw === null, threw || "");
}

// ── Text-rendering spoofing (Trojan Source) ────────────────────────────────
// U+202E and friends reorder how surrounding text DISPLAYS without changing the
// characters. A backup arrives from outside the app, so a title carrying one can
// spoof the list around it, and anything exported afterwards carries it along.
console.log("\n\x1b[1mbidi / control characters are stripped from restored data\x1b[0m");
{
  const RLO = "‮";
  const cases = [
    ["right-to-left override", `Lesson${RLO}fdp.exe`],
    ["left-to-right embedding", "a‪b"],
    ["first strong isolate", "a⁦b⁩c"],
    ["arabic letter mark", "a؜b"],
    ["LRM / RLM", "a‎‏b"],
    ["NUL and bell", "a bc"],
  ];
  for (const [name, raw] of cases) {
    const p = parseBackup(envelope({ materials: [{ id: "m", title: raw }] }));
    const got = p.ok ? p.data.materials[0].title : null;
    const clean = typeof got === "string" && !/[ -؜‎‏‪-‮⁦-⁩]/.test(got);
    check("bidi", `strips ${name}`, clean, JSON.stringify(got));
  }
  // Legitimate right-to-left text must survive untouched.
  const arabic = "الجبر: الميل";
  const p = parseBackup(envelope({ materials: [{ id: "m", title: arabic }] }));
  check("bidi", "leaves ordinary right-to-left text alone", p.ok && p.data.materials[0].title === arabic, p.ok ? p.data.materials[0].title : "");

  // Depth cap: a deeply nested file must not blow the stack.
  let threw = null;
  try {
    const deep = JSON.parse("[".repeat(5000) + "]".repeat(5000));
    const r = parseBackup(envelope({ materials: [{ id: "m", output: deep }] }));
    if (r.ok) restoreBackup(r.data, { classes: [], setClasses: () => true, materials: [], setMaterials: () => true });
  } catch (e) {
    threw = e.message;
  }
  check("bidi", "5000-deep nesting does not overflow the stack", threw === null, threw || "");

  // Dangerous keys never survive the door.
  const poisoned = parseBackup(envelope({ classes: [JSON.parse('{"id":"a","__proto__":{"x":1},"constructor":{"y":2}}')] }));
  const keys = poisoned.ok ? Object.keys(poisoned.data.classes[0]) : [];
  check("bidi", "__proto__ / constructor keys are dropped on import",
    !keys.includes("__proto__") && !keys.includes("constructor"), keys.join(","));
}

// ── PII screen coverage ────────────────────────────────────────────────────
console.log("\n\x1b[1mPII screen covers every field that reaches the model\x1b[0m");
{
  // The gap that shipped: `directive` is what a teacher types into "Ask for a
  // change" and into a per-section redo. Both went to Gemini unscreened.
  const cases = [
    ["directive naming a student with an IEP", { directive: "make it easier for Marcus, who has an IEP" }],
    ["directive with a student ID", { directive: "student 20481956 needs a shorter version" }],
    ["directive with an email", { directive: "send it to jane.doe@example.com" }],
    ["directive with a phone number", { directive: "call 312-555-0142" }],
    ["topic with a named grade", { topic: "Aaliyah scored 42 on the quiz" }],
    ["interests with an SSN", { studentInterests: "123-45-6789" }],
  ];
  for (const [name, input] of cases) {
    const f = screenForPII(input);
    check("pii", `flags ${name}`, f.length > 0, f.map((x) => x.id).join(",") || "NOT FLAGGED");
  }
  // And stays quiet on ordinary teaching language.
  const clean = [
    { directive: "Shorten the warm-up to five minutes and add a visual." },
    { directive: "Make this work for multilingual learners and students with IEPs." },
    { topic: "Slope as a rate of change in the community garden" },
    { studentInterests: "Basketball, music production, cooking" },
  ];
  for (const c of clean) {
    const f = screenForPII(c);
    check("pii", `stays quiet on: ${Object.values(c)[0].slice(0, 40)}`, f.length === 0, f.map((x) => x.id).join(","));
  }
}


// ── Algorithmic complexity ────────────────────────────────────────────────
// /api/revise accepts a document the CALLER supplies, so every text scanner in
// the pipeline runs on input an attacker chooses. A quadratic scanner is a denial
// of service that needs no exploit, just a long paragraph — and it is invisible
// until someone sends one.
//
// scanFigures was measured at 741ms on 80KB of currency-dense prose, growing 15x
// for a 4x input: it was trimming and slicing the whole sentence once per MATCH.
console.log("\n\x1b[1mtext scanners stay linear on hostile input\x1b[0m");
{
  const time = (fn) => { const t = performance.now(); try { fn(); } catch {} return performance.now() - t; };
  const BUDGET_MS = 250;

  const inputs = {
    "currency-dense prose": (n) => "$1,234.56 average ".repeat(Math.ceil(n / 18)).slice(0, n),
    "one endless sentence": (n) => ("word ".repeat(20) + "42 percent typically ").repeat(Math.ceil(n / 120)).slice(0, n),
    "arithmetic soup": (n) => "1+1+1".repeat(Math.ceil(n / 5)).slice(0, n),
    "abbreviation storm": (n) => "U.S. ".repeat(Math.ceil(n / 5)).slice(0, n),
  };

  for (const [name, make] of Object.entries(inputs)) {
    const text = make(80_000);
    const doc = { sections: [{ label: "S", body: text, minutes: 5 }], familyBlurb: text };
    const ms = time(() => scanFigures(doc, {}));
    check("perf", `scanFigures: ${name} (80KB)`, ms < BUDGET_MS, `${Math.round(ms)}ms`);
    const ms2 = time(() => deriveSrc(doc, {}));
    check("perf", `deriveSources: ${name} (80KB)`, ms2 < BUDGET_MS, `${Math.round(ms2)}ms`);
  }

  // Growth check: 4x the input must not cost anywhere near 16x the time.
  const make = inputs["currency-dense prose"];
  const small = { sections: [{ label: "S", body: make(20_000), minutes: 5 }] };
  const big = { sections: [{ label: "S", body: make(80_000), minutes: 5 }] };
  const a = Math.max(1, time(() => scanFigures(small, {})));
  const b = time(() => scanFigures(big, {}));
  check("perf", "scanFigures growth is not quadratic", b / a < 8, `4x input cost ${(b / a).toFixed(1)}x time`);

  // The canonicaliser parses model output and restored-backup strings.
  for (const [name, text] of Object.entries({
    "digit run": "1".repeat(80_000),
    "term chain": "1+".repeat(40_000) + "1",
    "variable chain": "x+".repeat(40_000) + "y",
    "equation": "y=" + "2x+".repeat(26_000) + "1",
    "comma list": "1,".repeat(40_000) + "2",
    "open parens": "(".repeat(80_000),
  })) {
    const ms = time(() => canonicalize(text));
    check("perf", `canonicalize: ${name} (80KB)`, ms < BUDGET_MS, `${Math.round(ms)}ms`);
  }

  // And the scanners must still be CORRECT after the caps, not just fast.
  const real = {
    sections: [{ label: "Hook", body: "The average household spends $312 per year on electricity.", minutes: 5 }],
  };
  const still = scanFigures(real, {});
  check("perf", "…and still catches a fabricated statistic after the caps",
    still.asserted.length > 0, `${still.asserted.length} flagged`);
}

// ── Content Security Policy ────────────────────────────────────────────────
console.log("\n\x1b[1mproduction CSP\x1b[0m");
{
  const cfg = JSON.parse(readFileSync("vercel.json", "utf8"));
  const all = cfg.headers.flatMap((h) => h.headers);
  const csp = all.find((h) => h.key === "Content-Security-Policy")?.value || "";

  const required = {
    "default-src 'self'": /default-src 'self'/,
    "object-src 'none'": /object-src 'none'/,
    "frame-ancestors 'none' (clickjacking)": /frame-ancestors 'none'/,
    "base-uri 'self'": /base-uri 'self'/,
    "form-action 'self'": /form-action 'self'/,
    "connect-src 'self'": /connect-src 'self'/,
  };
  for (const [name, re] of Object.entries(required)) check("csp", `sets ${name}`, re.test(csp));
  check("csp", "script-src does NOT allow unsafe-inline", !/script-src[^;]*'unsafe-inline'/.test(csp), csp.match(/script-src[^;]*/)?.[0]);
  check("csp", "script-src does NOT allow unsafe-eval", !/script-src[^;]*'unsafe-eval'/.test(csp));
  for (const key of ["Strict-Transport-Security", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"])
    check("csp", `${key} is set`, all.some((h) => h.key === key));

  // The pinned hash must match the inline script actually shipped.
  if (!existsSync("dist/index.html")) {
    check("csp", "dist/index.html exists (run `npm run build` first)", false);
  } else {
    const html = readFileSync("dist/index.html", "utf8");
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const hashes = inline.map((s) => "sha256-" + createHash("sha256").update(s, "utf8").digest("base64"));
    const pinned = [...csp.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((m) => m[1]);
    check("csp", "every inline script in the build is pinned in the CSP",
      hashes.every((h) => pinned.includes(h)),
      `built=${hashes.join(",") || "none"} pinned=${pinned.join(",") || "none"}`);
    check("csp", "no stale pinned hash left behind",
      pinned.every((p) => hashes.includes(p)),
      `pinned=${pinned.join(",")}`);
  }
}

console.log(`\n${"─".repeat(62)}`);
console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(failed > 0 ? 1 : 0);
