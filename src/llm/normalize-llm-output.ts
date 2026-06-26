/** Shared coercers for malformed LLM JSON (common with local/smaller models). */

export function coerceToString(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(val)) {
    const parts = val
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const obj = item as Record<string, unknown>;
          const nested = obj.text ?? obj.value ?? obj.content ?? obj.label;
          return typeof nested === "string" ? nested.trim() : "";
        }
        return "";
      })
      .filter(Boolean);
    return parts.length ? parts.join(" ") : undefined;
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const nested = obj.text ?? obj.value ?? obj.content ?? obj.label ?? obj.name;
    if (typeof nested === "string") return nested.trim() || undefined;
  }
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return undefined;
}

export function coerceToStringArray(val: unknown): string[] | undefined {
  if (val === null || val === undefined) return undefined;
  if (Array.isArray(val)) {
    const parts = val
      .map((item) => coerceToString(item))
      .filter((s): s is string => Boolean(s));
    return parts.length ? parts : undefined;
  }
  const single = coerceToString(val);
  return single ? [single] : undefined;
}

export function padArrayToMin<T>(
  arr: T[] | undefined,
  min: number,
  filler: (index: number) => T
): T[] {
  const out = [...(arr ?? [])];
  while (out.length < min) {
    out.push(filler(out.length));
  }
  return out;
}

const COPY_STRING_FIELDS = new Set([
  "body",
  "subcopy",
  "headline",
  "quote",
  "caption",
  "label",
  "author",
  "role",
  "placeholder",
  "buttonLabel",
  "tagline",
  "message",
]);

const COPY_ARRAY_FIELDS = new Set([
  "paragraphs",
  "phrases",
]);

const COPY_OBJECT_ARRAY_FIELDS = new Set([
  "members",
  "items",
  "stats",
  "slides",
  "projects",
  "tiers",
  "logos",
  "formFields",
  "steps",
  "images",
]);

/** Normalize copy props before Zod validation. */
export function normalizeCopyProps(
  templateId: string,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  for (const [key, val] of Object.entries(out)) {
    if (COPY_STRING_FIELDS.has(key)) {
      const coerced = coerceToString(val);
      if (coerced !== undefined) out[key] = coerced;
    }
    if (COPY_ARRAY_FIELDS.has(key)) {
      const coerced = coerceToStringArray(val);
      if (coerced !== undefined) out[key] = coerced;
    }
    if (key === "cta" && val && typeof val === "object" && !Array.isArray(val)) {
      const cta = { ...(val as Record<string, unknown>) };
      if ("label" in cta) cta.label = coerceToString(cta.label) ?? cta.label;
      out.cta = cta;
    }
    if (COPY_OBJECT_ARRAY_FIELDS.has(key) && Array.isArray(val)) {
      out[key] = (val as unknown[]).map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        const row = { ...(item as Record<string, unknown>) };
        for (const field of ["title", "description", "name", "role", "bio", "question", "answer", "quote", "author", "value", "label"]) {
          if (field in row) {
            const coerced = coerceToString(row[field]);
            if (coerced !== undefined) row[field] = coerced;
          }
        }
        return row;
      });
    }
  }

  return out;
}

/** Pad undersized arrays using defaults from mock merge. */
export function padCopyArraysFromDefaults(
  llmPartial: Record<string, unknown>,
  defaults: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...llmPartial };

  for (const key of COPY_OBJECT_ARRAY_FIELDS) {
    const llmArr = out[key];
    const defaultArr = defaults[key];
    if (!Array.isArray(defaultArr)) continue;

    if (!Array.isArray(llmArr) || llmArr.length === 0) {
      out[key] = defaultArr;
      continue;
    }

    const minLen = defaultArr.length >= 2 ? 2 : defaultArr.length;
    if (llmArr.length < minLen) {
      const padded = [...llmArr];
      for (let i = llmArr.length; i < minLen; i++) {
        padded.push(defaultArr[i] ?? defaultArr[defaultArr.length - 1]);
      }
      out[key] = padded;
    }
  }

  for (const key of COPY_ARRAY_FIELDS) {
    const llmArr = out[key];
    const defaultArr = defaults[key];
    if (!Array.isArray(defaultArr)) continue;
    if (!Array.isArray(llmArr) || llmArr.length === 0) {
      out[key] = defaultArr;
    }
  }

  return out;
}

const DESIGN_STRING_FIELDS = ["mood", "vertical", "motionStyle", "fontHeading", "fontBody"];

/** Normalize design-council agent payloads before schema parse. */
export function normalizeAgentPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };

  for (const key of DESIGN_STRING_FIELDS) {
    if (key in out) {
      const coerced = coerceToString(out[key]);
      if (coerced !== undefined) out[key] = coerced;
    }
  }

  if (out.typography && typeof out.typography === "object" && !Array.isArray(out.typography)) {
    const typo = { ...(out.typography as Record<string, unknown>) };
    for (const key of Object.keys(typo)) {
      const coerced = coerceToString(typo[key]);
      if (coerced !== undefined) typo[key] = coerced;
    }
    out.typography = typo;
  }

  return out;
}

/** Normalize expanded brief fields before schema parse. */
export function normalizeExpandedBrief(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };

  for (const key of ["tagline", "elevatorPitch", "expandedBrief", "targetAudience", "tone", "primaryCta", "secondaryCta", "businessName"]) {
    if (key in out) {
      const coerced = coerceToString(out[key]);
      if (coerced !== undefined) out[key] = coerced;
    }
  }

  for (const key of ["services", "differentiators"]) {
    if (!(key in out)) continue;
    const val = out[key];
    if (typeof val === "string") {
      out[key] = val.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) => coerceToString(item)).filter((s): s is string => Boolean(s));
    }
  }

  return out;
}
