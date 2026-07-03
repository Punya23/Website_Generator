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

/** Common LLM JSON mistakes — trailing commas, smart quotes. */
export function repairLlmJson(raw: string): string {
  let s = stripJsonFences(raw.trim());
  s = s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  s = s.replace(/,(\s*[}\]])/g, "$1");
  return s;
}

/** Extract the outermost JSON object or array when models prepend/append prose. */
export function extractJsonPayload(raw: string): string {
  const cleaned = repairLlmJson(raw);
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
    return repairLlmJson(slice.slice(0, end + 1));
  }
}

export function normalizeLlmJsonContent(raw: string): string {
  return extractJsonPayload(raw);
}

export function isJsonParseError(err: unknown): boolean {
  return err instanceof SyntaxError || (err instanceof Error && /JSON/i.test(err.message));
}

export function parseLlmJson<T = unknown>(raw: string): T {
  const normalized = normalizeLlmJsonContent(raw);
  try {
    return JSON.parse(normalized) as T;
  } catch (first) {
    const repaired = repairLlmJson(normalized);
    try {
      return JSON.parse(repaired) as T;
    } catch {
      const snippet = raw.slice(0, 400).replace(/\s+/g, " ");
      throw new Error(
        `Invalid JSON from LLM (${first instanceof Error ? first.message : String(first)}). Snippet: ${snippet}`,
        { cause: first }
      );
    }
  }
}
