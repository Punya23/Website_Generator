/**
 * Some providers (notably Gemini via OpenRouter) wrap json_object responses in
 * markdown fences despite response_format. Strip fences before JSON.parse.
 */
export function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenced) return fenced[1]!.trim();

  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

/** Extract the outermost JSON object or array when models prepend/append prose. */
export function extractJsonPayload(raw: string): string {
  const cleaned = stripJsonFences(raw);
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    const objStart = cleaned.indexOf("{");
    const arrStart = cleaned.indexOf("[");
    const start =
      objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
    if (start < 0) return cleaned;

    const slice = cleaned.slice(start);
    const end = Math.max(slice.lastIndexOf("}"), slice.lastIndexOf("]"));
    if (end < 0) return cleaned;
    return slice.slice(0, end + 1);
  }
}

export function normalizeLlmJsonContent(raw: string): string {
  return extractJsonPayload(raw);
}

export function parseLlmJson<T = unknown>(raw: string): T {
  return JSON.parse(normalizeLlmJsonContent(raw)) as T;
}
