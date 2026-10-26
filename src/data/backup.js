// Back up everything, restore everything.
//
// This is not a feature so much as an admission. There is no account, no
// database and no sync: a teacher's classes, materials and reports live in one
// browser's localStorage and nowhere else. Clearing site data, browsing
// privately, switching laptops, or a browser evicting storage under pressure
// takes all of it, and undo does nothing about any of those. Until this file
// there was no way to get a copy of your own work out of the app at all.
//
// The file is handed to the teacher rather than uploaded anywhere, which is the
// same reasoning as the report export in sectionFeedback.js: they decide if and
// when their work leaves their machine.
//
// Restoring MERGES by id and never overwrites. The failure this rules out is a
// teacher opening a backup from October in March and losing the intervening
// five months in one click — a "restore" that destroys is the exact thing this
// module exists to prevent. On a conflict the copy already on the device wins,
// because that is the one that has been edited since.

import { loadClasses } from "./classes.js";
import { loadMaterials, MAX_ITEMS } from "./materials.js";
import { loadReports, replaceReports } from "../engine/sectionFeedback.js";

const FORMAT = "lumen-backup";
const VERSION = 1;

// The active-class pointer is deliberately not in the file. It is a pointer,
// not data, and App already falls back to the first class when it dangles.
export function buildBackup() {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    classes: loadClasses(),
    materials: loadMaterials(),
    reports: loadReports(),
  };
}

export function backupToJson() {
  return JSON.stringify(buildBackup(), null, 2);
}

export function backupFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `lumen-backup-${stamp}.json`;
}

export function summarize(data) {
  return {
    classes: (data?.classes || []).length,
    materials: (data?.materials || []).length,
    reports: (data?.reports || []).length,
  };
}

// Bidirectional formatting and ASCII control characters, stripped from every
// string in a restored file. Mirrors cleanString in api/_security.js.
//
// A backup is the one thing in this app that arrives from outside it: anyone can
// send a teacher a .json file and tell them it is theirs. U+202E and friends
// reorder how surrounding text renders, so a material title can be made to
// display as something it is not — in the list, and in anything exported from
// it afterwards. Stripping them at the door means the rest of the app never has
// to think about it.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001F\u007F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

// Depth and node caps. A hostile file nested a few thousand deep would otherwise
// blow the stack, which is a denial of service on the teacher's own restore:
// the throw happens before anything is written, so the file simply never loads.
// Past either cap the branch is dropped rather than trusted — nothing legitimate
// in a backup is 40 levels deep.
const MAX_DEPTH = 40;
const MAX_NODES = 50_000;

function scrub(value) {
  let budget = MAX_NODES;
  const walk = (v, depth) => {
    if (depth > MAX_DEPTH || budget-- <= 0) return null;
    if (typeof v === "string") return v.replace(UNSAFE_CHARS, "");
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        // Never carry a key that could reach a prototype through some future
        // merge. Object spread is safe today; this stops it mattering.
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        out[k] = walk(val, depth + 1);
      }
      return out;
    }
    return v;
  };
  return walk(value, 0);
}

// Anything without a usable id cannot be merged, so it is dropped rather than
// imported as an item that can never be matched, deduplicated or deleted.
function usableRows(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x) => x && typeof x === "object" && typeof x.id === "string" && x.id)
    .map(scrub);
}

/**
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 *   Every rejection names what was wrong in a sentence a teacher can act on.
 *   Throwing, or accepting a file of the wrong shape and writing junk into
 *   storage, are both worse than refusing out loud.
 */
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON. Choose the file Lumen gave you." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "That file does not look like a Lumen backup." };
  }
  if (raw.format !== FORMAT) {
    return { ok: false, error: "That is not a Lumen backup file." };
  }
  // A file written by a newer Lumen may hold fields this build would silently
  // discard on the next save, so refuse rather than half-import it.
  if (!Number.isFinite(raw.version) || raw.version > VERSION) {
    return {
      ok: false,
      error: "That backup was made by a newer version of Lumen. Update before restoring it.",
    };
  }
  return {
    ok: true,
    data: {
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : null,
      classes: usableRows(raw.classes),
      materials: usableRows(raw.materials),
      reports: usableRows(raw.reports),
    },
  };
}

// Adds only what is not already here. Returns the merged list plus how many
// were added, so the UI can report the real number instead of the file's count.
export function mergeById(current, incoming) {
  const have = new Set((current || []).map((x) => x.id));
  const added = (incoming || []).filter((x) => !have.has(x.id));
  return { list: [...(current || []), ...added], added: added.length };
}

/**
 * Applies a parsed backup. Classes and materials go back through the caller's
 * setters so React state and localStorage stay in step; reports have no live
 * state, so they are written directly.
 *
 * @returns {{ok: boolean, added: {classes, materials, reports}, error?: string,
 *            truncated?: number}}
 */
export function restoreBackup(data, { classes, setClasses, materials, setMaterials }) {
  const mergedClasses = mergeById(classes, data.classes);
  const mergedMaterials = mergeById(materials, data.materials);
  const mergedReports = mergeById(loadReports(), data.reports);

  // saveMaterials truncates to MAX_ITEMS without saying so. Report it here
  // rather than letting a restore quietly drop the oldest lessons.
  const truncated = Math.max(0, mergedMaterials.list.length - MAX_ITEMS);

  if (mergedClasses.added && !setClasses(mergedClasses.list)) {
    return { ok: false, error: "Could not save. Your browser storage may be full.", added: null };
  }
  if (mergedMaterials.added && !setMaterials(mergedMaterials.list)) {
    return { ok: false, error: "Could not save. Your browser storage may be full.", added: null };
  }
  if (mergedReports.added) replaceReports(mergedReports.list);

  return {
    ok: true,
    truncated,
    added: {
      classes: mergedClasses.added,
      materials: mergedMaterials.added,
      reports: mergedReports.added,
    },
  };
}
