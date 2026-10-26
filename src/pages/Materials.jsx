// My materials — everything the teacher has made, grouped by class then unit.
//
// The empty state teaches rather than apologises: it names what will appear
// here and offers the one action that fills it.
import React, { useMemo, useState } from "react";
import { useToast } from "../components/ui.jsx";
import { classDisplayName } from "../data/classes.js";
import {
  duplicateMaterial,
  formatSavedAt,
  groupMaterials,
  knownUnits,
  ORPHANED,
  refileMaterial,
  removeMaterial,
  searchMaterials,
  sequenceUnit,
  SORTS,
  UNGROUPED,
  unitStandards,
} from "../data/materials.js";
import { outputTypes } from "../data/inputSchema.js";
import m from "../styles/Materials.module.css";

const typeLabel = (v) => outputTypes.find((t) => t.value === v)?.label || "Resource";

export default function Materials({
  materials,
  setMaterials,
  classes,
  activeClassId,
  onOpen,
  go,
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortKey, setSortKey] = useState("sequence");
  const [refiling, setRefiling] = useState(null); // material id
  const [renaming, setRenaming] = useState(null); // { id, title }

  const filtered = useMemo(() => {
    let list = materials;
    if (classFilter !== "all") list = list.filter((x) => (x.classId || UNGROUPED) === classFilter);
    if (typeFilter !== "all") list = list.filter((x) => (x.outputType || "lesson") === typeFilter);
    return searchMaterials(list, query);
  }, [materials, query, classFilter, typeFilter]);

  const groups = useMemo(
    () => groupMaterials(filtered, classes, sortKey),
    [filtered, classes, sortKey]
  );

  // Only the types the teacher has actually made. Offering "Feedback" to someone
  // who has never written one is a filter that can only return nothing.
  const usedTypes = useMemo(() => {
    const seen = new Set(materials.map((x) => x.outputType || "lesson"));
    return outputTypes.filter((t) => seen.has(t.value));
  }, [materials]);

  const units = useMemo(() => knownUnits(materials), [materials]);

  // localStorage rejected the write — quota, or private browsing. Saying so is
  // the whole point: a silent failure here loses the teacher's work.
  const QUOTA = "Could not save. Your browser storage may be full.";

  const duplicate = (id) => {
    const { list, copy } = duplicateMaterial(materials, id);
    if (!copy) return;
    if (!setMaterials(list)) return toast(QUOTA);
    toast("Duplicated. Update it for this year.");
  };

  // Refiling is the other half of the orphan fix. Deleting a class no longer
  // hides its materials, so the list now shows items whose class is gone — and
  // until this existed there was no way to act on what that surfaced.
  const refile = (id, patch, label) => {
    if (!setMaterials(refileMaterial(materials, id, patch))) return toast(QUOTA);
    setRefiling(null);
    toast(label);
  };

  const saveRename = (event, item) => {
    event.preventDefault();
    const title = String(renaming?.title || "").trim();
    if (!title) return toast("Enter a title before saving.");
    const updated = materials.map((material) => {
      if (material.id !== item.id) return material;
      const output = material.output ? { ...material.output, title } : material.output;
      const versions = Array.isArray(material.versions)
        ? material.versions.map((version) => ({ ...version, title }))
        : material.versions;
      return { ...material, title, output, versions };
    });
    if (!setMaterials(updated)) return toast(QUOTA);
    setRenaming(null);
    toast("Material renamed.");
  };

  // Undo splices the one item back where it was, rather than restoring a
  // snapshot of the whole list, so anything done between the delete and the
  // undo survives. Position, id and savedAt are the original object's, so the
  // row reappears where the teacher left it instead of jumping to the top the
  // way a duplicate does.
  const remove = (id, title) => {
    const index = materials.findIndex((x) => x.id === id);
    if (index === -1) return;
    const item = materials[index];
    if (!setMaterials(removeMaterial(materials, id))) return toast(QUOTA);
    toast(`Deleted ${title}`, {
      action: {
        label: "Undo",
        onAction: () => {
          const ok = setMaterials((prev) => {
            if (prev.some((x) => x.id === item.id)) return prev;
            const next = prev.slice();
            next.splice(Math.min(index, next.length), 0, item);
            return next;
          });
          toast(ok ? `Restored ${title}` : QUOTA);
          // The Delete button that had focus was destroyed with its row, so the
          // toast has nothing to hand focus back to and a keyboard user would be
          // dropped at the top of the document. Put them on the row that just
          // came back instead. setTimeout rather than rAF: rAF does not run in a
          // backgrounded tab, and this must not depend on the tab being visible.
          if (ok) {
            window.setTimeout(() => {
              document.querySelector(`[data-material-id="${item.id}"] button`)?.focus();
            }, 0);
          }
        },
      },
    });
  };

  // Nothing saved at all: teach what this surface is for.
  if (!materials.length) {
    return (
      <div className={m.page}>
        <header className={m.head}>
          <h1 className={m.title}>My materials</h1>
        </header>
        <div className={m.empty}>
          <p className={m.emptyLead}>
            Everything you draft gets saved here, grouped by class and unit.
          </p>
          <p className={m.emptyBody}>
            You will be able to reopen a lesson, duplicate last year's and update it, print it,
            or turn it into a sub plan. Nothing you make is thrown away.
          </p>
          <button type="button" className={m.primary} onClick={() => go("generate")}>
            Plan a lesson
          </button>
        </div>
      </div>
    );
  }

  const nothingMatches = !groups.length;

  return (
    <div className={m.page}>
      <header className={m.head}>
        <h1 className={m.title}>My materials</h1>
        <div className={m.controls}>
          <label className={m.searchWrap}>
            <span className={m.srOnly}>Search your materials</span>
            <input
              type="search"
              className={m.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your materials"
            />
          </label>
          <div className={m.filterRow} role="group" aria-label="Filter by class">
            <button
              type="button"
              className={`${m.filter}${classFilter === "all" ? ` ${m.filterOn}` : ""}`}
              onClick={() => setClassFilter("all")}
            >
              All classes
            </button>
            {classes.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${m.filter}${classFilter === c.id ? ` ${m.filterOn}` : ""}`}
                onClick={() => setClassFilter(c.id)}
              >
                {classDisplayName(c)}
              </button>
            ))}
          </div>

          {usedTypes.length > 1 && (
            <div className={m.filterRow} role="group" aria-label="Filter by kind">
              <button
                type="button"
                className={`${m.filter}${typeFilter === "all" ? ` ${m.filterOn}` : ""}`}
                onClick={() => setTypeFilter("all")}
              >
                All kinds
              </button>
              {usedTypes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`${m.filter}${typeFilter === t.value ? ` ${m.filterOn}` : ""}`}
                  onClick={() => setTypeFilter(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <label className={m.sortWrap}>
            <span className={m.sortLabel}>Sort</span>
            <select
              className={m.sortSelect}
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
            >
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {/* Offering the units already in use is what stops "Unit 1" and "unit 1"
          becoming two units in the grouping. */}
      <datalist id="lumen-units">
        {units.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {nothingMatches ? (
        <p className={m.noMatch}>
          Nothing matches {query ? `"${query}"` : "that filter"}. Try a different search.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.classId} className={m.group}>
            <h2 className={m.groupTitle}>
              {g.classId === ORPHANED
                ? "From a class you removed"
                : g.cls
                ? classDisplayName(g.cls)
                : "Not assigned to a class"}
            </h2>
            {/* Say why these moved. "Not assigned to a class" would be true and
                would still leave a teacher wondering where their unit went. */}
            {g.classId === ORPHANED && (
              <p className={m.groupNote}>
                The class these were filed under is gone. Nothing was deleted.
              </p>
            )}
            {g.units.map((u) => {
              // A unit is a sequence, not a folder: ordered by the lesson date
              // the teacher typed, not by when they happened to save it.
              const seq = u.unit ? sequenceUnit(u.items) : null;
              const dayOf = new Map((seq || []).map((x) => [x.item.id, x]));
              const covered = u.unit ? unitStandards(u.items) : [];
              return (
              <div key={u.unit || "none"} className={m.unit}>
                <h3 className={m.unitTitle}>{u.unit || "No unit"}</h3>
                {u.unit && covered.length > 0 && (
                  <p className={m.unitStandards}>
                    Covers {covered.map((c) => c.code).join(", ")}
                  </p>
                )}
                <ul className={m.list}>
                  {u.items.map((item) => (
                    <li key={item.id} className={m.item} data-material-id={item.id}>
                      <div className={m.itemMain}>
                        <button type="button" className={m.itemTitle} onClick={() => onOpen(item)}>
                          {item.title}
                        </button>
                        <p className={m.itemMeta}>
                          {dayOf.get(item.id)?.day
                            ? `Day ${dayOf.get(item.id).day} of ${dayOf.get(item.id).of} · `
                            : ""}
                          {typeLabel(item.outputType)} · {formatSavedAt(item.savedAt)} ·{" "}
                          {item.pages} {item.pages === 1 ? "page" : "pages"}
                        </p>
                        {renaming?.id === item.id ? (
                          <form
                            className={m.renameForm}
                            onSubmit={(event) => saveRename(event, item)}
                          >
                            <label className={m.srOnly} htmlFor={`rename-${item.id}`}>
                              New title for {item.title}
                            </label>
                            <input
                              id={`rename-${item.id}`}
                              className={m.renameInput}
                              type="text"
                              maxLength={180}
                              value={renaming.title}
                              onChange={(event) =>
                                setRenaming({ id: item.id, title: event.target.value })
                              }
                              autoFocus
                            />
                            <button type="submit" className={m.renameSave}>
                              Save
                            </button>
                            <button
                              type="button"
                              className={m.renameCancel}
                              onClick={() => setRenaming(null)}
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className={m.renameLink}
                            onClick={() => setRenaming({ id: item.id, title: item.title })}
                          >
                            Rename
                          </button>
                        )}
                      </div>
                      <div className={m.itemActions}>
                        <button type="button" className={m.action} onClick={() => onOpen(item)}>
                          Open
                        </button>
                        <button
                          type="button"
                          className={m.action}
                          onClick={() => duplicate(item.id)}
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className={m.action}
                          onClick={() => setRefiling(refiling === item.id ? null : item.id)}
                          aria-expanded={refiling === item.id}
                        >
                          Refile
                        </button>
                        <button
                          type="button"
                          className={m.actionQuiet}
                          onClick={() => remove(item.id, item.title)}
                        >
                          Delete
                        </button>
                      </div>
                      {refiling === item.id && (
                        <div className={m.refile}>
                          <label className={m.refileField}>
                            <span>Class</span>
                            <select
                              defaultValue={item.classId || ""}
                              onChange={(e) =>
                                refile(
                                  item.id,
                                  { classId: e.target.value || null },
                                  e.target.value
                                    ? `Moved to ${classDisplayName(
                                        classes.find((c) => c.id === e.target.value)
                                      )}`
                                    : "Moved out of every class"
                                )
                              }
                            >
                              <option value="">Not assigned to a class</option>
                              {classes.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {classDisplayName(c)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={m.refileField}>
                            <span>Unit</span>
                            <input
                              type="text"
                              list="lumen-units"
                              defaultValue={item.unit || ""}
                              placeholder="Unit 1: Linear functions"
                              onBlur={(e) => {
                                const next = e.target.value.trim();
                                if (next !== (item.unit || "")) {
                                  refile(item.id, { unit: next }, next ? `Filed under ${next}` : "Unit cleared");
                                }
                              }}
                            />
                          </label>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
