// Data-safety checks: the grouping bug that hid materials, and backup/restore.
//
// Run with `npm run test:data`. No browser, no server. The modules under test
// touch localStorage, so a minimal in-memory shim is installed BEFORE they are
// imported — hence the dynamic imports below rather than static ones.

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { groupMaterials, UNGROUPED, ORPHANED, MAX_ITEMS } = await import(
  "../src/data/materials.js"
);
const { parseBackup, mergeById, restoreBackup, buildBackup, backupFilename } = await import(
  "../src/data/backup.js"
);
const { saveClasses, saveActiveClassId } = await import("../src/data/classes.js");
const { saveMaterials, makeMaterial, refileMaterial, knownUnits, sequenceUnit, unitStandards, SORTS } =
  await import("../src/data/materials.js");
const { verificationSummary, countWarnings } = await import(
  "../src/engine/verificationSummary.js"
);
const { canonicalize, canonicalEqual } = await import("../src/engine/canonical.js");
const { reconcile } = await import("../api/_math.js");
const { scanFigures } = await import("../src/engine/figures.js");
const { stripCitations, deriveSources } = await import("../api/_sources.js");
const { stripSelfCertification } = await import("../api/_style.js");
const {
  verifyGrouping, verifyPrintCounts, verifyTiming, reconcileNeedsMoreInfo,
  verifyStudentCopy, verifyQuestionsReachStudents, verifySafetyEarned,
  measureReadability,
} = await import("../api/_verify.js");
const { normalizeSections, countAudienceFallbacks, resolveAudience } = await import(
  "../api/_schema.js"
);
const { sanitizeCurrent } = await import("../api/_security.js");
const { sectionId, withSectionIds } = await import("../src/engine/sectionIds.js");

let passed = 0;
let failed = 0;
const failures = [];

