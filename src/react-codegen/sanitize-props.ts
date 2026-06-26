/** Strip internal fields (imageQuery) before writing props into generated TSX. */
const NESTED_IMAGE_KEYS = ["image", "avatar", "before", "after", "poster"] as const;

export function sanitizeImageField(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const img = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof img.src === "string" && img.src) out.src = img.src;
  if (typeof img.alt === "string" && img.alt) out.alt = img.alt;
  return Object.keys(out).length ? out : undefined;
}

function sanitizeNestedImages(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const key of NESTED_IMAGE_KEYS) {
    if (key in out) {
      const img = sanitizeImageField(out[key]);
      if (img) out[key] = img;
      else delete out[key];
    }
  }
  delete out.imageQuery;
  return out;
}

export function sanitizePropsForCodegen(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key === "image") {
      const img = sanitizeImageField(value);
      if (img) out.image = img;
      continue;
    }

    if (key === "video" && value && typeof value === "object" && !Array.isArray(value)) {
      const video = { ...(value as Record<string, unknown>) };
      if ("poster" in video) {
        const poster = sanitizeImageField(video.poster);
        if (poster) video.poster = poster;
        else delete video.poster;
      }
      out.video = video;
      continue;
    }

    if (Array.isArray(value)) {
      out[key] = value.map((item) => {
        if (!item || typeof item !== "object") return item;
        return sanitizeNestedImages(item as Record<string, unknown>);
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
