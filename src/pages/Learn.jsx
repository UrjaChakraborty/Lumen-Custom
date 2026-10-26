import React, { useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { download, useToast } from "../components/ui.jsx";
import { glossary } from "../data/glossary.js";
import { concepts } from "../data/concepts.js";
import { marketGaps, toolScan } from "../data/toolScan.js";
import { promptLibrary } from "../data/promptLibrary.js";
import { STANDARDS } from "../data/standards.js";
import {
  backupFilename,
  backupToJson,
  parseBackup,
  restoreBackup,
  summarize,
} from "../data/backup.js";
import {
  clearReports,
  loadReports,
  replaceReports,
  reportsToJson,
} from "../engine/sectionFeedback.js";

const FRAMEWORK_NAMES = {
  NGSS: "Next Generation Science Standards",
  "CCSS-M": "Common Core State Standards for Mathematics",
};

// What is actually grounded in code, and what is the model's word. This is the
// honest answer to "does it hallucinate?", which is not "no" — no prompt makes a
// language model incapable of inventing. It is: here is exactly which claims are
// recomputed, which are constrained so a fabrication cannot be expressed, and
// which you are trusting the model for.
const CLAIMS = [
  {
    claim: "Standards codes",
    state: "code",
    how: "Retrieved from a local dataset, selected by the model, then checked against that dataset again. Codes that are not on the list are dropped and counted.",
  },
  {
    claim: "Section minutes",
    state: "code",
    how: "Added up against your period length, re-asked once if they do not fit, and recomputed in your browser each time you open the draft.",
  },
  {
    claim: "Answer keys and worked solutions",
    state: "code",
    how: "Solved a second time by a model that never sees the proposed answer. Arithmetic is evaluated by a calculator. Disagreements are shown, never silently resolved.",
  },
  {
    claim: "Group counts and copy counts",
    state: "code",
    how: "Group arithmetic and print runs are checked against your class size. A mismatch is marked disputed rather than quietly adjusted.",
  },
  {
    claim: "Sources and citations",
    state: "code",
    how: "Lumen has no search tool, so it cannot cite anything truthfully. The sources block is derived in code, and citation-shaped text is removed from the draft.",
  },
  {
    claim: "UDL checkpoint tags",
    state: "partial",
    how: "The checkpoint id is checked against the CAST list, so an invented id is dropped. Whether the support does what the checkpoint describes is not checked.",
  },
  {
    claim: "Figures stated as fact",
    state: "partial",
    how: "Numbers asserting something about the real world with no source are flagged. Numbers that set up a word problem are deliberately not, so a fabricated one phrased as problem data can still pass.",
  },
  {
    claim: "Common misconceptions",
    state: "model",
    how: "A claim about what students get wrong, with no research corpus to check it against.",
  },
  {
    claim: "Spanish cognates",
    state: "model",
    how: "The model may answer NONE, and is told to. A cognate it does give is not checked against a dictionary.",
  },
  {
    claim: "Differentiation and IEP-style accommodations",
    state: "model",
    how: "Written in the register of an IEP. Nothing verifies it against any student's actual plan, and it is not legal advice.",
  },
  {
    claim: "Safety notes",
    state: "model",
    how: "The model is told not to invent hazards for a paper lesson. The hazards it does list are not checked.",
  },
  {
    claim: "Cultural fit",
    state: "never",
    how: "Never checked and never given a verdict. Only you can judge whether this describes your actual students rather than a group they belong to.",
  },
];

const CLAIM_STATE = {
  code: {
    label: "Checked in code",
    tone: "pass",
    gloss: "Recomputed by something that cannot be talked out of the answer.",
  },
  partial: {
    label: "Partly checked",
    tone: "partial",
    gloss: "The shape is verified. Whether it is any good is not.",
  },
  model: {
    label: "The model's word",
    tone: "model",
    gloss: "Plausible, unverified, and worth your eyes before it reaches students.",
  },
  never: {
    label: "Never checked",
    tone: "never",
    gloss: "Not a gap to close later. This one is yours.",
  },
};

// Grouped rather than listed flat: twelve rows each carrying their own state
// badge made the reader sort them. The state is the useful axis, so it is the
// heading.
const CLAIM_ORDER = ["code", "partial", "model", "never"];


// Cards carry a definition, a worked example, and an analogy. The three are
// separate fields rather than one blob of prose so the detail view can label
// them: a teacher scanning for "what does this actually look like" should not
// have to read a definition first to find out.
function toCard(entry, tag, tagTone) {
  return {
    id: entry.term.split(":")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    tag,
    tagTone,
    title: entry.term,
    summary: entry.short,
    definition: entry.definition,
    example: entry.example,
    analogy: entry.analogy,
    inProduct: entry.inProduct,
  };
}

const DOCS = [
  {
    id: "how-it-works",
    tag: "Method",
    tagTone: "blue",
    title: "How Lumen works",
    summary:
      "A guided Resource Builder collects class context, then Gemini returns a structured draft that is checked before you see it.",
    body: [
      "Teachers move through three steps: choose a format, describe the class, and add community context. Lumen generates a structured draft with cultural anchors and accessibility supports already woven in.",
      "Choose Minimal for brainstorm ideas, Collaborative for an outline and suggestions, or Full Draft for a complete first version. The selected level and your form context are sent to Google Gemini through Lumen's server. If the AI service is unavailable, Lumen reports the problem and offers a local draft only if you choose it.",
      "Before a draft reaches you it is checked: the minutes are reconciled against your period, the reading level is measured, unfilled placeholders are counted, and any numeric answer key is solved again independently. What those checks found is shown on the draft itself. Cultural fit is not among them and never will be — that judgement is yours.",
    ],
  },
  ...concepts.map((c) => toCard(c, "How it works", "blue")),
  ...glossary.map((g) => toCard(g, "Framework", "teal")),
  {
    id: "how-it-compares",
    tag: "Comparison",
    tagTone: "amber",
    title: "How Lumen compares",
    summary:
      "Other teacher AI tools are useful. Most still treat culture as optional free text and skip a built-in bias review.",
    body: [
      ...marketGaps.map((g) => `${g.title}: ${g.detail}`),
      `Tools we looked at: ${toolScan.map((t) => `${t.tool} (${t.focus})`).join("; ")}.`,
    ],
  },
  {
    id: "prompts",
    tag: "Prompts",
    tagTone: "blue",
    title: "Prompt templates",
    summary:
      "Every generator runs on a small set of structured templates that keep culture and access in every draft.",
    body: Object.values(promptLibrary).map(
      (d) => `${d.domain}: ${d.templates.map((t) => t.name).join(", ")}.`
    ),
  },
];

export default function Learn({ classes, setClasses, materials, setMaterials }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [reportCount, setReportCount] = useState(() => loadReports().length);
  const fileRef = useRef(null);

  // The newest draft that carries a prompt version. Materials are not sorted, so
  // this scans rather than assuming index 0.
  const latestPromptVersion = useMemo(() => {
    let best = null;
    for (const mtl of materials || []) {
      const v = mtl?.output?.promptVersion;
      if (!v) continue;
      if (!best || String(mtl.savedAt || "") > String(best.savedAt || "")) {
        best = { savedAt: mtl.savedAt, v };
      }
    }
    return best?.v || null;
  }, [materials]);

  const frameworks = useMemo(() => {
    const by = new Map();
    for (const s of STANDARDS) by.set(s.framework, (by.get(s.framework) || 0) + 1);
    return [...by.entries()]
      .map(([framework, count]) => ({ framework, count }))
      .sort((a, b) => b.count - a.count);
  }, []);

  const downloadBackup = () => {
    const json = backupToJson();
    download(backupFilename(), json, "application/json");
    const n = summarize(JSON.parse(json));
    toast(`Backed up ${n.classes} classes, ${n.materials} materials, ${n.reports} reports.`);
  };

  const onRestoreFile = async (e) => {
    const file = e.target.files?.[0];
    // Reset first, so choosing the same file twice in a row still fires change.
    e.target.value = "";
    if (!file) return;

    let text;
    try {
      text = await file.text();
    } catch {
      return toast("Could not read that file.");
    }
    const parsed = parseBackup(text);
    if (!parsed.ok) return toast(parsed.error);

    const result = restoreBackup(parsed.data, { classes, setClasses, materials, setMaterials });
    if (!result.ok) return toast(result.error);

    setReportCount(loadReports().length);
    const { classes: c, materials: mm, reports: r } = result.added;
    if (!c && !mm && !r) {
      return toast("Everything in that backup is already here. Nothing changed.");
    }
    const parts = [];
    if (c) parts.push(`${c} ${c === 1 ? "class" : "classes"}`);
    if (mm) parts.push(`${mm} ${mm === 1 ? "material" : "materials"}`);
    if (r) parts.push(`${r} ${r === 1 ? "report" : "reports"}`);
    toast(
      result.truncated
        ? `Added ${parts.join(", ")}. ${result.truncated} over the storage limit were not kept.`
        : `Added ${parts.join(", ")}.`
    );
  };

  const downloadReports = () => {
    const name = backupFilename().replace("lumen-backup", "lumen-reports");
    download(name, reportsToJson(), "application/json");
    toast(`Downloaded ${reportCount} ${reportCount === 1 ? "report" : "reports"}.`);
  };

  const wipeReports = () => {
    const snapshot = loadReports();
    if (!clearReports()) return toast("Could not clear reports.");
    setReportCount(0);
    toast(`Cleared ${snapshot.length} ${snapshot.length === 1 ? "report" : "reports"}.`, {
      action: {
        label: "Undo",
        onAction: () => {
          if (!replaceReports(snapshot)) return toast("Could not restore reports.");
          setReportCount(snapshot.length);
          toast("Reports restored.");
        },
      },
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOCS;
    // Cards come in two shapes: the older ones carry `body`, the glossary and
    // concept cards carry labelled fields. Searching only `body` threw on the
    // labelled ones, so this searches whatever text a card actually has.
    const haystack = (d) =>
      [d.title, d.summary, d.tag, d.definition, d.example, d.analogy, d.inProduct]
        .concat(d.body || [])
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return DOCS.filter((d) => haystack(d).includes(q));
  }, [query]);

  const active = DOCS.find((d) => d.id === activeId) || null;

  return (
    <div className="page learn-page">
      <div className="container">
        <header className="learn-hero">
          <h1 className="learn-hero__title">How Lumen works</h1>
          <div className="learn-search">
            <label className="learn-search__field">
              <Icon name="search" size="sm" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Search docs (e.g. "UDL", "how it works", "prompts")'
                aria-label="Search methodology docs"
              />
            </label>
          </div>
        </header>

        {active ? (
          <article className="learn-detail">
            <button type="button" className="learn-detail__back" onClick={() => setActiveId(null)}>
              ← All documents
            </button>
            <div className="learn-detail__tag" data-tone={active.tagTone}>
              {active.tag}
            </div>
            <h2 className="learn-detail__title">{active.title}</h2>
            <p className="learn-detail__summary">{active.summary}</p>

            {/* Cards built from the glossary and the concept list carry labelled
                parts. The older hand-written cards still use `body`, so both
                shapes render rather than one being converted into the other. */}
            {active.definition ? (
              <>
                <h3 className="learn-detail__label">What it means</h3>
                <p className="learn-detail__body">{active.definition}</p>

                {active.example && (
                  <>
                    <h3 className="learn-detail__label">For example</h3>
                    <p className="learn-detail__body learn-detail__body--example">
                      {active.example}
                    </p>
                  </>
                )}

                {active.analogy && (
                  <>
                    <h3 className="learn-detail__label">Put another way</h3>
                    <p className="learn-detail__body learn-detail__body--analogy">
                      {active.analogy}
                    </p>
                  </>
                )}

                {active.inProduct && (
                  <>
                    <h3 className="learn-detail__label">Where you meet it in Lumen</h3>
                    <p className="learn-detail__body">{active.inProduct}</p>
                  </>
                )}
              </>
            ) : (
              (active.body || []).map((para, i) => (
                <p className="learn-detail__body" key={i}>
                  {para}
                </p>
              ))
            )}
          </article>
        ) : (
          <>
          {/* #114 What is sent and what is kept, in plain language. This is the
              first question a union rep asks, and a vague answer is worse than
              no answer. Stated as specifics, not reassurance. */}
          <section className="privacy-note">
            <h2 className="privacy-note__title">What is sent, and what is kept</h2>
            <dl className="privacy-note__list">
              <dt>Which model</dt>
              <dd>
                Google Gemini, called from Lumen's own server. Your browser never talks to
                Google directly and the API key is never sent to your browser.
              </dd>

              <dt>What is sent</dt>
              <dd>
                Only what you type into the planning sheet: subject, course, grade, topic,
                the class context you describe, and your accessibility settings. Lumen adds
                its own instructions and a list of candidate standards.
              </dd>

              <dt>What is never sent</dt>
              <dd>
                Anything that identifies a student. Lumen screens your text before it leaves
                your browser and blocks the request if it finds a name beside a grade or an
                IEP reference, a student ID, an email address, a phone number, or a date of
                birth. You will see exactly what it matched.
              </dd>

              <dt>What Lumen stores</dt>
              <dd>
                Your classes and your saved materials live in your own browser, on your own
                device. There is no Lumen account and no Lumen database. Clearing your
                browser data deletes them, and they do not follow you to another computer.
              </dd>

              <dt>What is logged on the server</dt>
              <dd>
                One line per generation: which resource type, subject, grade and period
                length, how long it took, and which prompt version produced it. The text you
                typed is not logged.
              </dd>

              <dt>What Google does with it</dt>
              <dd>
                That is governed by Google's API terms for the Gemini API, not by Lumen.
                Confirm the current terms with your district before using this with real
                class data.
              </dd>
            </dl>
          </section>

          {/* Pairs with "What Lumen stores" above: your work lives in this one
              browser, so here is how to get a copy of it out. */}
          <section className="method-block">
            <h2 className="method-block__title">Your work</h2>
            <p className="method-block__lead">
              Your classes, materials and reports are stored in this browser and nowhere
              else. There is no account to sign back in to. A backup is the only copy
              that survives clearing your browser data or moving to another computer.
            </p>

            <div className="method-row">
              <div className="method-row__text">
                <h3 className="method-row__title">Back up everything</h3>
                <p className="method-row__body">
                  One file holding every class, every saved material, and every report.
                  Restoring adds what is missing and never overwrites what is already
                  here, so an old backup cannot undo newer work.
                </p>
              </div>
              <div className="method-row__actions">
                <button type="button" className="method-btn" onClick={downloadBackup}>
                  <Icon name="download" size="sm" aria-hidden="true" />
                  Back up my work
                </button>
                <button
                  type="button"
                  className="method-btn method-btn--quiet"
                  onClick={() => fileRef.current?.click()}
                >
                  Restore from a backup
                </button>
                {/* Out of the tab order on purpose. Clipping it but leaving it
                    focusable put a second, invisible tab stop next to the
                    button that already triggers it — a keyboard user would land
                    on a control they cannot see and that shows no focus ring.
                    The visible button is the labelled control; this is only the
                    mechanism it drives. */}
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="method-file"
                  onChange={onRestoreFile}
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </div>
            </div>

            {/* #119 The reports have been write-only since they were added. */}
            <div className="method-row">
              <div className="method-row__text">
                <h3 className="method-row__title">Reports you have filed</h3>
                <p className="method-row__body">
                  {reportCount === 0
                    ? "You have not reported any section as wrong. Nothing has been sent anywhere, and nothing ever is unless you download it and hand it over yourself."
                    : `${reportCount} ${reportCount === 1 ? "report" : "reports"} stored in this browser. Nothing has been sent anywhere. Each one records the section, the settings that produced it, and the prompt version, which is what makes it reproducible later.`}
                </p>
              </div>
              <div className="method-row__actions">
                <button
                  type="button"
                  className="method-btn"
                  onClick={downloadReports}
                  disabled={reportCount === 0}
                >
                  <Icon name="download" size="sm" aria-hidden="true" />
                  Download reports
                </button>
                <button
                  type="button"
                  className="method-btn method-btn--quiet"
                  onClick={wipeReports}
                  disabled={reportCount === 0}
                >
                  Clear
                </button>
              </div>
            </div>
          </section>

          {/* The Method section, deliberately short.
              It used to run five blocks that each restated the others: the
              three-state rule appeared twice, Timing / Answer key / Cultural fit
              appeared in two different lists with near-identical wording, and
              the standards explanation appeared in both a table row and its own
              block. A "standards" section had also been opened around the whole
              "How a draft is made" block, so its heading rendered after it.

              Method now answers what happens, in order, in as few words as it
              can. Anything needing a real explanation is a card in All
              documents, with a definition, an example, and an analogy. */}
          <section className="method-block">
            <h2 className="method-block__title">How a draft is made</h2>
            <p className="method-block__lead">
              Four steps. Everything after the first happens only because a check
              failed.
            </p>
            <ol className="method-steps">
              <li>
                <b>Your sheet goes to the model.</b> Lumen sends what you typed, its own
                instructions, and a list of candidate standards to pick from.
              </li>
              <li>
                <b>The minutes are added up.</b> If they miss your period, Lumen asks
                again and says by how much. It keeps the second answer only if it is
                closer.
              </li>
              <li>
                <b>The reading level is measured.</b> If it is outside the band you asked
                for, Lumen asks once more. Once, not repeatedly.
              </li>
              <li>
                <b>The answer key is solved again.</b> By a second call that never sees the
                first answer. Arithmetic is calculated in code, not asked about.
              </li>
            </ol>
            <p className="method-block__note">
              Four calls is the ceiling. Beyond it, checks that did not run are reported as
              not run rather than assumed fine. With no drafting service reachable, Lumen
              writes a local draft from templates and labels it as one.
              {latestPromptVersion && (
                <>
                  {" "}
                  Your most recent draft used prompt version <b>{latestPromptVersion}</b>.
                </>
              )}
            </p>
          </section>

          {/* The auditable claim: what is recomputed, and what is not. */}
          <section className="method-block">
            <h2 className="method-block__title">What is checked, and what is not</h2>
            <p className="method-block__lead">
              No instructions make a language model incapable of inventing things, so
              Lumen does not claim that. It computes what can be computed, and labels the
              rest. Every draft reports each check as <b>fine</b>, <b>not fine</b>, or{" "}
              <b>not checked</b>, and the third is never folded into the first.
            </p>
            <ul className="claim-groups">
              {CLAIM_ORDER.map((state) => (
                <li key={state} className="claim-group" data-tone={CLAIM_STATE[state].tone}>
                  <h3 className="claim-group__title">{CLAIM_STATE[state].label}</h3>
                  <p className="claim-group__gloss">{CLAIM_STATE[state].gloss}</p>
                  <ul className="claim-group__items">
                    {CLAIMS.filter((c) => c.state === state).map((c) => (
                      <li key={c.claim} className="claim-item">
                        <span className="claim-item__name">{c.claim}</span>
                        <span className="claim-item__how">{c.how}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>

          {/* The dataset behind the standards codes, and its actual size. */}
          <section className="method-block">
            <h2 className="method-block__title">The standards Lumen can cite</h2>
            <p className="method-block__lead">
              Lumen never asks the model to recall a code. It offers a list, the model
              picks from it, and the pick is checked against the list again.
            </p>
            <ul className="method-stats">
              {frameworks.map((f) => (
                <li key={f.framework} className="method-stat">
                  <span className="method-stat__num">{f.count}</span>
                  <span className="method-stat__label">
                    {FRAMEWORK_NAMES[f.framework] || f.framework}
                  </span>
                </li>
              ))}
            </ul>
            <p className="method-block__note">
              {STANDARDS.length} standards, science and mathematics only. Teach outside
              those and you will see few or none, which is the honest answer rather than a
              plausible-looking one.
            </p>
          </section>

          <section className="learn-docs">
            <div className="learn-docs__head">
              <h2 className="learn-docs__title">All documents</h2>
              <p className="learn-docs__sub">
                {filtered.length === 1
                  ? "1 source on method, frameworks, and prompts."
                  : `${filtered.length} sources on method, frameworks, and prompts.`}
              </p>
            </div>
            <div className="learn-grid">
              {filtered.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="learn-card"
                  data-tone={d.tagTone}
                  onClick={() => setActiveId(d.id)}
                >
                  <span className="learn-card__face">
                    <span className="learn-card__accent" aria-hidden="true" />
                    <span className="learn-card__inner">
                      <span className="learn-card__tag" data-tone={d.tagTone}>
                        {d.tag}
                      </span>
                      <span className="learn-card__title">{d.title}</span>
                      <span className="learn-card__summary">{d.summary}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {filtered.length === 0 && (
              <p className="learn-empty">No documents match that search.</p>
            )}
          </section>
          </>
        )}
      </div>
    </div>
  );
}
