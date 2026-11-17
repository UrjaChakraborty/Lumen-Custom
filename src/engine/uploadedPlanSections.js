const MAX_SECTION_CHARS = 7_000;
const KNOWN_SECTION = /^(?:\d+\s*[|.)]\s*)?(?:lesson overview|overview|lesson goals?|learning goals?|learning objectives?|learning targets?|objectives?|outcomes?|materials(?: and preparation)?|preparation|resources|supplies|key vocabulary|vocabulary|key terms?|pacing|lesson sequence|teaching sequence|instruction\s*(?:\/|and)\s*methodology|methodology|teaching methods?|procedure|procedures|activities|warm[- ]?up|hook|launch|model|direct instruction|guided practice|independent practice|independent check|partner investigation|assessment|evaluation|exit ticket|differentiation|accommodations?|access(?:ibility)? supports?|access, assessment, and next steps|scaffolded practice|low[- ]tech option|suggested key(?: and look-fors)?|language support|visual support|extension|closure|homework|teacher notes?|after class)(?:\s*[-:|].*)?$/i;

const SECTION_ORDER = [
  "Lesson overview",
  "Learning goals",
  "Materials and preparation",
  "Key vocabulary",
  "Teaching sequence",
  "Assessment",
  "Accessibility and differentiation",
];

function canonicalHeading(label) {
  const key = label
    .replace(/^\d+\s*[|.)]\s*/, "")
    .trim()
    .toLowerCase()
    .replace(/[:.]+$/, "");
  if (/^(lesson )?(goals?|objectives?|learning objectives?|learning targets?|outcomes?)$/.test(key)) {
    return "Learning goals";
  }
  if (/^(materials?( and preparation)?|preparation|resources|supplies)$/.test(key)) {
    return "Materials and preparation";
  }
  if (/^(key )?(vocabulary|terms?)$/.test(key)) return "Key vocabulary";
  if (/^(teaching|lesson) sequence$|^procedures?$|^activities$/.test(key)) {
    return "Teaching sequence";
  }
  if (/^(instruction\s*(?:\/|and)\s*methodology|methodology|teaching methods?)$/.test(key)) {
    return "Teaching sequence";
  }
  if (/^(assessment|assessments|evaluation)$/.test(key)) return "Assessment";
  if (/^(warm[- ]?up|hook|launch|model|direct instruction|guided practice|independent practice|partner investigation|closure)$/.test(key)) {
    return "Teaching sequence";
  }
  if (/^(differentiation|accommodations?|accessibility supports?)$/.test(key)) {
    return "Accessibility and differentiation";
  }
  if (/^(lesson )?overview$/.test(key)) return "Lesson overview";
  return label;
}

function inferSection(text) {
  if (
    /\b(objectives?|learning goals?|learning targets?|learning outcomes?)\b/i.test(text) ||
    /\bstudents will (?:be able to|understand|identify|explain|calculate|describe|compare|analyze|create|evaluate|demonstrate)\b/i.test(text)
  ) {
    return "Learning goals";
  }
  if (/\b(materials?|supplies|resources|equipment|prepare|preparation)\b/i.test(text)) {
    return "Materials and preparation";
  }
  if (/\b(key vocabulary|vocabulary|key terms?)\b/i.test(text)) return "Key vocabulary";
  if (/\b(assessment|evaluate|evaluation|exit ticket|quiz|check for understanding|evidence of learning)\b/i.test(text)) {
    return "Assessment";
  }
  if (/\b(differentiat|accommodat|accessibility|language support|visual support|scaffold|extension)\b/i.test(text)) {
    return "Accessibility and differentiation";
  }
  if (
    /\b(warm[- ]?up|hook|launch|procedure|teaching sequence|lesson sequence|guided practice|independent practice|partner work|investigation|closure|lesson activity|activity)\b/i.test(text) ||
    /^\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?)\s*[·-]/i.test(text)
  ) {
    return "Teaching sequence";
  }
  return "Lesson overview";
}

function inferHeading(label) {
  const canonical = canonicalHeading(label);
  return canonical === label ? inferSection(label) : canonical;
}

function inferSections(text) {
  const buckets = new Map(SECTION_ORDER.map((label) => [label, []]));
  const lines = text.split("\n");
  let active = "Lesson overview";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (buckets.get(active).length && buckets.get(active).at(-1) !== "") {
        buckets.get(active).push("");
      }
      continue;
    }
    const inlineLabel = line.match(/^([^:|]{2,60})\s*[:|]\s*(.*)$/);
    if (inlineLabel && KNOWN_SECTION.test(inlineLabel[1].trim())) {
      active = inferHeading(inlineLabel[1].trim());
      if (inlineLabel[2].trim()) buckets.get(active).push(inlineLabel[2].trim());
      continue;
    }
    if (KNOWN_SECTION.test(line)) {
      active = inferHeading(line);
      continue;
    }
    const inferred = inferSection(line);
    if (inferred !== "Lesson overview") active = inferred;
    buckets.get(active).push(rawLine);
  }

  const sections = [];
  for (const label of SECTION_ORDER) {
    const body = buckets
      .get(label)
      .join("\n")
      .trim();
    if (!body) continue;
    for (let start = 0, part = 1; start < body.length; part += 1) {
      let end = Math.min(start + MAX_SECTION_CHARS, body.length);
      if (end < body.length) {
        const boundary = body.lastIndexOf(" ", end);
        if (boundary > start) end = boundary;
      }
      sections.push({
        label: part === 1 ? label : `${label} · Part ${part}`,
        body: body.slice(start, end).trim(),
      });
      start = end;
      while (body[start] === " " || body[start] === "\n") start += 1;
    }
  }
  return sections.length ? sections : [{ label: "Uploaded lesson plan", body: text.trim() }];
}

