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

/**
 * Corrects a closing bracket of the wrong TYPE — `}` where `]` was expected, or vice versa —
 * without touching anything else. Confirmed live: a real Ollama response closed a string array
 * with `}` instead of `]` (`{"queries":["a","b","c"} }`, twice, identically, across all 3 retry
 * attempts of the same call — a stable per-model tic, not a one-off fluke), which no amount of
 * trailing-comma or smart-quote repair, or even correct substring extraction, can fix: the
 * structure itself is wrong, not just padded with noise. String-aware, stack-based (the standard
 * lenient-JSON-repair technique): tracks which closer is actually expected at each depth and
 * swaps in the right one when the model's closer doesn't match. Leaves a stray closer with nothing
 * on the stack alone (unrelated — `extractJsonPayload`'s balanced-bracket scan already handles a
 * dangling trailing bracket after a complete value) and never invents a closer for a genuinely
 * truncated response — only a mismatched already-present bracket has a real fix here.
 */
export function healMismatchedBrackets(text: string): string {
  const stack: Array<"}" | "]"> = [];
  const chars = [...text];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push("}");
    } else if (ch === "[") {
      stack.push("]");
    } else if (ch === "}" || ch === "]") {
      const expected = stack.pop();
      if (expected && ch !== expected) chars[i] = expected;
    }
  }
  return chars.join("");
}

/** Common LLM JSON mistakes — trailing commas, smart quotes, a closing bracket of the wrong type. */
export function repairLlmJson(raw: string): string {
  let s = stripJsonFences(raw.trim());
  s = s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  s = s.replace(/,(\s*[}\]])/g, "$1");
  s = healMismatchedBrackets(s);
  return s;
}

/**
 * Index of the character that closes the bracket opened at `start` (inclusive), tracking nesting
 * depth and skipping over string contents (so a `}`/`]` inside a quoted value never miscounts) —
 * or -1 if `text` never balances back to depth 0. `lastIndexOf("}")` over the whole remaining
 * string (this function's predecessor) is wrong whenever anything — valid or garbage — follows a
 * complete, balanced value: confirmed live, a real Ollama response appended one stray extra `}`
 * after an otherwise-correct `{"queries":[...]}`, and grabbing the LAST `}` in the string included
 * that stray one, producing unrepairable invalid JSON (a genuinely balanced object, wrapped in one
 * extra unmatched brace) every one of the 3 retry attempts, because every attempt made the exact
 * same "same trailing tic" mistake. Proper bracket matching ignores anything past the true close.
 */
function findMatchingBracketEnd(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    } else if (ch === "{" || ch === "[") {
      // A differently-typed bracket nested inside — depth-track it too so its own close doesn't
      // prematurely register against `close`. Cheap approximation: treat every open bracket as
      // adding depth and every close as removing it, regardless of type; malformed mismatched
      // nesting (rare, and unrepairable anyway) just falls through to returning -1 below.
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0 && ch === close) return i;
    }
  }
  return -1;
}

/** Extract the outermost JSON object or array when models prepend/append prose (or, confirmed
 *  live, append a stray extra bracket after an otherwise-valid value). */
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

    const balancedEnd = findMatchingBracketEnd(cleaned, start);
    if (balancedEnd >= 0) {
      return repairLlmJson(cleaned.slice(start, balancedEnd + 1));
    }
    // Fell through: the value never actually balances (real truncation, not just trailing noise)
    // — the old last-bracket heuristic is still a reasonable last resort here, since there's no
    // "true" end to find and grabbing as much as possible is the only thing left to try.
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
