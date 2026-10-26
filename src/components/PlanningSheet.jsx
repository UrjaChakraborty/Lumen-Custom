// The planning sheet: one scrollable form that replaced the four-step wizard.
//
// Teachers filling out a lesson plan template see the whole form and fill it in
// whatever order they think of things. The stepper forced a sequence nobody
// works in, hid fields behind gates, and made changing one answer a navigation
// problem. Everything is visible here, in any order, with one action at the end.
import React from "react";
import { searchStandards } from "../data/standards.js";
import { Dropdown } from "./ui.jsx";
import {
  fieldMeta,
  readingLevels,
  resourceLevels,
  learningNeedOptions,
  outputTypes,
  gradeOptions,
  periodLengths,
  lessonStructures,
} from "../data/inputSchema.js";
import s from "../styles/PlanningSheet.module.css";

const assistanceLevels = [
  {
    value: "minimal",
    label: "Minimal",
    tagline: "Help me think",
    description:
      "Brainstorm ideas, discussion questions, and standards connections. AI does not write a complete resource.",
  },
  {
    value: "collaborative",
    label: "Collaborative",
    tagline: "Help me build it",
    description:
      "Get an outline, activity ideas, differentiation, and assessment ideas. You fill in and edit major sections.",
  },
  {
    value: "full",
    label: "Full Draft",
    tagline: "Create first version",
    description:
      "Get a complete resource with activities, assessment, and teacher materials. Review before use.",
  },
];

const customizableTasks = [
  { value: "brainstormIdeas", label: "Brainstorm ideas" },
  { value: "lessonOutline", label: "Create a lesson outline" },
  { value: "draftActivities", label: "Draft activities" },
  { value: "discussionQuestions", label: "Suggest discussion questions" },
  { value: "differentiationStrategies", label: "Create differentiation strategies" },
  { value: "draftAssessment", label: "Draft an assessment" },
  { value: "completeLesson", label: "Create the complete lesson" },
];

