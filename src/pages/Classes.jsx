// My classes — set up once, reused all year.
//
// Laid out as a planning sheet rather than a form card: a metadata header, then
// ruled rows with the label on the left and the entry on the right. This is the
// same structure the builder moves to, so the two read as pages from the same
// pad.
import React, { useState } from "react";
import { Dropdown, useToast } from "../components/ui.jsx";
import { readingLevels, resourceLevels } from "../data/inputSchema.js";
import {
  blankClass,
  classDisplayName,
  classSubtitle,
  isClassUsable,
  EXAMPLE_CLASSES,
} from "../data/classes.js";
import sheet from "../styles/Classes.module.css";

const PERIOD_LENGTHS = [
  { value: 40, label: "40 min" },
  { value: 45, label: "45 min" },
  { value: 50, label: "50 min" },
  { value: 55, label: "55 min" },
  { value: 60, label: "60 min" },
  { value: 85, label: "85 min (block)" },
  { value: 90, label: "90 min (block)" },
];

function Row({ label, hint, htmlFor, children }) {
  return (
    <div className={sheet.row}>
      <div className={sheet.rowLabel}>
        <label htmlFor={htmlFor}>{label}</label>
        {hint ? <span className={sheet.rowHint}>{hint}</span> : null}
      </div>
      <div className={sheet.rowEntry}>{children}</div>
    </div>
  );
}

