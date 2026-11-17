import React, { useEffect, useRef, useState } from "react";
import { screenLongTextForPII } from "../engine/piiScreen.js";
import { PdfReadError, readLessonPlanPdf } from "../engine/readLessonPlanPdf.js";
import { reviewLessonPlan } from "../engine/reviewLessonPlan.js";
import styles from "../styles/Feedback.module.css";

const MAX_FILE_BYTES = 200 * 1024;
const MAX_PLAN_CHARS = 20_000;

export default function Feedback({ initialPlan = null, onConsumeInitialPlan = () => {} }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [findings, setFindings] = useState([]);
  const fileInput = useRef(null);

  useEffect(() => {
    if (!initialPlan?.text) return;
    setTitle(initialPlan.title || "Lumen lesson plan");
    setText(initialPlan.text);
    setFileName("");
    setWarnings([]);
    setResult(null);
    setError("");
    setFindings([]);
    onConsumeInitialPlan();
  }, [initialPlan]);

  async function loadFile(file) {
    if (!file) return;
    setError("");
    setFindings([]);
    setResult(null);
    setWarnings([]);
    setProgress("");

    if (file.size > MAX_FILE_BYTES) {
      setError("This file is larger than 200 KB. Export a smaller or text-only copy and try again.");
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();
    try {
      let contents;
      if (extension === "pdf" || file.type === "application/pdf") {
        const extracted = await readLessonPlanPdf(file, setProgress);
        contents = extracted.text;
        setWarnings(extracted.warnings);
      } else if (["txt", "md", "markdown"].includes(extension)) {
        contents = await file.text();
      } else {
        setError("Choose a PDF, plain text (.txt), or Markdown (.md) lesson plan.");
        return;
      }

      setTitle(file.name.replace(/\.[^.]+$/, ""));
      setText(contents);
      setFileName(file.name);
    } catch (loadError) {
      setError(
        loadError instanceof PdfReadError
          ? loadError.message
          : "The file could not be read. Try a PDF, plain text, or Markdown copy."
      );
    } finally {
      setProgress("");
    }
  }

  async function analyze(event) {
    event.preventDefault();
    setError("");
    setFindings([]);
    setResult(null);
    const plan = text.trim();
    if (!plan) {
      setError("Add a lesson plan before asking for feedback.");
      return;
    }
    if (plan.length > MAX_PLAN_CHARS) {
      setError(
        `This plan is ${plan.length.toLocaleString()} characters. Shorten it to ${MAX_PLAN_CHARS.toLocaleString()} characters or less to continue.`
      );
      return;
    }

    const pii = screenLongTextForPII("uploadedLesson", plan);
    if (pii.length) {
      setFindings(pii);
      setError("Review and remove any student-identifying information before requesting AI feedback.");
      return;
    }

    setBusy(true);
    try {
      setResult(await reviewLessonPlan(plan));
    } catch (reviewError) {
      setError(reviewError.message || "Feedback could not be generated. Try again.");
      setFindings(reviewError.findings || []);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setTitle("");
    setText("");
    setFileName("");
    setWarnings([]);
    setResult(null);
    setError("");
    setFindings([]);
    if (fileInput.current) fileInput.current.value = "";
  }

  const overLimit = text.length > MAX_PLAN_CHARS;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>A second look at your lesson</p>
        <h1 className={styles.title}>Feedback</h1>
        <p className={styles.lead}>
          Upload a plan you wrote or send a lesson from Lumen. Get practical
          improvement ideas grounded in sentences from your draft.
        </p>
      </header>

      <div className={styles.layout}>
        <form className={styles.formCard} onSubmit={analyze}>
          <div className={styles.cardHeading}>
            <span className={styles.step}>01</span>
            <div>
              <h2>Bring a lesson plan</h2>
              <p>PDF, plain text, or Markdown. Your document stays in this browser until you request feedback.</p>
            </div>
          </div>

          <input
            ref={fileInput}
            className={styles.fileInput}
            type="file"
            accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
            aria-label="Choose a lesson plan file"
            onChange={(event) => loadFile(event.target.files?.[0])}
          />
          <button
            type="button"
            className={styles.uploadButton}
            onClick={() => fileInput.current?.click()}
            disabled={busy || Boolean(progress)}
          >
            <span className={styles.uploadIcon} aria-hidden="true">↑</span>
            <span>
              <strong>{fileName ? "Choose a different file" : "Choose a file"}</strong>
              <small>PDF, TXT, or MD · up to 200 KB</small>
            </span>
          </button>
          {progress && <p className={styles.status} role="status">{progress}</p>}

          <div className={styles.divider}><span>or paste / edit the plan</span></div>
          <label className={styles.label} htmlFor="feedback-title">Plan title <span>optional</span></label>
          <input
            id="feedback-title"
            className={styles.titleInput}
            value={title}
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Modeling the water cycle"
          />
          <label className={styles.label} htmlFor="feedback-plan">Lesson plan</label>
          <textarea
            id="feedback-plan"
            className={styles.textarea}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
              setError("");
              setFindings([]);
            }}
            rows={14}
            placeholder="Paste the lesson plan here, or choose a file above…"
            aria-describedby="feedback-plan-count"
          />
          <div className={styles.formFooter}>
            <span
              id="feedback-plan-count"
              className={overLimit ? styles.countOver : styles.count}
              aria-live="polite"
            >
              {text.length.toLocaleString()} / {MAX_PLAN_CHARS.toLocaleString()} characters
            </span>
            <div className={styles.formActions}>
              {(text || title) && (
                <button type="button" className={styles.clearButton} onClick={reset} disabled={busy}>
                  Clear
                </button>
              )}
              <button type="submit" className={styles.analyzeButton} disabled={busy || !text.trim() || overLimit}>
                {busy ? "Reviewing…" : "Review this plan"}
              </button>
            </div>
          </div>
          <p className={styles.privacy}>
            Student-identifying information is screened before sending. When you
            request feedback, the lesson text is sent to Lumen’s AI service for
            analysis and is not saved by this page.
          </p>

          {warnings.length > 0 && (
            <div className={styles.notice} role="status">
              <strong>PDF reading notes</strong>
              <ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            </div>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {findings.length > 0 && (
            <ul className={styles.findings} aria-label="Information to review">
              {findings.map((finding) => (
                <li key={`${finding.id}-${finding.field}`}>
                  <strong>{finding.label}</strong>
                  {finding.samples?.length > 0 && <span> Matched: {finding.samples.join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </form>

        <section className={styles.results} aria-live="polite" aria-busy={busy}>
          {!result && !busy && (
            <div className={styles.emptyCard}>
              <span className={styles.resultStep}>02</span>
              <h2>Specific, usable next steps</h2>
              <p>
                Feedback will point to exact sentences in your plan, explain why
                a change could help, and offer a sample rewrite you can adapt.
              </p>
              <ul>
                <li>Keep the lesson’s purpose and teaching context in view.</li>
                <li>Look for clarity, sequencing, access, and evidence of learning.</li>
                <li>Use suggestions as options, not an automatic score.</li>
              </ul>
            </div>
          )}

          {busy && (
            <div className={styles.loadingCard} role="status">
              <span className={styles.spinner} />
              <h2>Reading your lesson plan</h2>
              <p>Finding a few focused opportunities for improvement…</p>
            </div>
          )}

          {result && (
            <div className={styles.resultContent}>
              <div className={styles.resultHeader}>
                <span className={styles.resultStep}>02</span>
                <div>
                  <p className={styles.eyebrow}>Feedback for</p>
                  <h2>{title || fileName || "Your lesson plan"}</h2>
                </div>
              </div>
              <p className={styles.summary}>{result.summary}</p>
              <h3 className={styles.listHeading}>Ideas to consider</h3>
              <ol className={styles.recommendations}>
                {result.recommendations.map((item, index) => (
                  <li className={styles.recommendation} key={`${item.title}-${index}`}>
                    <div className={styles.recommendationTop}>
                      <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
                      <h3>{item.title}</h3>
                      <span className={`${styles.priority} ${styles[`priority${item.priority}`]}`}>
                        {item.priority}
                      </span>
                    </div>
                    <p className={styles.insight}>{item.insight}</p>
                    <blockquote className={styles.excerpt}>
                      <span>From your plan</span>
                      “{item.excerpt}”
                    </blockquote>
                    <div className={styles.example}>
                      <span>Example to adapt</span>
                      <p>{item.exampleRewrite}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className={styles.disclaimer}>
                AI suggestions can miss classroom context. Review each idea and
                keep what works for your students.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
