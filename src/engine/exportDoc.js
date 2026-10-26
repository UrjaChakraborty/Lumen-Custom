// Export the whole document, in the formats a teacher actually uses (#85, #86).
//
// The previous exporter walked `sections` only, so every download was missing
// the materials list, vocabulary, misconceptions, differentiation, the grouping
// plan, the exit ticket and the answer key. A teacher printing from Lumen got a
// document noticeably thinner than the one on screen and no indication why.
//
// Audience is a parameter, not an afterthought: exporting the student copy has
// to strip the answer key by construction, the same way the screen does.
//
// On formats. Google Docs and Google Classroom need OAuth and a Google API
// client, which is a dependency and a credential decision, so they are not here.
// What is here covers the same ground without either: the Word export writes
// styled HTML with a .doc extension, which Word, Pages, and Google Docs all open
// directly (upload it to Drive and it converts), and PDF goes through the
// browser's own print dialog, which is also how a teacher gets paper.

import { verificationSummary } from "./verificationSummary.js";
import { sourceRowsForDisplay, ORIGIN_LABEL } from "./sourceRows.js";

// Quotes are escaped too. No user content sits in an attribute today, so this
// is not fixing a live hole; it means a future edit that DOES put a value in an
// attribute cannot silently become an injection point.
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const list = (a) => (Array.isArray(a) ? a.filter((x) => String(x || "").trim()) : []);


// Plain-text marks so an exported check reads the same as the on-screen one.
// The three states have to survive the export or the export is lying by omission.
const CHECK_MARK = { pass: "[ok]", warn: "[CHECK]", unchecked: "[not checked]", judgement: "[yours]" };

