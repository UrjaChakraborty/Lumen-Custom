// My materials — everything a teacher has made, kept.
//
// Generated resources previously vanished the moment the tab closed. That makes
// the tool a demo: you cannot open it in April and find what you wrote in
// September, and you cannot duplicate last spring's lesson into this spring's,
// which is how teachers actually work.
//
// Stored in localStorage alongside classes. Same reasoning: no accounts, and
// nothing here is about an individual student.

const KEY = "lumen-materials";
// Generous; guards the ~5MB origin quota. Exported because saveMaterials
// silently truncates to it, and a restore that quietly dropped items over the
// cap would be its own small data-loss bug.
export const MAX_ITEMS = 300;

// How many drafts of one resource are kept. Ten is the rewrite budget, so this
// holds the whole history of a document that spent all of it.
const MAX_VERSIONS = 11;

// Roughly how many printed pages a draft is. Teachers care a great deal about
// this because it is a copier decision, so it is stored per item and shown in
// the list. ~2,600 characters of body text per printed page is close enough for
// a page-count badge; the print view is the source of truth.
export function estimatePages(output) {
  if (!output?.sections) return 1;
  const chars = output.sections.reduce((n, s) => {
    const items = Array.isArray(s.items) ? s.items.join(" ") : "";
    return n + (s.label?.length || 0) + (s.body?.length || 0) + items.length;
  }, output.title?.length || 0);
  return Math.max(1, Math.ceil(chars / 2600));
}

function safeList(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function loadMaterials() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? safeList(raw) : [];
  } catch {
    return [];
  }
}

export function saveMaterials(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
    return true;
  } catch {
    // Quota or private browsing. The caller surfaces this rather than pretending
    // the save worked, because a silent failure here loses a teacher's work.
    return false;
  }
}