function check(group, name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
  } else {
    failed += 1;
    failures.push(`${group}: ${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  \x1b[31m${detail}\x1b[0m` : ""}`);
  }
}

const mat = (id, classId, unit = "") => ({ id, classId, unit, savedAt: `2026-01-${id}`, title: id });
const cls = (id) => ({ id, label: id, course: "Algebra I" });

// Every material must land in exactly one group. This is the invariant the old
// code broke: materials pointing at a deleted class landed in none.
function accountedFor(list, classes) {
  const groups = groupMaterials(list, classes);
  const seen = [];
  for (const g of groups) for (const u of g.units) for (const item of u.items) seen.push(item.id);
  return { groups, seen };
}

console.log("\n\x1b[1mgroupMaterials\x1b[0m");
{
  // The regression itself. Before the fix this returned zero groups.
  const list = [mat("10", "c_gone")];
  const { groups, seen } = accountedFor(list, [cls("c_live")]);
  check("group", "material whose class was deleted is still rendered", seen.length === 1, `${groups.length} groups`);
  check("group", "…and lands in the orphan group", groups[0]?.classId === ORPHANED, groups[0]?.classId);
}
{
  const classes = [cls("a"), cls("b")];
  const list = [mat("1", "a"), mat("2", "b"), mat("3", null), mat("4", "dead"), mat("5", "a")];
  const { groups, seen } = accountedFor(list, classes);
  check("group", "mixed: every material appears exactly once", seen.length === 5 && new Set(seen).size === 5, seen.join(","));
  const ids = groups.map((g) => g.classId);
  check("group", "group order is classes, then unassigned, then orphaned", ids.join(">") === `a>b>${UNGROUPED}>${ORPHANED}`, ids.join(">"));
  check("group", "a live class still resolves its class object", groups[0]?.cls?.id === "a");
  check("group", "the orphan group carries no class object", groups[3]?.cls === null);
}
{
  const { seen } = accountedFor([mat("1", "x"), mat("2", "y")], []);
  check("group", "no classes at all: nothing is dropped", seen.length === 2, seen.join(","));
}
{
  const { seen } = accountedFor([mat("1", "a", "Unit 1"), mat("2", "a", "Unit 1"), mat("3", "a", "Unit 2")], [cls("a")]);
  check("group", "duplicate unit names do not collide", seen.length === 3, seen.join(","));
}
{
  let threw = false;
  try {
    groupMaterials([mat("1", "a")], undefined);
  } catch {
    threw = true;
  }
  check("group", "undefined classes does not throw", !threw);
}
{
  // The property, over shuffled input: total in === total out, always.
  let worst = null;
  for (let n = 0; n < 200; n += 1) {
    const classes = [cls("a"), cls("b")].slice(0, 1 + (n % 2));
    const list = Array.from({ length: n % 9 }, (_, i) =>
      mat(`m${i}`, [null, "a", "b", "dead", "alsodead"][(i + n) % 5], `U${i % 3}`)
    );
    const { seen } = accountedFor(list, classes);
    if (seen.length !== list.length) worst = `${list.length} in, ${seen.length} out`;
  }
  check("group", "200 shuffled cases: input count always equals output count", worst === null, worst || "");
}

// Every caller now branches on these. A writer that returns undefined reads as
// a failed write, which silently sent class saves down the "storage is full"
// path and cancelled the undo before it could be offered.
console.log("\n\x1b[1mstorage writers report success\x1b[0m");
{
  for (const [name, fn, arg] of [
    ["saveClasses", saveClasses, [cls("a")]],
    ["saveMaterials", saveMaterials, [mat("1", null)]],
    ["saveActiveClassId", saveActiveClassId, "a"],
  ]) {
    const got = fn(arg);
    check("writers", `${name} returns true on success`, got === true, `returned ${JSON.stringify(got)}`);
  }

  // And false — not undefined, not a throw — when the write is rejected.
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  const results = {
    saveClasses: saveClasses([cls("a")]),
    saveMaterials: saveMaterials([mat("1", null)]),
    saveActiveClassId: saveActiveClassId("a"),
  };
  globalThis.localStorage.setItem = realSet;
  for (const [name, got] of Object.entries(results)) {
    check("writers", `${name} returns false when storage rejects`, got === false, `returned ${JSON.stringify(got)}`);
  }
}

console.log("\n\x1b[1mparseBackup\x1b[0m");
{
  const bad = [
    ["not JSON", "{oops"],
    ["a JSON array", "[]"],
    ["null", "null"],
    ["an object with no format", JSON.stringify({ classes: [] })],
    ["someone else's JSON", JSON.stringify({ format: "other", version: 1 })],
    ["a newer version", JSON.stringify({ format: "lumen-backup", version: 99 })],
    ["a missing version", JSON.stringify({ format: "lumen-backup" })],
  ];
  for (const [label, text] of bad) {
    const r = parseBackup(text);
    check("parse", `refuses ${label}`, r.ok === false && typeof r.error === "string" && r.error.length > 0, r.ok ? "ACCEPTED" : "");
  }
  const good = parseBackup(JSON.stringify(buildBackup()));
  check("parse", "accepts a file Lumen just wrote", good.ok === true, good.ok ? "" : good.error);
}
{
  const text = JSON.stringify({
    format: "lumen-backup",
    version: 1,
    classes: [{ id: "a" }, { nope: true }, null, { id: 7 }, { id: "" }],
    materials: "not an array",
    reports: undefined,
  });
  const r = parseBackup(text);
  check("parse", "drops rows that have no usable id", r.ok && r.data.classes.length === 1, r.ok ? `${r.data.classes.length} kept` : r.error);
  check("parse", "a non-array section becomes an empty array", r.ok && Array.isArray(r.data.materials) && r.data.materials.length === 0);
}

console.log("\n\x1b[1mmergeById\x1b[0m");
{
  const current = [{ id: "1", v: "new" }, { id: "2", v: "new" }];
  const incoming = [{ id: "1", v: "old" }, { id: "3", v: "old" }];
  const { list, added } = mergeById(current, incoming);
  check("merge", "adds only the ids that are missing", added === 1 && list.length === 3, `added ${added}`);
  check("merge", "an edited item is NOT overwritten by the backup's copy", list.find((x) => x.id === "1").v === "new");
  check("merge", "empty current merges cleanly", mergeById([], incoming).added === 2);
  check("merge", "empty incoming changes nothing", mergeById(current, []).added === 0);
  check("merge", "undefined arguments do not throw", mergeById(undefined, undefined).list.length === 0);
}

console.log("\n\x1b[1mrestoreBackup\x1b[0m");
{
  // The scenario the merge rule exists for: an October backup opened in March.
  let savedClasses = null;
  let savedMaterials = null;
  const classes = [cls("sept"), cls("march")];
  const materials = [mat("m_new", "march")];
  const data = { classes: [cls("sept")], materials: [mat("m_old", "sept")], reports: [] };
  const r = restoreBackup(data, {
    classes,
    setClasses: (v) => ((savedClasses = v), true),
    materials,
    setMaterials: (v) => ((savedMaterials = v), true),
  });
  check("restore", "an old backup does not wipe newer work", r.ok && savedMaterials.some((x) => x.id === "m_new"));
  check("restore", "the backup's missing material is added", savedMaterials.some((x) => x.id === "m_old"), `${savedMaterials.length} total`);
  check("restore", "a class already present is not duplicated", savedClasses === null, savedClasses ? `wrote ${savedClasses.length}` : "no write needed");
  check("restore", "reports the real number added", r.added.materials === 1 && r.added.classes === 0, JSON.stringify(r.added));
}
{
  const r = restoreBackup({ classes: [], materials: [], reports: [] }, {
    classes: [cls("a")],
    setClasses: () => true,
    materials: [],
    setMaterials: () => true,
  });
  check("restore", "an empty backup reports nothing added", r.ok && r.added.classes === 0 && r.added.materials === 0);
}
{
  // saveMaterials silently truncates at MAX_ITEMS; a restore must say so.
  const many = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => mat(`x${i}`, null));
  const r = restoreBackup({ classes: [], materials: many, reports: [] }, {
    classes: [],
    setClasses: () => true,
    materials: [],
    setMaterials: () => true,
  });
  check("restore", "reports how many were over the storage cap", r.ok && r.truncated === 5, `truncated ${r.truncated}`);
}
{
  const r = restoreBackup({ classes: [cls("a")], materials: [], reports: [] }, {
    classes: [],
    setClasses: () => false, // localStorage rejected the write
    materials: [],
    setMaterials: () => true,
  });
  check("restore", "a failed write is reported, not swallowed", r.ok === false && /storage/i.test(r.error), r.error || "");
}

console.log("\n\x1b[1mround trip\x1b[0m");
{
  const json = JSON.stringify(buildBackup());
  const parsed = parseBackup(json);
  check("trip", "buildBackup output parses back", parsed.ok === true, parsed.ok ? "" : parsed.error);
  check("trip", "filename is dated and .json", /^lumen-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backupFilename()), backupFilename());
}

// The module's own rule: three states, never two. A check that did not resolve
// must never render as one that passed.
console.log("\n\x1b[1mverification summary honesty\x1b[0m");
{
  const doc = (math, extra = {}) => ({
    sections: [{ label: "A", minutes: 25 }, { label: "B", minutes: 25 }],
    answerKey: [{ question: "q", answer: "3 inches per week", work: "12 / 4 = 3" }],
    verification: {
      timing: { ok: true, total: 50, target: 50 },
      readability: { ok: true, grade: 9, band: [8, 11] },
      placeholders: 0,
      math,
      budget: { used: 3, max: 4, skipped: [] },
    },
    ...extra,
  });
  const input = { periodLength: 50, readingLevel: "on-grade" };
  const mathRow = (math, extra) =>
    verificationSummary(doc(math, extra), input).find((r) => r.id === "math");

  // The regression: checked but neither confirmed nor disputed. reconcile()
  // produces this when the independent solver could not solve or compare the
  // answer. It used to render as a green "0 of 1 confirmed".
  const unresolved = mathRow({ checked: 1, disputed: 0, confirmed: 0 });
  check("verify", "checked-but-unconfirmed is NOT a pass", unresolved.state === "unchecked", `state=${unresolved.state}`);
  check("verify", "…and says so in words", /could not be re-solved/i.test(unresolved.detail), unresolved.detail);

  const partial = mathRow({ checked: 3, disputed: 0, confirmed: 2 });
  check("verify", "a partial confirmation is not a pass either", partial.state === "unchecked", `state=${partial.state}`);
  check("verify", "…and names how many are unverified", /2 of 3/.test(partial.detail), partial.detail);

  const all = mathRow({ checked: 2, disputed: 0, confirmed: 2 });
  check("verify", "fully confirmed IS a pass", all.state === "pass", `state=${all.state}`);

  const bad = mathRow({ checked: 2, disputed: 1, confirmed: 1 });
  check("verify", "a disputed answer warns", bad.state === "warn", `state=${bad.state}`);

  const none = mathRow({ checked: 0, disputed: 0, confirmed: 0 });
  check("verify", "nothing numeric to check is unchecked, not passed", none.state === "unchecked", `state=${none.state}`);

  const skipped = verificationSummary(
    { ...doc({ checked: 1, disputed: 0, confirmed: 1 }), verification: {
      ...doc({ checked: 1, disputed: 0, confirmed: 1 }).verification,
      budget: { used: 4, max: 4, skipped: ["verify-math"] } } },
    input
  ).find((r) => r.id === "math");
  check("verify", "a skipped check never reads as a passed one", skipped.state === "unchecked", `state=${skipped.state}`);

  // A rewrite invalidates every model-dependent check.
  const revised = verificationSummary(doc({ checked: 2, disputed: 0, confirmed: 2 }, { _label: "Shorter" }), input);
  check("verify", "after a rewrite, reading level is stale not fresh",
    revised.find((r) => r.id === "readability").state === "unchecked");
  check("verify", "after a rewrite, the answer key is stale not fresh",
    revised.find((r) => r.id === "math").state === "unchecked");
  check("verify", "timing is recomputed, so it stays live after a rewrite",
    revised.find((r) => r.id === "timing").state === "pass");

  check("verify", "cultural fit is never given a verdict",
    verificationSummary(doc({ checked: 0, disputed: 0, confirmed: 0 }), input)
      .find((r) => r.id === "cultural").state === "judgement");
  check("verify", "no verification at all returns null rather than an empty shell",
    verificationSummary({ sections: [] }, input) === null);
  check("verify", "unchecked rows are not counted as warnings",
    countWarnings(verificationSummary(doc({ checked: 1, disputed: 0, confirmed: 0 }), input)) === 0);
}


// ── Anti-hallucination ─────────────────────────────────────────────────────
// The gating test is the FALSE POSITIVE corpus. This is a tool for STEM
// teachers: if the figure scanner warns on the numbers in a kinematics lesson,
// teachers learn to ignore the panel and every other check goes with it.
console.log("\n\x1b[1mfigure scanner: legitimate STEM numbers must not warn\x1b[0m");
{
  const prose = (body) => ({ sections: [{ label: "Main activity", minutes: 20, body }] });
  const legit = [
    ["kinematics", "Suppose a cart rolls down a ramp at 3 m/s. If the ramp is 12 meters long, calculate the time. Each group records 5 trials."],
    ["slope", "Consider a line through (2, 5) and (6, 13). If the tank drains 4 litres every 3 minutes, what is the rate of change?"],
    ["stoichiometry", "Imagine a solution that is 30% salt by mass. If you have 250 grams, how much salt is present? Assume a density of 1.2 g/mL."],
    ["percent word problem", "Suppose a population of 1,200 bacteria grows by 15 percent each hour. Predict the count after 3 hours."],
    ["historical date in context", "Students compare their results with the 1905 paper they read for homework."],
    ["enumerated steps", "Complete step 3 and question 5 before moving on."],
  ];
  for (const [name, body] of legit) {
    const r = scanFigures(prose(body), { classSize: 28, periodLength: 50 });
    check("figures", `no warning on ${name}`, r.asserted.length === 0,
      r.asserted.map((a) => a.figure).join(", "));
  }

  const fabricated = [
    ["invented currency statistic", "The average household in Chicago spends $312 per year on electricity."],
    ["invented percentage", "Nationwide, 68 percent of families report struggling with utility bills."],
    ["invented per-capita figure", "Residents use roughly 90 gallons of water per capita annually."],
  ];
  for (const [name, body] of fabricated) {
    const r = scanFigures(prose(body), {});
    check("figures", `warns on ${name}`, r.asserted.length > 0,
      r.asserted.map((a) => a.figure).join(", ") || "NOT FLAGGED");
  }

  const masked = scanFigures(
    prose("The average household spends [insert current data: annual electricity cost] per year."), {});
  check("figures", "a placeholder is not an invented figure", masked.asserted.length === 0);

  const traced = scanFigures(prose("Families here spend about $312 a year, as you noted."),
    { communityContext: "utility bills near $312 a year" });
  check("figures", "a figure traced to your own input is exempt", traced.asserted.length === 0,
    `${traced.traced.length} traced`);

  // Scope: items[] is where questions live and must not be scanned as prose.
  const inItems = scanFigures(
    { sections: [{ label: "Practice", minutes: 10, body: ["The average is 312 per year"] }] }, {});
  check("figures", "list items are out of scope", inItems.asserted.length === 0);
}

console.log("\n\x1b[1mcitations cannot survive\x1b[0m");
{
  const doc = { sections: [
    { label: "Hook", body: "Costs vary. Source: U.S. Energy Information Administration, Residential Energy Consumption Survey (2020). Students discuss." },
    { label: "Read", body: "Background is at https://example.gov/rates and in Smith et al." },
    { label: "Clean", body: "Students graph their results in 2026 and compare with a partner." },
  ]};
  const r = stripCitations(doc);
  check("cite", "a sentence that is only a citation is removed", r.removed === 1, `removed ${r.removed}`);
  check("cite", "URL is detected", r.findings.some((f) => f.id === "url"));
  check("cite", "et al. is detected", r.findings.some((f) => f.id === "etal"));
  check("cite", "ordinary prose containing a year is untouched",
    doc.sections[2].body === "Students graph their results in 2026 and compare with a partner.");
  check("cite", "the citation sentence is gone from the body", !doc.sections[0].body.includes("Energy Information"));

  const empty = deriveSources({ sections: [{ label: "A", minutes: 5, body: "Students compare two graphs." }] }, {});
  check("cite", "a draft with no figures declares no external data",
    empty.rows.length === 1 && empty.rows[0].origin === "none", empty.rows[0].detail);
  const unsourced = deriveSources({ sections: [{ label: "Hook", minutes: 5,
    body: "The average household spends $312 per year." }] }, {});
  check("cite", "an unsourced figure produces a no-stated-source row",
    unsourced.rows.some((r2) => r2.origin === "no stated source"));
}

console.log("\n\x1b[1mclass-size arithmetic\x1b[0m");
{
  const g = (o, n) => verifyGrouping(o, n).state;
  check("arith", "7 x 4 + 0 = 28 passes", g({ formation: "Form 7 groups of 4.", groupCount: 7, groupSize: 4, leftover: 0 }, 28) === "pass");
  check("arith", "6 x 4 + 0 for 28 warns", g({ formation: "Form 6 groups of 4.", groupCount: 6, groupSize: 4, leftover: 0 }, 28) === "warn");
  check("arith", "prose disagreeing with the counts warns", g({ formation: "Form 6 groups of 4.", groupCount: 7, groupSize: 4, leftover: 0 }, 28) === "warn");
  check("arith", "a leftover big enough for another group warns", g({ formation: "Form 5 groups of 4.", groupCount: 5, groupSize: 4, leftover: 8 }, 28) === "warn");
  check("arith", "no class size is unchecked, not passed", g({ formation: "Groups.", groupCount: 7, groupSize: 4, leftover: 0 }, 0) === "unchecked");

  const p = (items, n, gr) => verifyPrintCounts({ print: items }, n, gr);
  check("arith", "28 copies for 28 passes", p(["Handout: 28 copies"], 28).state === "pass");
  check("arith", "30 copies for 28 passes as spares", p(["Handout: 30 copies"], 28).state === "pass");
  check("arith", "20 copies for 32 warns", p(["Handout: 20 copies"], 32).state === "warn");
  check("arith", "one per group passes", p(["Lab card: 7 copies, one per group"], 28, { groupCount: 7 }).state === "pass");
  check("arith", "counts demanded but absent is unchecked", p(["Handout"], 28).state === "unchecked");

  const t = verifyTiming([{ minutes: 50 }], 50, [{ label: "Exit ticket", minutes: 10 }]);
  check("arith", "an exit ticket past the bell is reported", t.overrun.ok === false && t.overrun.grandTotal === 60);
  check("arith", "…but does not corrupt the retry delta", t.delta === 0 && t.ok === true);
}

console.log("\n\x1b[1mdead checks stay alive\x1b[0m");
{
  // The regression: sanitizeCurrent dropped periodLength, so verifyTiming got
  // undefined and returned ok:true on a rewrite that overran by 25 minutes.
  const doc = { kind: "lesson", title: "T", periodLength: 50, classSize: 28, standards: ["HSF.IF.B.4"],
    sections: [{ label: "A", body: "x", minutes: 40 }, { label: "B", body: "y", minutes: 35, audience: "bogus" }] };
  const c = sanitizeCurrent(doc);
  check("dead", "periodLength survives sanitizeCurrent", c.periodLength === 50, String(c.periodLength));
  check("dead", "standards survive sanitizeCurrent", JSON.stringify(c.standards) === '["HSF.IF.B.4"]', JSON.stringify(c.standards));
  check("dead", "classSize survives sanitizeCurrent", c.classSize === 28, String(c.classSize));
  const t = verifyTiming(c.sections, c.periodLength);
  check("dead", "a 75-minute rewrite of a 50-minute period is NOT a pass", t.ok === false && t.delta === 25,
    JSON.stringify(t));
  check("dead", "an unknown audience fails closed to teacher", c.sections[1].audience === "teacher", c.sections[1].audience);
}

console.log("\n\x1b[1mself-certification and abstention\x1b[0m");
{
  const doc = { sections: [
    { label: "Overview", body: "This UDL-aligned, culturally responsive lesson maintains rigor. Students graph two functions." },
    { label: "Setup", body: "Align the two graphs on the same axes. Make sure seating is accessible at each station." },
  ]};
  const r = stripSelfCertification(doc);
  check("selfcert", "a sentence that only certifies is removed", r.removed === 1, `removed ${r.removed}`);
  check("selfcert", "legitimate 'align' and 'accessible' survive",
    doc.sections[1].body === "Align the two graphs on the same axes. Make sure seating is accessible at each station.");

  const nmi = reconcileNeedsMoreInfo(["topic"], { missingFields: ["class size"], junkFields: [] }, false);
  check("selfcert", "a measured gap the model omitted is added", nmi.added.includes("class size"));
  check("selfcert", "missing cultural inputs are added", nmi.added.includes("student interests"));
  const none = reconcileNeedsMoreInfo(["class size"], { missingFields: ["class size"], junkFields: [] }, true);
  check("selfcert", "nothing is double-added", none.added.length === 0, none.added.join(","));
}


// The answer key is the strongest check in the product, and it only ever compared
// one shape: a regex that returned null unless a string held exactly ONE number.
// Every row below marked "was unverifiable" silently dropped out of verification
// and reported to the teacher as "could not be re-solved".
console.log("\n\x1b[1mcanonical answers: the shapes that used to be unverifiable\x1b[0m");
{
  const agree = [
    ["scalar with a label", "m = 2", "2"],
    ["a number with units", "7.5 meters per minute", "7.5"],
    ["equation, terms reordered", "y = -4x + 10", "y = 10 - 4x"],
    ["equation, different spacing", "y=-4x+10", "y = -4x + 10"],
    ["fraction against its decimal", "3/4", "0.75"],
    ["multi-part answer", "x = 2, y = 5", "x=2, y=5"],
    ["categorical", "Negative slope", "negative"],
    ["the word zero against 0", "zero", "0"],
    ["percent against percent", "25%", "25 %"],
    ["a coordinate pair in brackets", "(0, 5)", "0,5"],
    ["coordinate pairs, both bracketed", "(0,5)", "(0, 5)"],
    ["a negative coordinate", "(2, -3)", "2,-3"],
  ];
  for (const [name, a, b] of agree) {
    check("canon", `agrees: ${name}`, canonicalEqual(a, b) === true,
      `${JSON.stringify(canonicalize(a))} vs ${JSON.stringify(canonicalize(b))}`);
  }

  // A wrong answer must still be caught. Widening what can be compared is only
  // worth anything if disagreement still reads as disagreement.
  const disagree = [
    ["a genuinely wrong equation", "y = -4x + 10", "y = 4x + 10"],
    ["a wrong scalar", "m = 2", "3"],
    ["tuple order matters", "x = 2, y = 5", "x=5, y=2"],
    ["the opposite category", "Negative slope", "positive"],
    ["a wrong percent", "25%", "30%"],
  ];
  for (const [name, a, b] of disagree) {
    check("canon", `disputes: ${name}`, canonicalEqual(a, b) === false, `${a} vs ${b}`);
  }

  // Not comparable is UNCHECKED, never agreement and never a dispute. Claiming a
  // disagreement out of a notation difference is how a panel gets ignored.
  const unknown = [
    ["open prose", "Answers will vary", "varies"],
    ["percent against a bare decimal", "25%", "0.25"],
    ["an equation against a lone number", "y = 2x", "4"],
    ["ambiguous prose with two category words", "negative and decreasing", "negative"],
    // Prose that happens to contain two numbers is NOT a tuple. Reading it as
    // one would confirm "increases by 3 inches every 2 minutes" against the
    // pair (3,2), which is a confident answer to a question nobody asked.
    ["prose with incidental numbers", "increases by 3 inches every 2 minutes", "3,2"],
  ];
  for (const [name, a, b] of unknown) {
    check("canon", `unchecked: ${name}`, canonicalEqual(a, b) === null, `${a} vs ${b}`);
  }

  check("canon", "an unparseable answer has kind '' (never a silent pass)",
    canonicalize("it depends on the sample").kind === "");
  // Bracket-stripping must not turn a function into a tuple.
  check("canon", "f(x) = 2 is not mangled into a tuple",
    canonicalize("f(x) = 2").kind !== "tuple", canonicalize("f(x) = 2").kind || "unparsed");
}

// `canonical` is model output, so it is not evidence. The server canonicalises
// the prose answer itself and treats a mismatch as the draft contradicting
// itself — which needs no solver and cannot be explained away as notation.
console.log("\n\x1b[1mthe model's canonical is checked, not trusted\x1b[0m");
{
  const run = (answer, canonical, solved) =>
    reconcile(
      [{ question: "q", answer, canonical, work: "" }],
      [{ index: 0, solvable: true, numeric: "", canonical: solved, answer: solved }]
    );

  const contra = run("y = -4x + 10", "y=4x+10", "y = -4x + 10");
  check("canon", "a self-contradicting entry is disputed",
    contra.answerKey[0].disputed === true && contra.answerKey[0].disputeKind === "self-contradiction",
    contra.answerKey[0].disputeKind || "not disputed");
  check("canon", "…and is counted separately from solver disagreements",
    contra.selfContradictions === 1, String(contra.selfContradictions));

  const ok = run("y = -4x + 10", "y=-4x+10", "y = 10 - 4x");
  check("canon", "an honest entry still confirms", ok.answerKey[0].verified === true);

  const wrong = run("y = -4x + 10", "y=-4x+10", "y = 4x + 10");
  check("canon", "a solver disagreement still disputes",
    wrong.answerKey[0].disputed === true && wrong.answerKey[0].disputeKind === "second-solve",
    wrong.answerKey[0].disputeKind || "not disputed");

  const prose = run("Answers will vary", "", "");
  check("canon", "prose stays unchecked, not confirmed",
    !prose.answerKey[0].verified && !prose.answerKey[0].disputed);

  // The legacy numeric path must keep working for anything canonical cannot read.
  const legacy = run("about 4.50 dollars per item", "", "4.50");
  check("canon", "the numeric fallback still confirms what it used to",
    legacy.answerKey[0].verified === true);
}


// A field dropped in sanitizeCurrent does not fail loudly — the check that needed
// it just starts reporting "unchecked" on every rewrite, forever. This has now
// happened three times (periodLength, standards, then the grouping integers and
// the canonical answer form), so it gets a test that names every field a check
// depends on rather than one test per incident.
console.log("\n\x1b[1msanitizeCurrent carries everything the checks need\x1b[0m");
{
  const doc = {
    kind: "lesson",
    title: "T",
    periodLength: 50,
    classSize: 28,
    readingLevel: "on-grade",
    standards: ["HSF.IF.B.4"],
    sections: [{ label: "A", body: "x", minutes: 40, audience: "both" }],
    answerKey: [{ question: "q", answer: "y = 2x", canonical: "y=2x", work: "" }],
    grouping: { formation: "Form 7 groups of 4.", groupCount: 7, groupSize: 4, leftover: 0, roles: [] },
    materials: { print: ["Handout: 28 copies"], gather: [], setup: [] },
    exitTicket: { prompt: "p", questions: ["q"], key: ["2"], minutes: 5 },
    rubric: { levelNames: ["Strong", "Developing"], criteria: [{ name: "Reasoning", levels: ["Clear", "Emerging"] }] },
  };
  const s = sanitizeCurrent(doc);

  const required = {
    periodLength: s.periodLength === 50,
    classSize: s.classSize === 28,
    readingLevel: s.readingLevel === "on-grade",
    standards: Array.isArray(s.standards) && s.standards[0] === "HSF.IF.B.4",
    "answerKey[].canonical": s.answerKey?.[0]?.canonical === "y=2x",
    "grouping.groupCount": s.grouping?.groupCount === 7,
    "grouping.groupSize": s.grouping?.groupSize === 4,
    "grouping.leftover": s.grouping?.leftover === 0,
    "materials.print": s.materials?.print?.length === 1,
    "exitTicket.minutes": s.exitTicket?.minutes === 5,
    "rubric.levelNames": s.rubric?.levelNames?.length === 2,
    "rubric.criteria": s.rubric?.criteria?.[0]?.levels?.length === 2,
  };
  for (const [field, ok] of Object.entries(required)) {
    check("sanitize", `carries ${field} through a rewrite`, ok);
  }

  // And the checks that consume them must reach the same verdict either side.
  check("sanitize", "verifyGrouping agrees before and after sanitising",
    JSON.stringify(verifyGrouping(doc.grouping, doc.classSize)) ===
      JSON.stringify(verifyGrouping(s.grouping, s.classSize)),
    JSON.stringify(verifyGrouping(s.grouping, s.classSize)));
  check("sanitize", "verifyPrintCounts agrees before and after sanitising",
    verifyPrintCounts(s.materials, s.classSize, s.grouping).state === "pass",
    verifyPrintCounts(s.materials, s.classSize, s.grouping).state);
  check("sanitize", "verifyTiming is live, not a false pass",
    verifyTiming(s.sections, s.periodLength).ok === false,
    JSON.stringify(verifyTiming(s.sections, s.periodLength)));

  // Numeric fields are still clamped, not just carried.
  const wild = sanitizeCurrent({ kind: "lesson", classSize: 99999, periodLength: -5, sections: [],
    grouping: { formation: "x", groupCount: 1e9, groupSize: -3, leftover: 99999, roles: [] } });
  check("sanitize", "out-of-range counts are clamped, not trusted",
    wild.classSize === 100 && wild.periodLength === 5 &&
    wild.grouping.groupCount === 100 && wild.grouping.groupSize === 0 && wild.grouping.leftover === 100,
    JSON.stringify({ c: wild.classSize, p: wild.periodLength, g: wild.grouping }));
}


// Where a material is FILED is a property of the record, not of whatever the
// builder happened to be showing. Three bugs came from re-deriving it on save:
// opening a Biology lesson while another class was active silently moved it,
// refiling from My materials was reverted by the next autosave, and drafting a
// new lesson while one was open overwrote that record. The UI now holds filing
// as state seeded from the record; these lock the data layer it rests on.
console.log("\n\x1b[1mfiling is stored, never re-derived\x1b[0m");
{
  const out = { title: "T", sections: [] };
  const m = makeMaterial({ output: out, input: { unit: "FROM INPUT" }, classId: "c_bio", unit: "Unit 9" });
  check("filing", "makeMaterial stores exactly the classId it is given", m.classId === "c_bio", m.classId);
  check("filing", "…and exactly the unit it is given, not input.unit", m.unit === "Unit 9", m.unit);
  const blank = makeMaterial({ output: out, input: {}, classId: null, unit: "" });
  check("filing", "an unassigned material keeps a null classId", blank.classId === null, String(blank.classId));

  const list = [
    { id: "a", classId: "c1", unit: "U1", title: "A", savedAt: "2026-01-01", input: { lessonDate: "2026-09-02" } },
    { id: "b", classId: "c1", unit: "U1", title: "B", savedAt: "2026-02-01", input: { lessonDate: "2026-09-01" } },
    { id: "c", classId: null, unit: "", title: "C", savedAt: "2026-03-01", input: {} },
  ];
  const moved = refileMaterial(list, "a", { classId: "c2", unit: "U2" });
  check("filing", "refile moves only the named material",
    moved[0].classId === "c2" && moved[0].unit === "U2" && moved[1].classId === "c1", JSON.stringify(moved[0]).slice(0, 60));
  check("filing", "refile to no class stores null, not an empty string",
    refileMaterial(list, "a", { classId: "" })[0].classId === null);
  check("filing", "refiling the unit alone leaves the class alone",
    refileMaterial(list, "a", { unit: "U3" })[0].classId === "c1");
  check("filing", "refile trims the unit", refileMaterial(list, "a", { unit: "  U4  " })[0].unit === "U4");
  check("filing", "an unknown id changes nothing",
    JSON.stringify(refileMaterial(list, "nope", { unit: "X" })) === JSON.stringify(list));

  check("filing", "knownUnits dedupes case-insensitively",
    knownUnits([{ unit: "Unit 1" }, { unit: "unit 1" }, { unit: "Unit 2" }]).length === 2,
    JSON.stringify(knownUnits([{ unit: "Unit 1" }, { unit: "unit 1" }, { unit: "Unit 2" }])));

  // Sequencing: dated lessons order by lesson date, undated keep order and sit last.
  const seq = sequenceUnit(list);
  check("filing", "a unit sequences by lesson date, not save date",
    seq.map((x) => x.item.id).join(",") === "b,a,c", seq.map((x) => x.item.id).join(","));
  check("filing", "undated lessons get no day number", seq[2].day === null);
  check("filing", "the day count counts only dated lessons", seq[0].of === 2, String(seq[0].of));

  check("filing", "unit standards count each code once",
    unitStandards([{ output: { standards: ["A", "B"] } }, { output: { standards: ["A"] } }]).length === 2);

  // Every sort must be total: same input length out, whatever the key.
  for (const key of Object.keys(SORTS)) {
    const sorted = [...list].sort(SORTS[key].cmp);
    check("filing", `sort "${key}" keeps every row`, sorted.length === list.length);
  }
}


// The bug this pass exists for. Failing `audience` closed to "teacher" is right —
// the other direction puts the answer key on the handout — but doing it silently
// on EVERY section produced a completely blank student copy, printed and handed
// out, with no row and no warning anywhere.
console.log("\n\x1b[1mstudents actually receive something\x1b[0m");
{
  const noAudience = [
    { label: "Warm-up", body: "Students graph a line.", items: [], steps: [], minutes: 10 },
    { label: "Practice", body: "", items: ["Q1", "Q2"], steps: [], minutes: 20 },
    { label: "Teacher reflection (optional)", body: "How did it land?", items: [], steps: [], minutes: 0 },
  ];
  const secs = normalizeSections(noAudience);
  const visible = secs.filter((x) => x.audience !== "teacher");

  check("student", "a section of questions is inferred student-facing",
    secs[1].audience === "student", secs[1].audience);
  check("student", "a teacher-reflection section stays teacher",
    secs[2].audience === "teacher", secs[2].audience);
  check("student", "the student copy is no longer empty", visible.length > 0, `${visible.length} visible`);
  check("student", "an explicit audience is never overridden",
    resolveAudience({ label: "Practice", items: ["Q"], audience: "teacher" }) === "teacher");
  check("student", "fallbacks are counted", countAudienceFallbacks(noAudience) === 3,
    String(countAudienceFallbacks(noAudience)));

  // And when inference cannot save it, it must be LOUD.
  const allTeacher = [{ audience: "teacher" }, { audience: "teacher" }];
  const empty = verifyStudentCopy(allTeacher, 2);
  check("student", "an empty student copy warns", empty.state === "warn", empty.state);
  check("student", "…and says printing it hands out blank paper",
    /blank paper/i.test(empty.note || ""), empty.note);
  check("student", "inferred-but-not-empty is unchecked, not a pass",
    verifyStudentCopy([{ audience: "teacher" }, { audience: "student" }], 1).state === "unchecked");
  check("student", "properly labelled sections pass",
    verifyStudentCopy([{ audience: "teacher" }, { audience: "student" }], 0).state === "pass");

  // The same failure by another route: questions that live only in the key.
  const q = "What is the slope of the line through (2,4) and (6,12)?";
  check("student", "questions present on the handout pass",
    verifyQuestionsReachStudents({ answerKey: [{ question: q }],
      sections: [{ audience: "student", items: [q] }] }).state === "pass");
  check("student", "a key that mirrors rather than copies still counts as found",
    verifyQuestionsReachStudents({ answerKey: [{ question: q }],
      sections: [{ audience: "student", items: ["Find the slope of the line through (2,4) and (6,12)"] }] }).state === "pass");
  const keyOnly = verifyQuestionsReachStudents({ answerKey: [{ question: q }],
    sections: [{ audience: "student", items: ["Work with your partner."] }] });
  check("student", "questions ONLY in the answer key warn", keyOnly.state === "warn", keyOnly.state);
  check("student", "no answer key is unchecked, not a pass",
    verifyQuestionsReachStudents({ sections: [] }).state === "unchecked");

  // Safety notes: a heuristic, so never a warn and never a removal.
  check("student", "safety notes on a lab lesson pass",
    verifySafetyEarned({ safety: ["Wear goggles"], materials: { gather: ["Beakers"] }, sections: [] }).state === "pass");
  const unearned = verifySafetyEarned({ safety: ["Wear goggles", "Tie hair back"],
    materials: { gather: ["Pencils"] }, sections: [{ body: "Students graph a line." }] });
  check("student", "safety notes on a paper lesson are UNCHECKED, never a warn",
    unearned.state === "unchecked", unearned.state);
  check("student", "…and nothing is removed", unearned.notes === 2, String(unearned.notes));

  // Readability must score the paper students are actually handed. It runs on
  // the RAW draft, before normalizeSections writes the resolved audience back,
  // so it has to resolve audience the same way or it scores text that never
  // reaches the handout.
  const teacherProse =
    "Facilitate a metacognitive discussion wherein students interrogate the epistemological " +
    "assumptions underpinning contemporary environmental discourse and its implications.";
  const studentProse = "Look at the map. Find the hot spots. Write down what you see near them.";
  const rawMissing = {
    sections: [
      // No `audience`. A teacher-notes label, so resolveAudience calls it teacher.
      { label: "Teacher reflection", body: teacherProse },
      { label: "Warm-up", audience: "student", body: studentProse },
    ],
  };
  const resolved = { sections: normalizeSections(rawMissing.sections) };
  check("student", "readability ignores a section that resolves to teacher",
    measureReadability(rawMissing).words === measureReadability(resolved).words,
    `raw=${measureReadability(rawMissing).words} resolved=${measureReadability(resolved).words}`);
  check("student", "…and scores only the student text",
    measureReadability(rawMissing).words === studentProse.split(/\s+/).length,
    String(measureReadability(rawMissing).words));
  // An explicit audience is still never overridden.
  const explicitBoth = { sections: [{ label: "Teacher reflection", audience: "both", body: studentProse }] };
  check("student", "an explicit audience still counts toward readability",
    measureReadability(explicitBoth).words > 0);

  // Section identity. The offline fallback builds sections with no id, and any
  // draft saved before sectionId existed still has none. Without an id every
  // id-less section compared equal, so one Edit click opened them all.
  const idless = { sections: [{ label: "Warm-up and hook" }, { label: "Main activity" }] };
  const fixed = withSectionIds(idless);
  check("student", "id-less sections get ids backfilled",
    fixed.sections.every((s) => typeof s.id === "string" && s.id.length > 0));
  check("student", "…and those ids are distinct",
    new Set(fixed.sections.map((s) => s.id)).size === 2, fixed.sections.map((s) => s.id).join(","));
  check("student", "…matching the id the server would have assigned",
    fixed.sections[1].id === sectionId("Main activity", 1), fixed.sections[1].id);
  check("student", "a document that already has ids is returned untouched",
    (() => { const doc = { sections: [{ id: "s0-x", label: "X" }] }; return withSectionIds(doc) === doc; })());
  check("student", "the server and the client share ONE id definition",
    normalizeSections([{ label: "Main activity" }])[0].id === sectionId("Main activity", 0));
}

console.log(`\n${"─".repeat(60)}`);
console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(failed > 0 ? 1 : 0);