function isPageHeading(line) {
  return /^#{1,3}\s+page\s+\d+\s*#*$/i.test(line);
}

function formatTimedActivity(line) {
  const cleaned = line.replace(/^(?:[-*]\s+|\d+[.)]\s+)/, "").trim();
  const match = cleaned.match(
    /^(\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?)(?:\.)?)\s*[-–—:]\s*(.+)$/i
  );
  if (!match) return line;

  const parts = match[2].split(/\s+[-–—]\s+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return line;

  const activity = parts.shift();
  const group = parts.length > 1 ? parts.shift() : "";
  const description = parts.join(" — ");
  const heading = [match[1].replace(/\.$/, ""), activity, group]
    .filter(Boolean)
    .join(" · ");
  return description ? `${heading}\n${description}` : heading;
}

function normalizeUploadedText(text) {
  return text
    .replace(/[\u2022\uF0B7\u25AA\u25CF\u25E6]/g, "\n")
    .replace(/([.!?:;])\s+-\s+(?=[A-Z0-9])/g, "$1\n- ")
    .replace(
      /(^|\n)([ \t]*)(instruction\s*(?:\/|and)\s*methodology|methodology|teaching\s*methods?)(?=\s|$)/gi,
      "$1## $3\n"
    )
    .replace(
      /[ \t]+(?=\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?)\.?\s*[-–—])/gi,
      "\n"
    )
    .split("\n")
    .map(formatTimedActivity)
    .join("\n\n")
    .replace(/\n{2,}(?=-\s)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function uploadedPlanSections(text) {
  text = normalizeUploadedText(text);
  if (!/^\s*#{1,3}\s+/m.test(text)) return inferSections(text);

  const sections = [];
  let label = "Lesson overview";
  let bodyLines = [];
  let hasHeadings = false;
  let pendingHeading = "";
  let leadingBody = "";

  const save = () => {
    const body = bodyLines.join("\n").trim();
    bodyLines = [];
    if (body && !hasHeadings) {
      leadingBody = [leadingBody, body].filter(Boolean).join("\n");
      return;
    }
    if (!body) {
      if (hasHeadings && label !== "Lesson overview") {
        pendingHeading = [pendingHeading, label].filter(Boolean).join(" · ");
      }
      return;
    }
    const sectionLabel = [pendingHeading, label].filter(Boolean).join(" · ");
    const sectionBody = [leadingBody, body].filter(Boolean).join("\n");
    leadingBody = "";
    pendingHeading = "";
    for (let start = 0, part = 1; start < sectionBody.length; part += 1) {
      let end = Math.min(start + MAX_SECTION_CHARS, sectionBody.length);
      if (end < sectionBody.length) {
        const boundary = sectionBody.lastIndexOf(" ", end);
        if (boundary > start) end = boundary;
      }
      sections.push({
        label: part === 1 ? sectionLabel : `${sectionLabel} · Part ${part}`,
        body: sectionBody.slice(start, end).trim(),
      });
      start = end;
      while (sectionBody[start] === " " || sectionBody[start] === "\n") start += 1;
    }
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{1,3})\s+(.+?)\s*#*$/);
    const markedList = heading && /^(?:[-*]\s+|\d+[.)]\s+)/.test(heading[2]);
    const isHeading = heading && !markedList;
    const inlineHeading = !heading && line.match(/^([^:|]{2,60})\s*[:|]\s*(.+)$/);
    const plainLabel = inlineHeading && KNOWN_SECTION.test(inlineHeading[1].trim())
      ? inlineHeading[1].trim()
      : line;
    const plainHeading =
      !heading &&
      line.length <= 90 &&
      (KNOWN_SECTION.test(line) ||
        (inlineHeading && KNOWN_SECTION.test(inlineHeading[1].trim())));
    if (isHeading || plainHeading) {
      if (isPageHeading(line)) {
        if (hasHeadings) {
          save();
          label = "Lesson overview";
          pendingHeading = "";
        }
        continue;
      }
      save();
      label = canonicalHeading((heading?.[2] || plainLabel).slice(0, 300));
      hasHeadings = true;
      if (inlineHeading && KNOWN_SECTION.test(inlineHeading[1].trim()) && inlineHeading[2].trim()) {
        bodyLines.push(inlineHeading[2].trim());
      }
    } else {
      bodyLines.push(markedList ? heading[2] : rawLine);
    }
  }
  save();

  if (!hasHeadings && leadingBody) {
    return inferSections(leadingBody);
  }
  return sections;
}
