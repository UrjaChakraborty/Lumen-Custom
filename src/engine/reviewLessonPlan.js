import { classifyResponse, classifyThrown, malformedPayload } from "./apiError.js";

function excerptMatches(plan, excerpt) {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  return Boolean(normalize(excerpt) && normalize(plan).includes(normalize(excerpt)));
}

export async function reviewLessonPlan(text) {
  let res;
  try {
    res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonText: text }),
    });
  } catch (error) {
    throw classifyThrown(error);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const classified = classifyResponse(res);
    const error = new Error(data?.error || classified.message);
    error.kind = classified.kind;
    error.recoverable = classified.recoverable;
    error.findings = data?.findings || [];
    throw error;
  }

  const data = await res.json().catch(() => null);
  if (
    !data ||
    typeof data.summary !== "string" ||
    !Array.isArray(data.recommendations) ||
    data.recommendations.length === 0
  ) {
    throw malformedPayload();
  }

  const recommendations = data.recommendations.filter(
    (item) =>
      item &&
      typeof item.title === "string" &&
      typeof item.insight === "string" &&
      typeof item.excerpt === "string" &&
      excerptMatches(text, item.excerpt) &&
      typeof item.exampleRewrite === "string"
  );
  if (recommendations.length === 0) throw malformedPayload();

  return { ...data, recommendations };
}
