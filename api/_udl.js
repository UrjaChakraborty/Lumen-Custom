// CAST UDL checkpoints, and the same treatment standards get (#95).
//
// "Add UDL supports" produces a generic list. Requiring each support to cite a
// specific checkpoint, chosen from a provided list and validated in code, makes
// the claim checkable: a teacher or a coach can look up 2.4 and see whether the
// support actually does what 2.4 says. It also stops the model asserting UDL
// alignment in the abstract, which is what #107 forbids.
//
// Numbering follows the CAST UDL Guidelines. This is a working subset covering
// the checkpoints that come up in STEM lesson design, not the full framework.

export const UDL_CHECKPOINTS = [
  // ── Engagement (the "why" of learning) ────────────────────────────────
  { id: "7.1", principle: "Engagement", text: "Optimize individual choice and autonomy" },
  { id: "7.2", principle: "Engagement", text: "Optimize relevance, value, and authenticity" },
  { id: "7.3", principle: "Engagement", text: "Minimize threats and distractions" },
  { id: "8.1", principle: "Engagement", text: "Heighten salience of goals and objectives" },
  { id: "8.2", principle: "Engagement", text: "Vary demands and resources to optimize challenge" },
  { id: "8.3", principle: "Engagement", text: "Foster collaboration and community" },
  { id: "8.4", principle: "Engagement", text: "Increase mastery-oriented feedback" },
  { id: "9.3", principle: "Engagement", text: "Develop self-assessment and reflection" },

  // ── Representation (the "what" of learning) ───────────────────────────
  { id: "1.1", principle: "Representation", text: "Offer ways of customizing the display of information" },
  { id: "1.2", principle: "Representation", text: "Offer alternatives for auditory information" },
  { id: "1.3", principle: "Representation", text: "Offer alternatives for visual information" },
  { id: "2.1", principle: "Representation", text: "Clarify vocabulary and symbols" },
  { id: "2.2", principle: "Representation", text: "Clarify syntax and structure" },
  { id: "2.4", principle: "Representation", text: "Promote understanding across languages" },
  { id: "2.5", principle: "Representation", text: "Illustrate through multiple media" },
  { id: "3.1", principle: "Representation", text: "Activate or supply background knowledge" },
  { id: "3.2", principle: "Representation", text: "Highlight patterns, critical features, big ideas, and relationships" },
  { id: "3.3", principle: "Representation", text: "Guide information processing and visualization" },

  // ── Action and expression (the "how" of learning) ─────────────────────
  { id: "4.1", principle: "Action and expression", text: "Vary the methods for response and navigation" },
  { id: "4.2", principle: "Action and expression", text: "Optimize access to tools and assistive technologies" },
  { id: "5.1", principle: "Action and expression", text: "Use multiple media for communication" },
  { id: "5.2", principle: "Action and expression", text: "Use multiple tools for construction and composition" },
  { id: "5.3", principle: "Action and expression", text: "Build fluencies with graduated levels of support for practice and performance" },
  { id: "6.2", principle: "Action and expression", text: "Support planning and strategy development" },
  { id: "6.4", principle: "Action and expression", text: "Enhance capacity for monitoring progress" },
];

const INDEX = new Map(UDL_CHECKPOINTS.map((c) => [c.id, c]));

export function formatCheckpointsForPrompt() {
  return UDL_CHECKPOINTS.map((c) => `${c.id} (${c.principle}): ${c.text}`).join("\n");
}

// Same gate as standards: a checkpoint id the model invented is dropped rather
// than displayed, because a wrong citation is worse than none.
export function validateCheckpoints(ids) {
  const valid = [];
  const rejected = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const key = String(raw || "").trim();
    const hit = INDEX.get(key);
    if (hit) {
      if (!valid.some((v) => v.id === hit.id)) valid.push(hit);
    } else if (key) {
      rejected.push(raw);
    }
  }
  return { valid, rejected };
}

// Attaches the checkpoint text to each accessibility support the model tagged,
// dropping any tag that is not a real checkpoint.
export function resolveSupportTags(supports) {
  const out = [];
  const rejected = [];
  for (const s of Array.isArray(supports) ? supports : []) {
    const { valid, rejected: bad } = validateCheckpoints([s?.checkpoint]);
    rejected.push(...bad);
    out.push({
      text: String(s?.text || "").trim(),
      checkpoint: valid[0] || null,
    });
  }
  return { supports: out.filter((s) => s.text), rejected };
}