// One labelled row. Helper text sits ABOVE the control, because teachers read it
// before typing rather than after. A template-filled field gets a thin left rule
// and a quiet "from template" note with its own reset, instead of the whole
// field being tinted so the form reads as disabled.
// #40 Standards picker. Searchable because a teacher looking for a standard
// searches for "photosynthesis", not "HS-LS1-5". Filtered by the subject already
// on the sheet so the list opens short rather than at eighteen entries.
//
// The dataset is a working subset of high school NGSS and CCSS-M. When nothing
// matches, the picker says so plainly instead of showing an empty box: a teacher
// who cannot find their standard needs to know the list is short, not conclude
// their standard does not exist.
function StandardsPicker({ subject, selected, onChange }) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const results = searchStandards(query, subject).slice(0, 8);
  const chosen = selected || [];

  const toggle = (code) =>
    onChange(chosen.includes(code) ? chosen.filter((c) => c !== code) : [...chosen, code]);

  return (
    <div className={s.stdPicker}>
      {chosen.length > 0 && (
        <ul className={s.stdChosen}>
          {chosen.map((code) => (
            <li key={code} className={s.stdChip}>
              <span className={s.stdChipCode}>{code}</span>
              <button
                type="button"
                className={s.stdChipRemove}
                onClick={() => toggle(code)}
                aria-label={`Remove ${code}`}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id="standards"
        type="text"
        className={s.input}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Blur is delayed so a click on a result lands before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search by code or by what it covers"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="standards-results"

        maxLength={300}
      />
      {open && (
        <ul className={s.stdResults} id="standards-results" role="listbox">
          {results.length === 0 ? (
            <li className={s.stdEmpty}>
              Nothing matched. The list covers common high school NGSS and CCSS-M
              only, so your standard may not be in it yet. You can leave this
              blank and add the code yourself later.
            </li>
          ) : (
            results.map((r) => (
              <li key={r.code}>
                <button
                  type="button"
                  className={`${s.stdResult}${chosen.includes(r.code) ? ` ${s.stdResultOn}` : ""}`}
                  onClick={() => toggle(r.code)}
                  role="option"
                  aria-selected={chosen.includes(r.code)}
                >
                  <span className={s.stdResultHead}>
                    <span className={s.stdResultCode}>{r.code}</span>
                    <span className={s.stdResultFw}>{r.framework}</span>
                  </span>
                  <span className={s.stdResultText}>{r.text}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// `prefillNote` names where a value came from. It defaults to "from template"
// because that is where most prefills originate, but the last-lesson carry
// forward is not a template and saying so would be wrong.
function Field({ id, label, hint, prefilled, onReset, prefillNote = "from template", children }) {
  return (
    <div className={`${s.field}${prefilled ? ` ${s.fieldPrefilled}` : ""}`}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      {hint ? <p className={s.hint}>{hint}</p> : null}
      {children}
      {prefilled ? (
        <p className={s.prefillNote}>
          {prefillNote}
          <button type="button" className={s.resetBtn} onClick={onReset}>
            reset
          </button>
        </p>
      ) : null}
    </div>
  );
}

// Single-select renders as radios so it is visibly different from multi-select.
// Previously both were identical chips and there was no way to tell that reading
// level took one answer and learning needs took several.
function RadioRow({ name, options, value, onChange }) {
  return (
    <div className={s.radioRow} role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className={s.radio}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function CheckRow({ options, values, onToggle }) {
  return (
    <div className={s.checkRow}>
      {options.map((o) => (
        <label key={o} className={s.check}>
          <input type="checkbox" checked={values.includes(o)} onChange={() => onToggle(o)} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

export default function PlanningSheet({
  input,
  set,
  prefilled,
  clearPrefill,
  onGenerate,
  onStartOver,
  loading,
  canGenerate,
  piiFindings = [],
  onDismissPii = () => {},
}) {
  const [customizeOpen, setCustomizeOpen] = React.useState(false);
  const isPre = (k) => prefilled.has(k);
  const reset = (k, to = "") => {
    set(k, to);
    clearPrefill(k);
  };
  const toggleNeed = (n) => {
    const cur = input.learningNeeds || [];
    set("learningNeeds", cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]);
  };

  const showFormat = input.outputType === "assessment" || input.outputType === "feedback";
  const selectedAssistance =
    assistanceLevels.find((level) => level.value === input.assistanceLevel) || assistanceLevels[2];
  const customTasks = input.customTasks || [];
  const toggleCustomTask = (task) => {
    const nextTasks = customTasks.includes(task)
      ? customTasks.filter((current) => current !== task)
      : task === "completeLesson"
        ? [task]
        : [...customTasks.filter((current) => current !== "completeLesson"), task];
    set("customTasks", nextTasks);
  };
  const draftLabel = {
    minimal: "Draft ideas",
    collaborative: "Build with AI",
    full: "Create full draft",
  }[selectedAssistance.value];

  return (
    <div className={s.sheet}>
      {/* The plan header: the metadata block a real lesson plan carries, not a
          row of chips echoing raw field values back at the teacher. */}
      <header className={s.planHeader}>
        <div className={s.headerGrid}>
          <div className={s.headerCell}>
            <span className={s.headerKey}>Course</span>
            <span className={s.headerVal}>{input.course || input.subject || "Not set"}</span>
          </div>
          <div className={s.headerCell}>
            <span className={s.headerKey}>Grade</span>
            <span className={s.headerVal}>{input.grade || "Not set"}</span>
          </div>
          <div className={s.headerCell}>
            <span className={s.headerKey}>Period</span>
            <span className={s.headerVal}>{input.periodLength || 50} min</span>
          </div>
          <div className={s.headerCell}>
            <span className={s.headerKey}>Unit</span>
            <span className={s.headerVal}>{input.unit || "Not set"}</span>
          </div>
          <div className={s.headerCell}>
            <span className={s.headerKey}>Date</span>
            <span className={s.headerVal}>{input.lessonDate || "Not set"}</span>
          </div>
          {/* Resource type belongs here beside the class, not as its own step. */}
          <div className={`${s.headerCell} ${s.headerCellWide}`}>
            <span className={s.headerKey}>Making</span>
            <div className={s.typeRow}>
              {outputTypes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`${s.typeBtn}${input.outputType === t.value ? ` ${s.typeBtnOn}` : ""}`}
                  aria-pressed={input.outputType === t.value}
                  onClick={() => set("outputType", t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`${s.headerCell} ${s.headerCellWide} ${s.assistance}`}>
            <span className={s.headerKey}>AI Assistance</span>
            <div className={s.assistanceControls}>
              <div className={s.assistanceOptions} role="radiogroup" aria-label="AI Assistance Level">
                {assistanceLevels.map((level) => (
                  <label
                    key={level.value}
                    className={`${s.assistanceOption}${
                      selectedAssistance.value === level.value ? ` ${s.assistanceOptionOn}` : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="assistanceLevel"
                      value={level.value}
                      checked={selectedAssistance.value === level.value}
                      onChange={() => set("assistanceLevel", level.value)}
                    />
                    <span>{level.label}</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className={s.customizeLink}
                aria-expanded={customizeOpen}
                aria-controls="ai-customize-options"
                onClick={() => setCustomizeOpen((open) => !open)}
              >
                {customizeOpen ? "Close customize" : "Customize"}
              </button>
            </div>
            <p className={s.assistanceDescription} aria-live="polite">
              <strong>{selectedAssistance.tagline}:</strong> {selectedAssistance.description}
            </p>
            {customizeOpen && (
              <fieldset className={s.customizePanel} id="ai-customize-options">
                <legend>What would you like AI to do?</legend>
                <div className={s.customizeOptions}>
                  {customizableTasks.map((task) => (
                    <label key={task.value} className={s.customizeOption}>
                      <input
                        type="checkbox"
                        checked={customTasks.includes(task.value)}
                        onChange={() => toggleCustomTask(task.value)}
                      />
                      <span>{task.label}</span>
                    </label>
                  ))}
                </div>
                <p className={s.customizeHint}>
                  Selected tasks define what AI creates; your assistance level guides how much detail it provides.
                </p>
              </fieldset>
            )}
          </div>
        </div>
      </header>

      <section className={s.group} aria-labelledby="grp-class">
        <h2 className={s.groupTitle} id="grp-class">
          Your class
        </h2>

        <div className={s.twoCol}>
          <Field
            id="subject"
            label="Subject"
            prefilled={isPre("subject")}
            onReset={() => reset("subject")}
          >
            <input
              id="subject"
              className={s.input}
              value={input.subject}
              onChange={(e) => set("subject", e.target.value)}
              placeholder={fieldMeta.subject.placeholder}

              maxLength={300}
            />
          </Field>
          <Field
            id="course"
            label="Course"
            prefilled={isPre("course")}
            onReset={() => reset("course")}
          >
            <input
              id="course"
              className={s.input}
              value={input.course}
              onChange={(e) => set("course", e.target.value)}
              placeholder={fieldMeta.course.placeholder}

              maxLength={300}
            />
          </Field>
        </div>

        <div className={s.twoCol}>
          {/* A picker, not free text: free text here breaks standards lookup
              and reading-level targeting downstream. */}
          <Field id="grade" label="Grade" prefilled={isPre("grade")} onReset={() => reset("grade")}>
            <Dropdown
              id="grade"
              ariaLabel="Grade"
              value={input.grade}
              options={gradeOptions}
              onChange={(v) => set("grade", v)}
            />
          </Field>
          <Field id="periodLength" label="Period length">
            <Dropdown
              id="periodLength"
              ariaLabel="Period length"
              value={input.periodLength}
              options={periodLengths}
              onChange={(v) => set("periodLength", v)}
            />
          </Field>
        </div>

        <Field
          id="topic"
          label="Topic"
          hint="What this specific lesson covers."
          prefilled={isPre("topic")}
          onReset={() => reset("topic")}
        >
          <input
            id="topic"
            className={s.input}
            value={input.topic}
            onChange={(e) => set("topic", e.target.value)}
            placeholder={fieldMeta.topic.placeholder}

            maxLength={300}
          />
        </Field>

        {/* #40 Standards as a picker against the real list, not free text inside
            "Topic / Standard". The server validates whatever comes back anyway,
            so this is not the safety mechanism; it is what stops a teacher
            typing a code from memory and having it silently dropped. */}
        <Field
          id="standards"
          label="Standards"
          hint="Optional. Pick from the list so the draft can cite the standard's own text."
        >
          <StandardsPicker
            subject={input.subject}
            selected={input.standards || []}
            onChange={(next) => set("standards", next)}
          />
        </Field>

        <div className={s.twoCol}>
          <Field id="unit" label="Unit" hint="Used to group this in My materials.">
            <input
              id="unit"
              className={s.input}
              value={input.unit}
              onChange={(e) => set("unit", e.target.value)}
              placeholder="Unit 4: Energy"

              maxLength={300}
            />
          </Field>
          <Field id="lessonDate" label="Date">
            <input
              id="lessonDate"
              type="date"
              className={s.input}
              value={input.lessonDate}
              onChange={(e) => set("lessonDate", e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className={s.group} aria-labelledby="grp-room">
        <h2 className={s.groupTitle} id="grp-room">
          Your classroom
        </h2>

        <Field
          id="studentInterests"
          label="Student interests"
          hint={fieldMeta.studentInterests.hint}
          prefilled={isPre("studentInterests")}
          onReset={() => reset("studentInterests")}
        >
          <textarea
            id="studentInterests"
            className={s.textarea}
            rows={2}
            value={input.studentInterests}
            onChange={(e) => set("studentInterests", e.target.value)}
            placeholder={fieldMeta.studentInterests.placeholder}

            maxLength={4000}
          />
        </Field>

        <Field
          id="communityContext"
          label="Community context"
          hint={fieldMeta.communityContext.hint}
          prefilled={isPre("communityContext")}
          onReset={() => reset("communityContext")}
        >
          <textarea
            id="communityContext"
            className={s.textarea}
            rows={2}
            value={input.communityContext}
            onChange={(e) => set("communityContext", e.target.value)}
            placeholder={fieldMeta.communityContext.placeholder}

            maxLength={4000}
          />
        </Field>

        {/* Kept verbatim: this is real CRP language and it is doing work. */}
        <Field
          id="culturalAssets"
          label="Cultural & linguistic assets"
          hint={fieldMeta.culturalAssets.hint}
          prefilled={isPre("culturalAssets")}
          onReset={() => reset("culturalAssets")}
        >
          <textarea
            id="culturalAssets"
            className={s.textarea}
            rows={2}
            value={input.culturalAssets}
            onChange={(e) => set("culturalAssets", e.target.value)}
            placeholder={fieldMeta.culturalAssets.placeholder}

            maxLength={4000}
          />
        </Field>

        <div className={s.twoCol}>
          <Field id="classSize" label="Class size" hint="Drives grouping and materials counts.">
            <input
              id="classSize"
              className={s.input}
              inputMode="numeric"
              value={input.classSize}
              onChange={(e) => set("classSize", e.target.value)}
              placeholder="28"

              maxLength={300}
            />
          </Field>
          <Field id="language" label="Language support">
            <input
              id="language"
              className={s.input}
              value={input.language}
              onChange={(e) => set("language", e.target.value)}
              placeholder="English, English + Spanish"

              maxLength={300}
            />
          </Field>
        </div>

        <Field
          id="lastClass"
          label="What students did last class"
          hint="One line. It makes the warm-up much better."
          prefilled={isPre("lastClass")}
          onReset={() => reset("lastClass")}
          prefillNote="from your last lesson"
        >
          <input
            id="lastClass"
            className={s.input}
            value={input.lastClass}
            onChange={(e) => set("lastClass", e.target.value)}
            placeholder="Graphed motion data and compared slopes"

            maxLength={300}
          />
        </Field>

        <Field id="readingLevel" label="Reading level">
          <RadioRow
            name="readingLevel"
            options={readingLevels}
            value={input.readingLevel}
            onChange={(v) => set("readingLevel", v)}
          />
        </Field>

        <Field id="resourceLevel" label="Tech level">
          <RadioRow
            name="resourceLevel"
            options={resourceLevels}
            value={input.resourceLevel}
            onChange={(v) => set("resourceLevel", v)}
          />
        </Field>

        <Field id="lessonStructure" label="Lesson structure" hint="The draft follows this model.">
          <RadioRow
            name="lessonStructure"
            options={lessonStructures}
            value={input.lessonStructure}
            onChange={(v) => set("lessonStructure", v)}
          />
        </Field>

        <Field id="learningNeeds" label="Learning needs" hint="Choose any that apply.">
          <CheckRow
            options={learningNeedOptions}
            values={input.learningNeeds || []}
            onToggle={toggleNeed}
          />
        </Field>

        <div className={s.checkRow}>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={Boolean(input.neurodiverseSupport)}
              onChange={(e) => set("neurodiverseSupport", e.target.checked)}
            />
            <span>Neurodiverse supports</span>
          </label>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={Boolean(input.lowTech)}
              onChange={(e) => set("lowTech", e.target.checked)}
            />
            <span>Low-tech / offline</span>
          </label>
        </div>
      </section>

      {showFormat && (
        <section className={s.group} aria-labelledby="grp-format">
          <h2 className={s.groupTitle} id="grp-format">
            Format
          </h2>
          <Field id="format" label="Which format">
            <RadioRow
              name="format"
              options={
                input.outputType === "assessment"
                  ? [
                      { value: "quiz", label: "Quiz" },
                      { value: "exit", label: "Exit ticket" },
                      { value: "rubric", label: "Project rubric" },
                      { value: "multimodal", label: "Multimodal" },
                    ]
                  : [
                      { value: "strengths", label: "Strengths-based" },
                      { value: "growth", label: "Growth-oriented" },
                      { value: "reflection", label: "Reflection prompts" },
                      { value: "family", label: "Family-friendly" },
                    ]
              }
              value={input.format}
              onChange={(v) => set("format", v)}
            />
          </Field>
        </section>
      )}

      {/* #113 Named, specific, and blocking. A teacher can see exactly what
          matched and fix it; nothing was sent. */}
      {piiFindings.length > 0 && (
        <div className={s.piiAlert} role="alert">
          <p className={s.piiTitle}>This was not sent</p>
          <p className={s.piiBody}>
            Something here looks like it identifies a student. Lumen describes the section,
            never the individuals in it.
          </p>
          <ul className={s.piiList}>
            {piiFindings.map((f, i) => (
              <li key={i}>
                <strong>{f.fieldLabel}</strong> contains {f.label}
                {f.samples?.length ? <span className={s.piiSample}>{f.samples.join(", ")}</span> : null}
              </li>
            ))}
          </ul>
          <button type="button" className={s.piiDismiss} onClick={onDismissPii}>
            I have removed it
          </button>
        </div>
      )}

      {/* One action, where a signature line would be. "Start over" is deliberately
          far from it, since it discards everything. */}
      <footer className={s.actions}>
        <button type="button" className={s.startOver} onClick={onStartOver}>
          Start over
        </button>
        <button
          type="button"
          className={s.generate}
          onClick={onGenerate}
          disabled={loading || !canGenerate}
        >
          {loading && <span className={s.spinner} aria-hidden="true" />}
          {loading ? "Generating with AI…" : draftLabel}
        </button>
      </footer>
    </div>
  );
}
