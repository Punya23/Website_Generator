import { z } from "zod";
import type { ContentBlock, ExpandedBrief, LayoutNode, PagePlan, SitePlan } from "../types.js";
import { LayoutNodeSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import {
  collectIds,
  normalizeLayoutNode,
  repairLayoutCoverage,
  sanitizeLayoutNode,
} from "./layout-normalize.js";

const COMPOSITION_SYSTEM = `You are the layout architect for one page of a marketing site. Design spatial rhythm that fits this business.

Think through:
- What should command attention first? What deserves full width vs a contained column?
- When should sections bleed edge-to-edge vs share the same content width?
- How many columns keep cards aligned and uniform rather than a mismatched puzzle?
- Where does vertical breathing room help hierarchy?
- How does this page's layout relate to the site's overall composition strategy?

Layout primitives (children are block id STRINGS or nested nodes — never embed block objects):
- Section: { "type": "Section", "fullBleed"?: boolean, "children": [...] }
- Stack: { "type": "Stack", "children": [...] }
- Row: { "type": "Row", "children": [...], "columns"?: number }
- Grid: { "type": "Grid", "children": [...], "columns"?: number, "minColumnWidth"?: number }

Every block id appears exactly once. No CSS. No absolute positioning.

Output JSON with "reasoning" (your spatial thinking) and "layout" keys only.`;

export async function composeLayout(
  blocks: ContentBlock[],
  pagePlan: PagePlan,
  brief: ExpandedBrief,
  sitePlan: SitePlan
): Promise<LayoutNode> {
  requireLlm("composition");
  const blockIds = blocks.map((b) => b.id);
  const blockSummary = blocks.map((b) => ({
    id: b.id,
    type: b.type,
    preview: String(b.title ?? b.text ?? b.headline ?? b.caption ?? "").slice(0, 60),
  }));

  if (llm.isAvailable) {
    try {
      return await requestLayoutFromLlm(
        blocks,
        pagePlan,
        brief,
        sitePlan,
        blockSummary,
        blockIds
      );
    } catch (err) {
      if (!allowMocks()) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      pipelineLog(
        `[composition] LLM layout failed for ${pagePlan.slug}, using mock: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  if (!allowMocks()) throw new Error("Composition requires LLM");
  return mockComposition(blocks, pagePlan, brief, sitePlan);
}

async function requestLayoutFromLlm(
  blocks: ContentBlock[],
  pagePlan: PagePlan,
  brief: ExpandedBrief,
  sitePlan: SitePlan,
  blockSummary: { id: string; type: string; preview: string }[],
  blockIds: string[]
): Promise<LayoutNode> {
  const userPrompt = `BUSINESS: ${brief.businessName} (${brief.tone})
COMPOSITION STRATEGY: ${sitePlan.compositionStrategy}
VISUAL PERSONALITY: ${sitePlan.visualArchetype ?? "derive from the business"}
MOTION: ${sitePlan.motionStyle ?? "your judgment"}
AVOID: ${sitePlan.avoidPatterns.join("; ")}

PAGE: ${pagePlan.slug} — ${pagePlan.title}
Goal: ${pagePlan.goal}
Spatial direction: ${pagePlan.layoutHint}

BLOCK IDS (use these strings exactly in children):
${blockIds.join(", ")}

BLOCKS (${blocks.length}):
${JSON.stringify(blockSummary, null, 2)}`;

  const raw = await llm.chat(COMPOSITION_SYSTEM, userPrompt, {
    jsonMode: true,
    temperature: 0.35,
    tokenRole: "composition",
    model: llm.getCompositionModel(),
  });

  return parseAndValidateLayout(raw, blockIds);
}

function parseAndValidateLayout(raw: string, blockIds: string[]): LayoutNode {
  const parsed = JSON.parse(raw) as { reasoning?: string; layout?: unknown };
  const layoutRaw = parsed.layout ?? parsed;

  const normalized = normalizeLayoutNode(layoutRaw, blockIds);
  if (!normalized) {
    throw new Error("Could not normalize LLM layout tree");
  }

  let validated: LayoutNode;
  try {
    validated = LayoutNodeSchema.parse(sanitizeLayoutNode(normalized));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(`Layout schema invalid after normalize: ${err.issues[0]?.message ?? "unknown"}`);
    }
    throw err;
  }

  const repaired = repairLayoutCoverage(validated, blockIds);
  const used = collectIds(repaired);
  const extra = used.filter((id) => !blockIds.includes(id));
  if (extra.length > 0) {
    throw new Error(`Layout has unknown block ids: ${extra.join(", ")}`);
  }

  return repaired;
}

export function mockComposition(
  blocks: ContentBlock[],
  pagePlan: PagePlan,
  _brief: ExpandedBrief,
  _sitePlan: SitePlan
): LayoutNode {
  const byType = (type: string) => blocks.filter((b) => b.type === type).map((b) => b.id);
  const headlines = byType("headline");
  const images = byType("image");
  const stats = byType("stat");
  const features = byType("feature");
  const testimonials = byType("testimonial");
  const galleries = byType("gallery");
  const texts = byType("text");
  const ctas = byType("cta");
  const contacts = byType("contact");
  const faqs = byType("faq");

  const section = (fullBleed: boolean, children: LayoutNode["children"]): LayoutNode => ({
    type: "Section",
    fullBleed,
    children,
  });

  const used = new Set<string>();
  const mark = (ids: string[]) => ids.forEach((id) => used.add(id));
  const remaining = () => blocks.filter((b) => !used.has(b.id)).map((b) => b.id);

  if (pagePlan.slug === "home") {
    const children: LayoutNode["children"] = [];

    if (headlines[0]) {
      children.push(section(true, [headlines[0]!]));
      mark([headlines[0]!]);
    }

    if (stats.length > 0) {
      const statsLayout =
        stats.length <= 4
          ? { type: "Row" as const, children: stats }
          : { type: "Grid" as const, children: stats, minColumnWidth: 180 };
      children.push(section(false, [statsLayout]));
      mark(stats);
    }

    if (galleries.length > 0) {
      children.push(
        section(true, [
          { type: "Grid", children: galleries.slice(0, Math.min(4, galleries.length)), minColumnWidth: 280 },
        ])
      );
      mark(galleries.slice(0, Math.min(4, galleries.length)));
    }

    if (texts.length > 0) {
      children.push(section(false, texts.map((id) => id)));
      mark(texts);
    }

    if (features.length > 0) {
      children.push(section(false, [{ type: "Grid", children: features, minColumnWidth: 300 }]));
      mark(features);
    }

    const remainingGalleries = galleries.filter((id) => !used.has(id));
    if (remainingGalleries.length > 0) {
      children.push(section(false, [{ type: "Grid", children: remainingGalleries, minColumnWidth: 260 }]));
      mark(remainingGalleries);
    }

    if (images.length > 0) {
      children.push(section(false, images.map((id) => id)));
      mark(images);
    }

    if (testimonials.length > 0) {
      children.push(
        section(
          false,
          testimonials.length >= 3
            ? [{ type: "Grid", children: testimonials, minColumnWidth: 300 }]
            : testimonials
        )
      );
      mark(testimonials);
    }

    if (ctas[0]) {
      children.push(section(true, [ctas[0]!]));
      mark([ctas[0]!]);
    }

    for (const id of remaining()) children.push(id);
    return { type: "Stack", children };
  }

  const children: LayoutNode["children"] = [];

  if (headlines[0]) {
    children.push(section(pagePlan.slug === "home", [headlines[0]!]));
    mark([headlines[0]!]);
  }

  if (galleries.length > 0) {
    children.push(section(pagePlan.slug === "services", [{ type: "Grid", children: galleries, minColumnWidth: 260 }]));
    mark(galleries);
  }

  if (features.length > 0) {
    children.push(section(false, [{ type: "Grid", children: features, minColumnWidth: 280 }]));
    mark(features);
  }

  for (const id of texts) {
    children.push(section(false, [id]));
    mark([id]);
  }

  if (faqs.length > 0) {
    children.push(section(false, faqs));
    mark(faqs);
  }

  if (contacts.length > 0) {
    children.push(
      section(false, [
        contacts.length > 0 && images[0]
          ? { type: "Row", children: [contacts[0]!, images[0]!] }
          : contacts[0]!,
      ])
    );
    mark([...contacts, ...images.slice(0, 1)]);
  }

  if (testimonials.length > 0) {
    children.push(section(false, testimonials));
    mark(testimonials);
  }

  if (ctas[0]) {
    children.push(section(true, [ctas[0]!]));
    mark([ctas[0]!]);
  }

  for (const id of remaining()) children.push(id);
  return { type: "Stack", children };
}

export function validateLayoutTree(layout: unknown): LayoutNode {
  return LayoutNodeSchema.parse(layout);
}