// Walks the document once and hands each block to a set of format callbacks, so
// Markdown, plain text and Word cannot drift out of sync with each other.
//
// `input` is threaded through only so the verification rows can be recomputed
// for the export. Without it the download carried a static checklist while the
// screen carried real measurements.
function walk(output, audience, v, input) {
  const teacher = audience !== "student";
  const out = [];
  const push = (x) => x && out.push(x);
  const sourceRows = sourceRowsForDisplay(output.sources);

  push(v.title(output.title || "Untitled"));
  if (list(output.meta).length) push(v.meta(list(output.meta)));
  if (list(output.standards).length) {
    push(v.meta(output.standards.map((s) => `${s.code} ${s.framework}`)));
  }

  for (const s of output.sections || []) {
    if (!teacher && s.audience === "teacher") continue;
    push(v.heading(s.label, s.minutes));
    if (Array.isArray(s.body)) push(v.list(s.body));
    else if (String(s.body || "").trim()) push(v.para(s.body));
    if (s.steps?.length) push(v.steps(s.steps));
  }

  const block = (title, fn) => {
    push(v.heading(title));
    fn();
  };

  if (list(output.safety).length) block("Safety", () => push(v.list(output.safety)));

  if (teacher && output.materials) {
    const m = output.materials;
    if (list(m.print).length || list(m.gather).length || list(m.setup).length) {
      block("Materials and prep", () => {
        if (list(m.print).length) {
          push(v.sub("Print"));
          push(v.list(m.print));
        }
        if (list(m.gather).length) {
          push(v.sub("Gather"));
          push(v.list(m.gather));
        }
        if (list(m.setup).length) {
          push(v.sub("Before the bell"));
          push(v.list(m.setup));
        }
      });
    }
  }

  if (output.vocabulary?.length) {
    block("Vocabulary and language supports", () =>
      push(
        v.defs(
          output.vocabulary.map((x) => [
            x.cognate ? `${x.term} (cognate: ${x.cognate})` : x.term,
            x.frame ? `${x.definition} Sentence frame: ${x.frame}` : x.definition,
          ])
        )
      )
    );
  }

  if (teacher && output.misconceptions?.length) {
    block("Common misconceptions", () =>
      push(v.defs(output.misconceptions.map((x) => [x.misconception, x.response])))
    );
  }

  if (teacher && output.differentiation) {
    const d = output.differentiation;
    const any = ["below", "on", "above", "accommodations"].some((k) => list(d[k]).length);
    if (any) {
      block("Differentiation", () => {
        const rows = [
          ["Below grade", d.below],
          ["On grade", d.on],
          ["Above grade", d.above],
          ["Accommodations", d.accommodations],
        ];
        for (const [label, items] of rows) {
          if (!list(items).length) continue;
          push(v.sub(label));
          push(v.list(items));
        }
      });
    }
  }

  if (output.accessibilitySupports?.length) {
    block("Accessibility supports", () =>
      push(
        v.list(
          output.accessibilitySupports.map((s) =>
            s.checkpoint ? `${s.text} [UDL ${s.checkpoint.id} ${s.checkpoint.principle}]` : s.text
          )
        )
      )
    );
  }
  // Teacher-only, like the answer key: a rubric is how you grade, not what
  // students answer.
  if (teacher && output.rubric?.criteria?.length) {
    block("Rubric", () => {
      const names = list(output.rubric.levelNames);
      push(
        v.table(
          ["Criterion", ...names],
          output.rubric.criteria.map((c) => [c.name, ...names.map((_, j) => c.levels?.[j] || "")])
        )
      );
    });
  }

  if (teacher && output.grouping?.formation) {
    block("Grouping plan", () => {
      push(v.para(output.grouping.formation));
      if (output.grouping.roles?.length) {
        push(v.defs(output.grouping.roles.map((r) => [r.role, r.does])));
      }
    });
  }

  if (output.exitTicket?.questions?.length) {
    block("Exit ticket", () => {
      if (String(output.exitTicket.prompt || "").trim()) push(v.para(output.exitTicket.prompt));
      push(v.ordered(output.exitTicket.questions));
      if (teacher && list(output.exitTicket.key).length) {
        push(v.sub("Exit ticket key"));
        push(v.ordered(output.exitTicket.key));
      }
    });
  }

  if (output.homework?.task || output.homework?.extension) {
    block("Homework", () => {
      if (output.homework.task) push(v.para(output.homework.task));
      if (output.homework.extension) {
        push(v.sub("Extension"));
        push(v.para(output.homework.extension));
      }
    });
  }

  // The one gate between an answer key and a student handout, in the export
  // path. It matches the gate on screen deliberately.
  // The timing table was not exported at all. The minutes-against-the-period
  // reconciliation is the first thing a teacher checks and the first thing a
  // department chair asks about, and it existed only on screen.
  if (teacher) {
    const timed = (Array.isArray(output.sections) ? output.sections : []).filter(
      (sec) => Number(sec?.minutes) > 0
    );
    if (timed.length) {
      const total = timed.reduce((n, sec) => n + Math.round(Number(sec.minutes)), 0);
      const target = Number(input?.periodLength) || 0;
      const ticket = Number(output.exitTicket?.minutes) > 0 ? Math.round(Number(output.exitTicket.minutes)) : 0;
      block("Timing", () => {
        push(
          v.defs([
            ...timed.map((sec) => [sec.label || "Section", `${Math.round(Number(sec.minutes))} min`]),
            ...(ticket ? [["Exit ticket", `${ticket} min`]] : []),
            ["Total", target ? `${total + ticket} min of ${target}` : `${total + ticket} min`],
          ])
        );
      });
    }
  }

  if (teacher && output.answerKey?.length) {
    block("Answer key", () => {
      push(v.para("Teacher copy only."));
      push(
        v.defs(
          // The dispute flag travels with the export. It used to be dropped, so
          // an answer an independent solve DISAGREED with downloaded looking
          // exactly like one that had been confirmed — the export quietly
          // undoing the one check that costs a model call to run.
          output.answerKey.map((a) => {
            const body = a.work ? `${a.answer}\n${a.work}` : a.answer;
            if (a.disputed) {
              return [
                `${a.question}  [CHECK THIS]`,
                `${body}\nDisputed: ${a.disputeNote || "an independent solve got a different result."}`,
              ];
            }
            return [a.question, body];
          })
        )
      );
    });
  }

  if (teacher && String(output.familyBlurb || "").trim()) {
    block("Family note", () => push(v.para(output.familyBlurb)));
  }

  if (teacher && sourceRows.length) {
    block("Where the numbers came from", () =>
      push(
        v.list(
          sourceRows.map((r) =>
            r.figure ? `${r.figure} — ${ORIGIN_LABEL[r.origin] ?? r.origin}: ${r.detail}` : r.detail
          )
        )
      )
    );
  }

  // The real checks, not a leaflet.
  //
  // This block used to be five hardcoded lines that read the same whether the
  // timing reconciled or ran twelve minutes over — the exact static text
  // verificationSummary.js was written to replace. It survived here because the
  // export path was never revisited, so the screen said "62 min against a 50 min
  // period, 12 minutes over" and the downloaded Word file said "check the timing
  // against your own pacing". A document that leaves the app is the one a
  // department chair reads; it is the last place that should be reassuring
  // instead of accurate.
  if (teacher) {
    const rows = verificationSummary(output, input);
    if (rows) {
      block("Before you teach this", () =>
        push(
          v.list(
            rows.map((r) => `${CHECK_MARK[r.state] || "-"} ${r.label}: ${r.detail}`)
          )
        )
      );
    } else {
      block("Before you teach this", () =>
        push(
          v.list([
            "This draft carries no verification record, so nothing here was checked automatically.",
            "Check every fact and figure against a source you trust.",
            "Read the cultural connection and confirm it fits your actual students.",
            "Fill in any [insert current data] placeholders.",
          ])
        )
      );
    }
  }

  const asksForDiscussion =
    input?.assistanceLevel === "collaborative" ||
    input?.assistanceLevel === "full" ||
    (Array.isArray(input?.customTasks) && input.customTasks.includes("discussionQuestions"));
  if (asksForDiscussion && list(output.discussionQuestions).length) {
    block("Questions to discuss", () => push(v.ordered(output.discussionQuestions)));
  }

  return out;
}

