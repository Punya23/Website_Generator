/** Strip internal fields (imageQuery) before writing props into generated TSX. */
export function sanitizeImageField(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const img = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof img.src === "string" && img.src) out.src = img.src;
  if (typeof img.alt === "string" && img.alt) out.alt = img.alt;
  return Object.keys(out).length ? out : undefined;
}

export function sanitizePropsForCodegen(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key === "image") {
      const img = sanitizeImageField(value);
      if (img) out.image = img;
      continue;
    }

    if (Array.isArray(value)) {
      out[key] = value.map((item) => {
        if (!item || typeof item !== "object") return item;
        const row = { ...(item as Record<string, unknown>) };
        if ("image" in row) {
          const img = sanitizeImageField(row.image);
          if (img) row.image = img;
          else delete row.image;
        }
        if ("imageQuery" in row) delete row.imageQuery;
        return row;
      });
      continue;
    }

    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if ("imageQuery" in obj || "src" in obj) {
        const img = sanitizeImageField(obj);
        if (img) out[key] = img;
        continue;
      }
      out[key] = sanitizePropsForCodegen(obj);
      continue;
    }

    out[key] = value;
  }

  return out;
}