export function newMaterialId() {
  return `mat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// One saved draft. `classId` and `unit` are what the list groups by.
export function makeMaterial({ output, input, classId, unit, id, title, versions, revisionsUsed }) {
  return {
    id: id || newMaterialId(),
    savedAt: new Date().toISOString(),
    classId: classId || null,
    unit: (unit || "").trim(),
    outputType: input?.outputType || "lesson",
    topic: input?.topic || "",
    course: input?.course || "",
    grade: input?.grade || "",
    // An explicit title wins over the draft's own. Without this, autosaving a
    // duplicate would rewrite "… (copy)" back to the original title and the two
    // rows would be indistinguishable in the list.
    title: title || output?.title || "Untitled",
    pages: estimatePages(output),
    source: output?._source || "mock",
    output,
    input,
    // The draft history, so reopening a saved lesson does not silently discard
    // every earlier version and hand back a fresh budget of rewrites. Capped:
    // localStorage is ~5MB across ALL materials and a full document is several
    // KB, so an unbounded history would start failing saves.
    versions: Array.isArray(versions) && versions.length > 1 ? versions.slice(-MAX_VERSIONS) : undefined,
    revisionsUsed: Number(revisionsUsed) > 0 ? Number(revisionsUsed) : undefined,
  };
}

export function upsertMaterial(list, material) {
  const i = list.findIndex((m) => m.id === material.id);
  if (i === -1) return [material, ...list];
  const next = list.slice();
  next[i] = material;
  return next;
}

export function removeMaterial(list, id) {
  return list.filter((m) => m.id !== id);
}

// "Duplicate and update": last spring's lesson becomes this spring's. A copy is
// a new item with its own id and date, marked so the list does not look like it
// has two identical rows.
export function duplicateMaterial(list, id) {
  const src = list.find((m) => m.id === id);
  if (!src) return { list, copy: null };
  const copy = {
    ...src,
    id: newMaterialId(),
    savedAt: new Date().toISOString(),
    title: `${src.title} (copy)`,
  };
  return { list: [copy, ...list], copy };
}

// Reordering for the Materials list. `savedAt` is an ISO string, so a string
// compare is a date compare and needs no parsing.
export const SORTS = {
  // Default, because a unit is a sequence and the day labels only make sense
  // when the rows are in that order. Making it a named CHOICE rather than a
  // silent override means picking "Title" actually gives you title order —
  // a list that quietly re-sorts itself is worse than one that never sorts.
  // Undated lessons keep their relative order and sit last: they have no place
  // in the sequence, and inventing one would be worse than saying so.
  sequence: {
    label: "Lesson date",
    cmp: (a, b) => {
      const da = String(a?.input?.lessonDate || "");
      const db = String(b?.input?.lessonDate || "");
      if (da && db) return da.localeCompare(db);
      if (da) return -1;
      if (db) return 1;
      return String(b.savedAt || "").localeCompare(String(a.savedAt || ""));
    },
  },
  newest: { label: "Newest", cmp: (a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")) },
  oldest: { label: "Oldest", cmp: (a, b) => String(a.savedAt || "").localeCompare(String(b.savedAt || "")) },
  title: {
    label: "Title",
    cmp: (a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" }),
  },
};

export const UNGROUPED = "__ungrouped__";
export const ORPHANED = "__orphaned__";

// Grouped by class, then unit, newest first inside each unit. Returns plain
// arrays so the page can render without re-sorting.
//
// ORPHANED exists because deleting a class used to make its materials
// disappear. A material keeps its `classId` after the class is gone, and the
// loop below only ever visited ids taken from the current `classes` list plus
// UNGROUPED — so the bucket holding those materials was never read, and no
// group was emitted for them. They were not deleted: they sat in localStorage,
// counted against MAX_ITEMS, and still matched searchMaterials. Nothing simply
// ever put them on screen, and there was no undo, so one tap on Remove took a
// year of lessons off the page with no way back.
//
// Bucketing an unknown id under ORPHANED rather than iterating whatever keys
// happen to exist keeps the group order deterministic, and makes it impossible
// by construction for a key to be missing from `order` again.
export function groupMaterials(list, classes, sortKey = "sequence") {
  // Normalized once. Guarding some uses and not others is how the `cls` lookup
  // below kept throwing on an absent list while the two above it were safe.
  const all = Array.isArray(classes) ? classes : [];
  const items0 = Array.isArray(list) ? list : [];
  const known = new Set(all.map((c) => c.id));
  const byClass = new Map();
  for (const m of items0) {
    const claimed = m.classId || UNGROUPED;
    const key = claimed === UNGROUPED || known.has(claimed) ? claimed : ORPHANED;
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(m);
  }
  const order = [...all.map((c) => c.id), UNGROUPED, ORPHANED];
  const groups = [];
  for (const classId of order) {
    const items = byClass.get(classId);
    if (!items || !items.length) continue;
    const units = new Map();
    for (const m of items) {
      const u = m.unit || "";
      if (!units.has(u)) units.set(u, []);
      units.get(u).push(m);
    }
    groups.push({
      classId,
      cls: all.find((c) => c.id === classId) || null,
      units: [...units.entries()]
        .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])))
        .map(([unit, list2]) => ({
          unit,
          items: list2.slice().sort((SORTS[sortKey] || SORTS.newest).cmp),
        })),
    });
  }
  return groups;
}

// Search a teacher's OWN work, not the docs. Matches title, topic, unit, course
// and the body of the draft, so "photosynthesis" finds the lesson even when the
// title was rewritten.
export function searchMaterials(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((m) => {
    const hay = [
      m.title,
      m.topic,
      m.unit,
      m.course,
      m.grade,
      ...(m.output?.sections || []).map((s) => `${s.label} ${s.body}`),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function formatSavedAt(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

// The most recent thing this class did.
//
// "What students did last class" is a field a teacher types by hand every time,
// even though the previous lesson for that class is already saved here with a
// timestamp. This is what lets the builder fill it in for them, which is the
// same promise Classes makes: set it up once, stop retyping it.
//
// Excludes the draft currently being edited, so reopening a saved lesson does
// not offer that lesson as its own predecessor.
export function mostRecentForClass(list, classId, excludeId) {
  if (!classId) return null;
  return (
    (Array.isArray(list) ? list : [])
      .filter((m) => m.classId === classId && m.id !== excludeId)
      .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))[0] || null
  );
}

// One short phrase for the "last class" field. Prefers the topic a teacher
// typed over the model's generated title, because the topic is their own words
// and reads correctly in the sentence "students last worked on ___".
export function lastClassSummary(material) {
  if (!material) return "";
  const topic = String(material.topic || "").trim();
  if (topic) return topic;
  return String(material.title || "").trim();
}


// Move a material to a different class or unit.
//
// Assigning a class existed only in the builder toolbar, so anything filed wrongly
// stayed wrong. That became sharper when deleting a class stopped hiding its
// materials: the orphan group now shows those items, and until this existed
// there was no way to act on what it surfaced.
export function refileMaterial(list, id, { classId, unit }) {
  return (Array.isArray(list) ? list : []).map((mtl) => {
    if (mtl.id !== id) return mtl;
    const next = { ...mtl };
    if (classId !== undefined) next.classId = classId || null;
    if (unit !== undefined) next.unit = String(unit || "").trim();
    return next;
  });
}

// Every unit a teacher has actually used, for the refile picker. Offering the
// existing names is what stops "Unit 1" and "unit 1" becoming two units.
export function knownUnits(list) {
  const seen = new Map();
  for (const mtl of Array.isArray(list) ? list : []) {
    const u = String(mtl?.unit || "").trim();
    if (!u) continue;
    const key = u.toLowerCase();
    if (!seen.has(key)) seen.set(key, u);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// ── Unit sequencing ────────────────────────────────────────────────────────
// A unit is a sequence, not a folder. Ordering by the lesson DATE the teacher
// typed rather than by when they happened to save it is what makes "Day 2 of 5"
// mean anything.
export function lessonDateOf(material) {
  const d = String(material?.input?.lessonDate || "").trim();
  return d || null;
}

export function sequenceUnit(items) {
  const list = [...(Array.isArray(items) ? items : [])];
  const dated = list.filter((x) => lessonDateOf(x));
  const undated = list.filter((x) => !lessonDateOf(x));
  dated.sort((a, b) => lessonDateOf(a).localeCompare(lessonDateOf(b)));
  // Undated lessons keep their existing order and sit after the dated ones:
  // they have no place in the sequence, and guessing one would be worse than
  // saying so.
  const ordered = [...dated, ...undated];
  return ordered.map((item, i) => ({
    item,
    day: lessonDateOf(item) ? i + 1 : null,
    of: dated.length,
  }));
}

// Which standards a unit covers, counted once each, plus what the retrieval
// dataset offers for the same subject that the unit has not touched.
export function unitStandards(items) {
  const covered = new Map();
  for (const mtl of Array.isArray(items) ? items : []) {
    for (const code of mtl?.output?.standards || []) {
      const c = String(code || "").trim();
      if (c) covered.set(c, (covered.get(c) || 0) + 1);
    }
  }
  return [...covered.entries()].map(([code, count]) => ({ code, count }));
}