const MD = {
  title: (t) => `# ${t}\n`,
  meta: (m) => `_${m.join(" · ")}_\n`,
  heading: (h, min) => `## ${h}${min ? ` (${min} min)` : ""}\n`,
  sub: (h) => `**${h}**\n`,
  para: (p) => `${p}\n`,
  list: (a) => list(a).map((x) => `- ${x}`).join("\n") + "\n",
  ordered: (a) => list(a).map((x, i) => `${i + 1}. ${x}`).join("\n") + "\n",
  defs: (rows) => rows.map(([k, val]) => `- **${k}** — ${val}`).join("\n") + "\n",
  steps: (st) =>
    st.map((s, i) => `${i + 1}. **Teacher:** ${s.teacher}\n   **Students:** ${s.students}`).join("\n") +
    "\n",
  // A rubric is a grid: a teacher reads DOWN a column to grade one piece of work.
  // Flattening it to a list would make them rebuild it by hand, which is the work
  // the block exists to save.
  table: (head, rows) =>
    [
      `| ${head.join(" | ")} |`,
      `| ${head.map(() => "---").join(" | ")} |`,
      ...rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`),
    ].join("\n") + "\n",
};

export function toMarkdown(output, audience = "teacher", input = null) {
  const body = walk(output, audience, MD, input).join("\n");
  const which = audience === "student" ? "Student copy" : "Teacher copy";
  return `${body}\n---\n_${which}. Generated by Lumen. Review for accuracy and cultural fit before classroom use._\n`;
}

export function toPlainText(output, audience = "teacher", input = null) {
  return toMarkdown(output, audience, input)
    .replace(/\*\*/g, "")
    .replace(/^#+ /gm, "")
    .replace(/^_|_$/gm, "");
}

const HTML = {
  title: (t) => `<h1>${esc(t)}</h1>`,
  meta: (m) => `<p class="meta">${esc(m.join(" · "))}</p>`,
  heading: (h, min) => `<h2>${esc(h)}${min ? ` <span class="min">${min} min</span>` : ""}</h2>`,
  sub: (h) => `<h3>${esc(h)}</h3>`,
  para: (p) => `<p>${esc(p)}</p>`,
  list: (a) => `<ul>${list(a).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`,
  ordered: (a) => `<ol>${list(a).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`,
  defs: (rows) =>
    `<table>${rows
      .map(
        ([k, v2]) =>
          `<tr><th>${esc(k)}</th><td>${esc(v2).replace(/\n/g, "<br>")}</td></tr>`
      )
      .join("")}</table>`,
  // The two-column procedure survives the export as an actual two-column table,
  // which is the layout the whole feature is for.
  steps: (st) =>
    `<table class="steps"><tr><th>#</th><th>Teacher does</th><th>Students do</th></tr>${st
      .map(
        (s, i) => `<tr><td>${i + 1}</td><td>${esc(s.teacher)}</td><td>${esc(s.students)}</td></tr>`
      )
      .join("")}</table>`,
  table: (head, rows) =>
    `<table class="rubric"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows
      .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`)
      .join("")}</table>`,
};

export function toWordHtml(output, audience = "teacher", input = null) {
  const body = walk(output, audience, HTML, input).join("\n");
  const which = audience === "student" ? "Student copy" : "Teacher copy";
  // Letter page setup, so it opens paginated for Letter rather than A4.
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${esc(output.title || "Lumen")}</title>
<style>
@page { size: 8.5in 11in; margin: 1in; }
body { font-family: Georgia, "Times New Roman", serif; font-size: 11pt; line-height: 1.5; color: #1b1a17; }
h1 { font-size: 18pt; margin: 0 0 4pt; }
h2 { font-size: 13pt; margin: 16pt 0 4pt; border-bottom: 1px solid #999; padding-bottom: 2pt; }
h3 { font-size: 11pt; margin: 10pt 0 2pt; text-transform: uppercase; letter-spacing: 0.5pt; }
p, li { margin: 0 0 6pt; }
.meta, .min { color: #555; font-size: 9pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; }
th, td { border: 1px solid #bbb; padding: 5pt 7pt; text-align: left; vertical-align: top; }
table.steps th:first-child, table.steps td:first-child { width: 6%; text-align: center; }
table.steps th:nth-child(2), table.steps td:nth-child(2),
table.steps th:last-child, table.steps td:last-child { width: 47%; }
.footer { margin-top: 18pt; border-top: 1px solid #999; padding-top: 6pt; font-size: 9pt; color: #555; }
</style></head>
<body>${body}
<p class="footer">${which}. Generated by Lumen. Review for accuracy and cultural fit before classroom use.</p>
</body></html>`;
}
