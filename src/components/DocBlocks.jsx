// The structured blocks that hang off a generated document: materials, timing,
// vocabulary, misconceptions, differentiation, safety, family note, sources.
//
// These are separate typed fields rather than free sections so they can be
// rendered deterministically, filtered by audience, and printed on their own.
import React from "react";
import { verificationSummary } from "../engine/verificationSummary.js";
import { sourceRowsForDisplay, ORIGIN_LABEL } from "../engine/sourceRows.js";
import d from "../styles/DocBlocks.module.css";


const has = (a) => Array.isArray(a) && a.some((x) => String(x || "").trim());

function List({ items }) {
  return (
    <ul className={d.list}>
      {items.filter((x) => String(x || "").trim()).map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

// #82 Blocks are editable too. A teacher who wants to change one line of the
// materials list should not have to spend a rewrite on the whole document, and
// the section-level editor did not reach these because they are typed fields
// rather than sections.
//
// `onEdit` is optional: the print and student views pass nothing and get a plain
// block, so the control cannot appear on a handout.
function Block({ title, note, children, editKey, onEdit, printId }) {
  return (
    // data-print lets the scoped print CSS show or hide a whole block without
    // any of these components knowing what a print scope is.
    <section className={d.block} data-print={printId}>
      <h2 className={d.blockTitle}>
        {title}
        {onEdit && (
          <button
            type="button"
            className={d.blockEdit}
            onClick={() => onEdit(editKey, title)}
            title={`Edit ${title.toLowerCase()}`}
          >
            Edit
          </button>
        )}
      </h2>
      {note ? <p className={d.blockNote}>{note}</p> : null}
      {children}
    </section>
  );
}

// #62 Timing table. The total reconciles against the period length in the UI as
// well as on the server, because this is the number a teacher checks first.
export function TimingTable({ sections, periodLength, hiddenLabels = [] }) {
  const timed = (sections || []).filter((s) => Number(s.minutes) > 0);
  if (!timed.length) return null;
  const total = timed.reduce((n, s) => n + Number(s.minutes), 0);

  // Some sections are dropped from the document because a typed block says the
  // same thing better (differentiation, accessibility). Their minutes are still
  // part of the period the model budgeted, so removing them would make the total
  // stop matching the bell. But listing them by name schedules a teacher against
  // sections they cannot find on the page.
  //
  // So they collapse into one honest row that says where the content went.
  const hidden = new Set(hiddenLabels);
  const shown = timed.filter((s) => !hidden.has(s.label));
  const folded = timed.filter((s) => hidden.has(s.label));
  const foldedMinutes = folded.reduce((n, s) => n + Number(s.minutes), 0);
  const target = Number(periodLength) || 0;
  const over = target > 0 && total > target;
  const under = target > 0 && total < target - 2;
  return (
    <Block title="Timing" printId="timing">
      <table className={d.timing}>
        <tbody>
          {shown.map((s, i) => (
            <tr key={i}>
              <td className={d.timingLabel}>{s.label}</td>
              <td className={d.timingMin}>{s.minutes} min</td>
            </tr>
          ))}
          {foldedMinutes > 0 && (
            <tr>
              <td className={d.timingLabel}>Supports, in the blocks below</td>
              <td className={d.timingMin}>{foldedMinutes} min</td>
            </tr>
          )}
          <tr className={d.timingTotal}>
            <td className={d.timingLabel}>Total</td>
            <td className={d.timingMin}>
              {total} min{target ? ` of ${target}` : ""}
            </td>
          </tr>
        </tbody>
      </table>
      {over && (
        <p className={d.timingWarn}>
          This runs {total - target} minutes past the period. Shorten a section or ask for a
          30 minute version.
        </p>
      )}
      {under && (
        <p className={d.timingNote}>
          This leaves {target - total} minutes spare. Useful if your class needs settling time.
        </p>
      )}
    </Block>
  );
}

// #53/#56 The procedure, laid out the way a plan template lays it out: two
// columns, one row per move, numbered because the order is load-bearing. On a
// phone the columns stack and keep their labels, since an unlabelled stack of
// alternating sentences is unreadable.
export function StepTable({ steps }) {
  if (!Array.isArray(steps) || !steps.length) return null;
  return (
    <ol className={d.steps}>
      {steps.map((s, i) => (
        <li key={i} className={d.step}>
          <span className={d.stepNum} aria-hidden="true">
            {i + 1}
          </span>
          <div className={d.stepCol}>
            <span className={d.stepWho}>Teacher does</span>
            <p className={d.stepText}>{s.teacher}</p>
          </div>
          <div className={d.stepCol}>
            <span className={d.stepWho}>Students do</span>
            <p className={d.stepText}>{s.students}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// The first decision of the morning is how many copies to run, and until now it
// sat nine screens down inside "Materials and prep". This is the same data,
// promoted to a dense strip under the plan header. The full block stays where it
// is, because on paper it belongs with the plan rather than at the top.
export function PrepStrip({ output, audience }) {
  if (audience === "student") return null;
  const print = (output?.materials?.print || []).filter((x) => String(x || "").trim());
  const gather = (output?.materials?.gather || []).filter((x) => String(x || "").trim());
  const safety = (output?.safety || []).filter((x) => String(x || "").trim());
  if (!print.length && !gather.length && !safety.length) return null;

  return (
    <aside className={d.prep} aria-label="Before the bell" data-print="prep">
      {print.length > 0 && (
        <p className={d.prepLine}>
          <span className={d.prepKey}>Print</span>
          <span className={d.prepVal}>{print.join(" · ")}</span>
        </p>
      )}
      {gather.length > 0 && (
        <p className={d.prepLine}>
          <span className={d.prepKey}>Gather</span>
          <span className={d.prepVal}>{gather.join(" · ")}</span>
        </p>
      )}
      {/* Safety is the one line that must be read before the lesson starts, so
          it repeats here even though it also has its own block. */}
      {safety.length > 0 && (
        <p className={`${d.prepLine} ${d.prepSafety}`}>
          <span className={d.prepKey}>Safety</span>
          <span className={d.prepVal}>{safety.join(" · ")}</span>
        </p>
      )}
    </aside>
  );
}

export default function DocBlocks({ output, input, audience, onEditBlock }) {
  const teacherView = audience !== "student";
  const asksForDiscussion =
    input?.assistanceLevel === "collaborative" ||
    input?.assistanceLevel === "full" ||
    (Array.isArray(input?.customTasks) && input.customTasks.includes("discussionQuestions"));
  // null when the document carries no verification, which the block below
  // handles by falling back rather than claiming anything.
  const checks = verificationSummary(output, input);
  // Tolerant of the old shape: documents saved before sources became derived
  // carry an array of plain strings, and dropping them would lose real content
  // from a teacher's saved work.
  const sourceRows = sourceRowsForDisplay(output?.sources);
  const {
    materials,
    vocabulary = [],
    misconceptions = [],
    differentiation,
    accessibilitySupports = [],
    safety = [],
    familyBlurb,
    sources = [],
    answerKey = [],
    exitTicket,
    homework,
    grouping,
    rubric,
    discussionQuestions = [],
  } = output || {};

  return (
    <>
      {/* #72 Safety leads when it applies, because it is the thing that has to
          be read before the lesson starts, not after. */}
      {has(safety) && (
        <Block title="Safety" printId="safety" editKey="safety" onEdit={teacherView ? onEditBlock : undefined}>
          <List items={safety} />
        </Block>
      )}

      {/* #61 Materials and prep, teacher only. */}
      {teacherView && materials && (has(materials.print) || has(materials.gather) || has(materials.setup)) && (
        <Block title="Materials and prep" printId="materials" editKey="materials" onEdit={teacherView ? onEditBlock : undefined}>
          {has(materials.print) && (
            <>
              <h3 className={d.subhead}>Print</h3>
              <List items={materials.print} />
            </>
          )}
          {has(materials.gather) && (
            <>
              <h3 className={d.subhead}>Gather</h3>
              <List items={materials.gather} />
            </>
          )}
          {has(materials.setup) && (
            <>
              <h3 className={d.subhead}>Before the bell</h3>
              <List items={materials.setup} />
            </>
          )}
        </Block>
      )}

      {/* #64 Vocabulary and language supports. Shown to students too. */}
      {vocabulary.length > 0 && (
        <Block title="Vocabulary and language supports" printId="vocabulary">
          <dl className={d.vocab}>
            {vocabulary.map((v, i) => (
              <div key={i} className={d.vocabRow}>
                <dt className={d.vocabTerm}>
                  {v.term}
                  {v.cognate ? <span className={d.cognate}>cognate: {v.cognate}</span> : null}
                </dt>
                <dd className={d.vocabDef}>
                  {v.definition}
                  {v.frame ? <span className={d.frame}>Sentence frame: {v.frame}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      {/* #65 Misconceptions, teacher only. */}
      {teacherView && misconceptions.length > 0 && (
        <Block
          title="Common misconceptions" printId="misconceptions"
          note="What students typically get wrong here, and how to respond."
        >
          <dl className={d.vocab}>
            {misconceptions.map((m, i) => (
              <div key={i} className={d.vocabRow}>
                <dt className={d.vocabTerm}>{m.misconception}</dt>
                <dd className={d.vocabDef}>{m.response}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      {/* #66 Differentiation, teacher only. */}
      {teacherView &&
        differentiation &&
        (has(differentiation.below) ||
          has(differentiation.on) ||
          has(differentiation.above) ||
          has(differentiation.accommodations)) && (
          <Block title="Differentiation" printId="differentiation">
            {has(differentiation.below) && (
              <>
                <h3 className={d.subhead}>Below grade</h3>
                <List items={differentiation.below} />
              </>
            )}
            {has(differentiation.on) && (
              <>
                <h3 className={d.subhead}>On grade</h3>
                <List items={differentiation.on} />
              </>
            )}
            {has(differentiation.above) && (
              <>
                <h3 className={d.subhead}>Above grade</h3>
                <List items={differentiation.above} />
              </>
            )}
            {has(differentiation.accommodations) && (
              <>
                <h3 className={d.subhead}>Accommodations</h3>
                <List items={differentiation.accommodations} />
              </>
            )}
          </Block>
        )}

      {/* #57 Accessibility supports, each tagged with the UDL checkpoint it
          serves. The principle is the part a teacher scans for; the number is
          what makes the claim checkable against the CAST guidelines. */}
      {accessibilitySupports.length > 0 && (
        <Block title="Accessibility supports" printId="accessibility">
          <ul className={d.udlList}>
            {accessibilitySupports.map((s, i) => (
              <li key={i} className={d.udlItem}>
                <span className={d.udlText}>{s.text}</span>
                {s.checkpoint && (
                  <span className={d.udlTag} title={s.checkpoint.text}>
                    <span className={d.udlPrinciple}>{s.checkpoint.principle}</span>
                    <span className={d.udlId}>{s.checkpoint.id}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* #71 Grouping plan. Useless without the class size, which is why the
          arithmetic is stated rather than left as "put them in small groups". */}
      {/* The half of an assessment that actually takes a Sunday afternoon. A
          table, because a rubric IS a table and prose would make a teacher
          rebuild it by hand. */}
      {teacherView && rubric?.criteria?.length > 0 && (
        <Block title="Rubric" printId="rubric">
          <div className={d.rubricScroll}>
            <table className={d.rubricTable}>
              <thead>
                <tr>
                  <th scope="col">Criterion</th>
                  {(rubric.levelNames || []).map((n, i) => (
                    <th key={i} scope="col">{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rubric.criteria.map((c, i) => (
                  <tr key={i}>
                    <th scope="row">{c.name}</th>
                    {(rubric.levelNames || []).map((_, j) => (
                      <td key={j}>{c.levels?.[j] || ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      {teacherView && grouping?.formation && (
        <Block title="Grouping plan" printId="grouping">
          <p className={d.prose}>{grouping.formation}</p>
          {Array.isArray(grouping.roles) && grouping.roles.length > 0 && (
            <dl className={d.vocab}>
              {grouping.roles.map((r, i) => (
                <div key={i} className={d.vocabRow}>
                  <dt className={d.vocabTerm}>{r.role}</dt>
                  <dd className={d.vocabDef}>{r.does}</dd>
                </div>
              ))}
            </dl>
          )}
        </Block>
      )}

      {/* #69 Exit ticket, its own printable. Students see the questions; the key
          is filtered out structurally rather than by trusting a label. */}
      {exitTicket?.questions?.length > 0 && (
        <Block
          title="Exit ticket"
          printId="exit-ticket"
          note={
            Number(exitTicket.minutes) > 0
              ? `Allow ${exitTicket.minutes} minutes at the end of the period.`
              : undefined
          }
        >
          {String(exitTicket.prompt || "").trim() && (
            <p className={d.prose}>{exitTicket.prompt}</p>
          )}
          <ol className={d.numbered}>
            {exitTicket.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </Block>
      )}

      {/* The key is a SEPARATE block, not a subsection of the exit ticket.
          Nested, it could never be scoped for print: hiding the ticket to print
          only the key would hide the key with it. Separating them also fixes the
          screen, where a key sitting under the same heading as the questions
          read as part of the handout. */}
      {teacherView && exitTicket?.questions?.length > 0 && has(exitTicket.key) && (
        <Block title="Exit ticket key" printId="exit-ticket-key">
          <ol className={d.numbered}>
            {exitTicket.key.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ol>
        </Block>
      )}

      {/* #70 Homework and extension. */}
      {(homework?.task || homework?.extension) && (
        <Block title="Homework" printId="homework">
          {homework.task && <p className={d.prose}>{homework.task}</p>}
          {homework.extension && (
            <>
              <h3 className={d.subhead}>Extension</h3>
              <p className={d.prose}>{homework.extension}</p>
            </>
          )}
        </Block>
      )}

      {/* #67 Answer key and worked solutions. Teacher copy only, and gated on
          `teacherView` here rather than anywhere else, so there is exactly one
          line of code standing between an answer key and a student handout. */}
      {teacherView && answerKey.length > 0 && (
        <Block title="Answer key" printId="answer-key" note="Teacher copy only. Not on the student handout.">
          <ol className={d.numbered}>
            {answerKey.map((a, i) => (
              <li key={i} className={`${d.keyRow}${a.disputed ? ` ${d.keyRowDisputed}` : ""}`}>
                <p className={d.keyQ}>{a.question}</p>
                <p className={d.keyA}>
                  {a.answer}
                  {/* #99/#108 The state of the number is shown, not implied.
                      "Checked" means it was independently confirmed; silence
                      means nothing was claimed either way. */}
                  {a.verified && (
                    <span className={d.keyVerified} title="Confirmed by an independent solve">
                      checked
                    </span>
                  )}
                </p>
                {a.disputed && (
                  <p className={d.keyDispute}>
                    <strong>Check this one.</strong> {a.disputeNote}
                  </p>
                )}
                {String(a.work || "").trim() && <pre className={d.keyWork}>{a.work}</pre>}
              </li>
            ))}
          </ol>
        </Block>
      )}

      {/* #74 Family note, teacher only: it is something they send, not teach. */}
      {teacherView && String(familyBlurb || "").trim() && (
        <Block title="Family note" printId="family" note="Paste into a newsletter or translate.">
          <p className={d.prose}>{familyBlurb}</p>
        </Block>
      )}

      {/* Provenance, derived in code rather than written by the model.
          `sources` used to be a free-text field with no validation, which made it
          the one place a fabricated citation could land looking authoritative.
          Now every row's origin is assigned by code, and the row that matters is
          the one code produces when a figure traced to nothing. Not editable:
          editing a derived record would only let the teacher overwrite the
          finding, and the finding is the point. */}
      {teacherView && sourceRows.length > 0 && (
        <Block title="Where the numbers came from" printId="sources">
          <ul className={d.sourceList}>
            {sourceRows.map((row, i) => (
              <li key={i} className={d.sourceRow} data-origin={row.origin}>
                {row.figure ? <b className={d.sourceFigure}>{row.figure}</b> : null}
                {/* "none" is the declaration row and has no chip: an empty
                    label fell through the `||` and rendered the raw key, so a
                    clean draft announced itself with a shouty "NONE". */}
                {ORIGIN_LABEL[row.origin] !== "" && (
                  <span className={d.sourceOrigin}>{ORIGIN_LABEL[row.origin] ?? row.origin}</span>
                )}
                <span className={d.sourceDetail}>{row.detail}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* #76/#108 What was actually checked on THIS draft.

          This used to be five hardcoded lines that read identically whether the
          timing reconciled or ran twelve minutes over. The pipeline was already
          measuring all of it and discarding the results. Now the block reports
          them, including the checks that did not run: an unchecked row renders
          differently from a passing one, because a green tick nobody earned is
          worse than an honest gap. */}
      {teacherView && (
        <Block title="Before you teach this" printId="checks">
          {checks ? (
            <dl className={d.checks}>
              {checks.map((c) => (
                <div key={c.id} className={`${d.checkRow} ${d[`check_${c.state}`]}`}>
                  <dt className={d.checkLabel}>
                    <span className={d.checkMark} aria-hidden="true">
                      {c.state === "pass" ? "✓" : c.state === "warn" ? "!" : "?"}
                    </span>
                    {c.label}
                  </dt>
                  <dd className={d.checkDetail}>{c.detail}</dd>
                </div>
              ))}
            </dl>
          ) : (
            /* No verification travelled with this document (the offline engine
               produces none), so fall back rather than render an empty shell
               or imply checks that never ran. */
            <ul className={d.checklist}>
              <li>Check every fact and figure against a source you trust.</li>
              <li>Read the cultural connection and confirm it fits your actual students.</li>
              <li>Fill in any [insert current data] placeholders.</li>
              <li>Confirm the standard matches what your department expects.</li>
              <li>Check the timing against your own pacing.</li>
            </ul>
          )}
        </Block>
      )}
      {asksForDiscussion && Array.isArray(discussionQuestions) && discussionQuestions.length > 0 && (
        <Block title="Questions to discuss" printId="discussion-questions">
          <ol className={d.numbered}>
            {discussionQuestions.map((question, i) => (
              <li key={i}>{question}</li>
            ))}
          </ol>
        </Block>
      )}
    </>
  );
}