export default function Classes({ classes, setClasses, materials, activeId, setActiveId, go }) {
  const toast = useToast();
  const [draft, setDraft] = useState(null);

  const QUOTA = "Could not save. Your browser storage may be full.";

  const startNew = (seed) => setDraft({ ...blankClass(), ...(seed || {}) });
  const edit = (cls) => setDraft({ ...cls });
  const cancel = () => setDraft(null);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    if (!isClassUsable(draft)) {
      toast("Give the class a period, course, or subject first.");
      return;
    }
    const exists = classes.some((c) => c.id === draft.id);
    const next = exists ? classes.map((c) => (c.id === draft.id ? draft : c)) : [...classes, draft];
    if (!setClasses(next)) return toast(QUOTA);
    if (!activeId || !exists) setActiveId(draft.id);
    setDraft(null);
    toast(exists ? "Class updated" : "Class saved");
  };

  // Three sections of one course is the common case, and every field except the
  // period is identical. The copy opens in edit mode with the label cleared,
  // because that is the one thing that genuinely differs and leaving it filled
  // would produce two classes both called "Period 2". Spread over a blank first
  // so a class saved by an older build still gains any field added since.
  const duplicate = (cls) => {
    const fresh = blankClass();
    setDraft({ ...fresh, ...cls, id: fresh.id, label: "" });
  };

  // Removing a class is the most expensive delete in the app: the fields take
  // real time to retype, and materials are filed against it. Two things make it
  // recoverable. Undo puts the class back at its original position and restores
  // whichever class was being planned for — otherwise undoing would leave the
  // teacher planning for a different section than the one they were in, which
  // is a quieter version of the same problem. And the count says out loud that
  // the materials survived, so nobody has to panic-undo to find out.
  const remove = (id) => {
    const index = classes.findIndex((c) => c.id === id);
    if (index === -1) return;
    const cls = classes[index];
    const prevActive = activeId;
    const next = classes.filter((c) => c.id !== id);
    if (!setClasses(next)) return toast(QUOTA);
    if (activeId === id) setActiveId(next[0]?.id || null);

    const kept = (materials || []).filter((mat) => mat.classId === id).length;
    toast(
      kept
        ? `Class removed. ${kept} ${kept === 1 ? "material" : "materials"} kept.`
        : "Class removed",
      {
        action: {
          label: "Undo",
          onAction: () => {
            const ok = setClasses((prev) => {
              if (prev.some((c) => c.id === id)) return prev;
              const list = prev.slice();
              list.splice(Math.min(index, list.length), 0, cls);
              return list;
            });
            if (!ok) return toast(QUOTA);
            setActiveId(prevActive);
            toast(`Restored ${classDisplayName(cls)}`);
            // See the same note in Materials: the Remove button went with the
            // row, so put focus on the restored class rather than leaving a
            // keyboard user at the top of the page.
            window.setTimeout(() => {
              document.querySelector(`[data-class-id="${id}"] button`)?.focus();
            }, 0);
          },
        },
      }
    );
  };

  const firstRun = classes.length === 0 && !draft;

  return (
    <div className={sheet.page}>
      <header className={sheet.head}>
        <h1 className={sheet.title}>My classes</h1>
        <p className={sheet.lede}>
          Set up your sections once. Every resource you draft starts prefilled with that
          class, so you never retype your course, grade, reading level, or tech setup.
        </p>
        <p className={sheet.privacy}>
          Describe the section rather than the students. Do not enter anything that identifies an
          individual student.
        </p>
      </header>

      {firstRun && (
        <section className={sheet.firstRun}>
          <p className={sheet.firstRunTitle}>Start from an example, or add your own.</p>
          <div className={sheet.exampleRow}>
            {EXAMPLE_CLASSES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                className={sheet.exampleBtn}
                onClick={() => startNew(ex)}
              >
                <span className={sheet.exampleName}>
                  {ex.label}, {ex.course}
                </span>
                <span className={sheet.exampleMeta}>
                  Grade {ex.grade} · {ex.periodLength} min
                </span>
              </button>
            ))}
          </div>
          <button type="button" className={sheet.primary} onClick={() => startNew()}>
            Add a class
          </button>
        </section>
      )}

      {!draft && classes.length > 0 && (
        <section className={sheet.list}>
          {classes.map((c) => {
            const isActive = c.id === activeId;
            return (
              <article key={c.id} className={sheet.classRow} data-class-id={c.id}>
                <div className={sheet.classMain}>
                  <h2 className={sheet.className}>{classDisplayName(c)}</h2>
                  <p className={sheet.classMeta}>
                    {[classSubtitle(c), c.subject].filter(Boolean).join(" · ")}
                  </p>
                  {/* A class you have not planned for should look different from
                      one you have. The count is the cheapest way to show it. */}
                  <p className={sheet.classCount}>
                    {(() => {
                      const n = (materials || []).filter((mt) => mt.classId === c.id).length;
                      return n === 0
                        ? "No materials yet"
                        : `${n} ${n === 1 ? "material" : "materials"}`;
                    })()}
                  </p>
                </div>
                <div className={sheet.classActions}>
                  {isActive ? (
                    <span className={sheet.activeTag}>Planning for this</span>
                  ) : (
                    <button
                      type="button"
                      className={sheet.ghost}
                      onClick={() => {
                        setActiveId(c.id);
                        toast(`Planning for ${classDisplayName(c)}`);
                      }}
                    >
                      Plan for this
                    </button>
                  )}
                  <button type="button" className={sheet.ghost} onClick={() => edit(c)}>
                    Edit
                  </button>
                  <button type="button" className={sheet.ghost} onClick={() => duplicate(c)}>
                    Duplicate
                  </button>
                  <button type="button" className={sheet.ghostQuiet} onClick={() => remove(c.id)}>
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
          <div className={sheet.listFoot}>
            <button type="button" className={sheet.primary} onClick={() => startNew()}>
              Add a class
            </button>
            <button type="button" className={sheet.ghost} onClick={() => go("generate")}>
              Plan a lesson
            </button>
          </div>
        </section>
      )}

      {draft && (
        <section className={sheet.sheet} aria-label="Class details">
          <Row label="Period or section" hint="What you call it" htmlFor="cls-label">
            <input
              id="cls-label"
              className={sheet.input}
              value={draft.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="Period 2"
              maxLength={60}
            />
          </Row>
          <Row label="Course" htmlFor="cls-course">
            <input
              id="cls-course"
              className={sheet.input}
              value={draft.course}
              onChange={(e) => set("course", e.target.value)}
              placeholder="Algebra I"
              maxLength={80}
            />
          </Row>
          <Row label="Subject" htmlFor="cls-subject">
            <input
              id="cls-subject"
              className={sheet.input}
              value={draft.subject}
              onChange={(e) => set("subject", e.target.value)}
              placeholder="Mathematics"
              maxLength={80}
            />
          </Row>
          <Row label="Grade" htmlFor="cls-grade">
            <input
              id="cls-grade"
              className={sheet.input}
              value={draft.grade}
              onChange={(e) => set("grade", e.target.value)}
              placeholder="9"
              maxLength={20}
            />
          </Row>
          <Row label="Period length" htmlFor="cls-len">
            <Dropdown
              id="cls-len"
              ariaLabel="Period length"
              value={draft.periodLength}
              options={PERIOD_LENGTHS}
              onChange={(v) => set("periodLength", v)}
            />
          </Row>
          <Row label="Reading level" htmlFor="cls-read">
            <Dropdown
              id="cls-read"
              ariaLabel="Reading level"
              value={draft.readingLevel}
              options={readingLevels}
              onChange={(v) => set("readingLevel", v)}
            />
          </Row>
          <Row label="Tech level" htmlFor="cls-tech">
            <Dropdown
              id="cls-tech"
              ariaLabel="Tech level"
              value={draft.resourceLevel}
              options={resourceLevels}
              onChange={(v) => set("resourceLevel", v)}
            />
          </Row>
          <Row
            label="Community context"
            hint="The neighborhood and institutions your students live in"
            htmlFor="cls-community"
          >
            <textarea
              id="cls-community"
              className={sheet.textarea}
              rows={2}
              value={draft.communityContext}
              onChange={(e) => set("communityContext", e.target.value)}
              placeholder="Urban neighborhood near a community garden and a health clinic"
              maxLength={600}
            />
          </Row>
          <Row label="Student interests" hint="What this group is actually into" htmlFor="cls-interests">
            <textarea
              id="cls-interests"
              className={sheet.textarea}
              rows={2}
              value={draft.studentInterests}
              onChange={(e) => set("studentInterests", e.target.value)}
              placeholder="Cooking, basketball, music production"
              maxLength={600}
            />
          </Row>
          {/* Kept verbatim: this is real CRP language and it is doing work. */}
          <Row label="Cultural & linguistic assets" htmlFor="cls-assets">
            <textarea
              id="cls-assets"
              className={sheet.textarea}
              rows={2}
              value={draft.culturalAssets}
              onChange={(e) => set("culturalAssets", e.target.value)}
              placeholder="Bilingual (Spanish), multigenerational households"
              maxLength={600}
            />
          </Row>

          <div className={sheet.sheetFoot}>
            <button type="button" className={sheet.ghost} onClick={cancel}>
              Cancel
            </button>
            <button type="button" className={sheet.primary} onClick={save}>
              Save class
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
