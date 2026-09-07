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

/**
 * True when `text` looks like it's still JSON (or a JSON-mode model's error/refusal prose) rather
 * than prose copy — the guard every place that splices a raw LLM string into a page's text content
 * (as opposed to a schema-validated field) must run first. Real live-site symptom this exists to
 * catch: a value like `{"headline":"Great Bakes","body":"..."}` landing verbatim in an `<h1>`
 * because the field-level parse succeeded (it IS valid JSON — just the whole envelope, not the one
 * field a caller asked for) or a retry/self-check path handed back its own raw response instead of
 * the extracted value.
 */
export function looksLikeRawJson(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^[{[][\s\S]*[}\]]$/.test(t) === false) return false;
  // Cheap positive signal on top of the bracket check: a real JSON object/array almost always has
  // a `"key":` pair or `,` between elements — a stray "{smile}" or "[laughs]" aside in real copy
  // has neither and should not trip this.
  return /"[^"]+"\s*:/.test(t) || /^[[{]\s*["{[]/.test(t);
}

export function parseLlmJson<T = unknown>(raw: string): T {
  if (!raw.trim()) {
    throw new SyntaxError("Empty JSON payload from LLM");
  }
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
