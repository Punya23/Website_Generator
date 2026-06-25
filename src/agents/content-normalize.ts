import type { ContentBlock } from "../types.js";

export const SUPPORTED_BLOCK_TYPES = new Set([
  "headline",
  "text",
  "image",
  "gallery",
  "feature",
  "stat",
  "testimonial",
  "cta",
  "contact",
  "faq",
  "pricing",
  "logo",
  "bento",
  "list",
  "form",
  "beforeAfter",
]);

const BLOCK_TYPE_COERCION: Record<string, string> = {
  bulletlist: "list",
  bullet_list: "list",
  accordion: "list",
  checklist: "list",
  formfield: "form",
  card: "feature",
  profilecard: "feature",
  profile_card: "feature",
  icon: "feature",
  photo: "image",
  backgroundimage: "image",
  background_image: "image",
  quote: "testimonial",
  beforeafter: "beforeAfter",
  before_after: "beforeAfter",
  submit: "button",
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function coerceBlockType(raw: string): string {
  const key = raw.toLowerCase().replace(/[\s-]/g, "");
  return BLOCK_TYPE_COERCION[key] ?? raw.toLowerCase();
}

function aliasFields(block: ContentBlock, sectionId: string): ContentBlock {
  const type = block.type;
  const out: ContentBlock = { ...block };

  if (type === "text") {
    if (!str(out.text)) {
      out.text = str(out.content) ?? str(out.body) ?? "";
    }
  }

  if (type === "cta") {
    if (!str(out.headline)) {
      out.headline = str(out.text) ?? str(out.title) ?? "";
    }
    if (!str(out.buttonUrl) && str(out.url)) {
      out.buttonUrl = out.url;
    }
  }

  if (type === "testimonial") {
    if (!str(out.quote)) {
      out.quote = str(out.text) ?? str(out.content) ?? "";
    }
  }

  if (type === "feature") {
    if (!str(out.title)) out.title = str(out.name) ?? str(out.headline) ?? "Feature";
    if (!str(out.description)) {
      out.description = str(out.text) ?? str(out.content) ?? str(out.body) ?? "";
    }
  }

  if (type === "image" || type === "gallery") {
    if (!str(out.alt)) out.alt = str(out.altText) ?? str(out.caption);
  }

  if (type === "headline") {
    const level = num(out.level) ?? 1;
    const isHeroSection = sectionId.includes("hero");
    if (!isHeroSection || level >= 2) {
      delete out.heroImage;
      delete out.splitImage;
    } else {
      out.variant = "hero";
    }
    if (!str(out.text)) {
      out.text = str(out.title) ?? str(out.content) ?? "";
    }
  }

  if (type === "list") {
    if (!Array.isArray(out.items) && Array.isArray(out.list)) {
      out.items = out.list;
    }
  }

  if (type === "form" && Array.isArray(out.fields)) {
    out.fields = out.fields.map((field) => {
      if (!field || typeof field !== "object") return field;
      const f = { ...(field as Record<string, unknown>) };
      if (!str(f.label) && str(f.name)) f.label = f.name;
      if (!str(f.type)) f.type = "text";
      return f;
    });
  }

  return out;
}

function blockToTextSummary(block: ContentBlock): ContentBlock {
  const title = str(block.title) ?? str(block.headline) ?? str(block.name);
  const text =
    str(block.text) ??
    str(block.content) ??
    str(block.body) ??
    str(block.description) ??
    str(block.quote) ??
    (Array.isArray(block.items) ? block.items.map(String).join(", ") : undefined);

  if (title || text) {
    return {
      id: block.id,
      type: "text",
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
    };
  }

  return { id: block.id, type: "text", text: "" };
}

function normalizeSingleBlock(block: ContentBlock, sectionId: string): ContentBlock | null {
  let type = coerceBlockType(String(block.type ?? "text"));

  if (type === "button") {
    return null;
  }

  if (!SUPPORTED_BLOCK_TYPES.has(type)) {
    return blockToTextSummary({ ...block, type });
  }

  const normalized = aliasFields({ ...block, type }, sectionId);
  return normalized;
}

function absorbSubmitButtons(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const rawType = String(block.type ?? "").toLowerCase();

    if (rawType === "button" || coerceBlockType(rawType) === "button") {
      const label = str(block.text) ?? str(block.label) ?? "Submit";
      const prev = out[out.length - 1];
      if (prev?.type === "form" && !prev.submitLabel) {
        out[out.length - 1] = { ...prev, submitLabel: label };
      }
      continue;
    }

    out.push(block);
  }
  return out;
}

export function normalizeBlockType(raw: string): string {
  const coerced = coerceBlockType(raw);
  return SUPPORTED_BLOCK_TYPES.has(coerced) ? coerced : "text";
}

export function normalizePlannerBlockTypes(types: string[]): string[] {
  const normalized = types.map((t) => normalizeBlockType(t));
  return [...new Set(normalized)];
}

export const PLANNER_BLOCK_TYPES = [
  "headline",
  "text",
  "image",
  "feature",
  "stat",
  "testimonial",
  "cta",
  "contact",
  "faq",
  "pricing",
  "logo",
  "bento",
  "list",
  "form",
] as const;

export function normalizeContentBlocks(
  blocks: ContentBlock[],
  sectionId: string
): ContentBlock[] {
  const merged = absorbSubmitButtons(blocks);

  return merged
    .map((b) => normalizeSingleBlock(b, sectionId))
    .filter((b): b is ContentBlock => b !== null);
}
