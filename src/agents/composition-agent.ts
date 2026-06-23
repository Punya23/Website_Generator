import { z } from "zod";
import type { ContentBlock, ExpandedBrief, LayoutNode, PagePlan, SitePlan } from "../types.js";
import { LayoutNodeSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { detectVertical } from "./theme-agent.js";
import {
  collectIds,
  normalizeLayoutNode,
  repairLayoutCoverage,
} from "./layout-normalize.js";

const COMPOSITION_SYSTEM = `You are a senior layout architect. Design a UNIQUE page structure for this specific business.

STEP 1 — Think in "reasoning" (2-4 sentences): What layout personality fits this business and page?

STEP 2 — Output layout tree using ONLY these primitives:
- Section: { "type": "Section", "fullBleed"?: boolean, "children": [...] }
- Stack: { "type": "Stack", "children": [...] }
- Row: { "type": "Row", "children": [...] }
- Grid: { "type": "Grid", "children": [...], "minColumnWidth"?: number }

CRITICAL — children are ONLY:
1) block id STRINGS (e.g. "home_headline", "home_feature_0") — NEVER embed block objects
2) nested layout nodes with type Stack|Row|Grid|Section

CORRECT example:
{
  "reasoning": "Salon home needs full-bleed hero then visual gallery grid.",
  "layout": {
    "type": "Stack",
    "children": [
      { "type": "Section", "fullBleed": true, "children": ["home_headline"] },
      { "type": "Grid", "children": ["home_gallery_0", "home_gallery_1"], "minColumnWidth": 280 },
      { "type": "Section", "fullBleed": true, "children": ["home_cta"] }
    ]
  }
}

WRONG — never do this:
{ "children": [{ "id": "home_headline", "type": "headline", "title": "..." }] }

RULES:
- Every block id appears EXACTLY once
- Heroes/CTAs in fullBleed Section
- NO absolute positioning, NO CSS, NO pixel values

LAYOUT PATTERNS (pick what fits the archetype):
- editorial-magazine: fullBleed hero → contained text stack → 3-col gallery Grid (min 300) → testimonial Stack
- trust-dashboard: fullBleed hero → stats Row (4 across) → 2-col feature Grid → text Stack
- energy-bento: fullBleed hero → stats Row → asymmetric gallery Grid (min 280) + features Grid (min 340) → CTA fullBleed
- Pair text+image in Row ONLY on about/contact — NEVER hero+image in same Row on home
- Gallery/image blocks belong in Grid with minColumnWidth 280-360
- Stats: Row with 3-4 items OR Grid minColumnWidth 180
- Testimonials: Grid min 300 if 3+, else Stack
- FAQ blocks: Stack inside contained Section

Output JSON with "reasoning" and "layout" keys only.`;

export async function composeLayout(
  blocks: ContentBlock[],
  pagePlan: PagePlan,
  brief: ExpandedBrief,
  sitePlan: SitePlan
): Promise<LayoutNode> {
  const blockIds = blocks.map((b) => b.id);
  const blockSummary = blocks.map((b) => ({
    id: b.id,
    type: b.type,
    preview: String(b.title ?? b.text ?? b.headline ?? b.caption ?? "").slice(0, 60),
  }));

  if (llm.isAvailable) {
    try {
      const layout = await requestLayoutFromLlm(
        blocks,
        pagePlan,
        brief,
        sitePlan,
        blockSummary,
        blockIds
      );
      return layout;
    } catch (err) {
      console.warn(
        `[composition] LLM layout failed for ${pagePlan.slug}, using deterministic fallback:`,
        err instanceof Error ? err.message : err
      );
    }
  }

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
VERTICAL STRATEGY: ${sitePlan.compositionStrategy}
VISUAL ARCHETYPE: ${sitePlan.visualArchetype ?? "balanced"}
MOTION STYLE: ${sitePlan.motionStyle ?? "staggered reveals"}
AVOID: ${sitePlan.avoidPatterns.join("; ")}

PAGE: ${pagePlan.slug} — ${pagePlan.title}
Goal: ${pagePlan.goal}
Layout hint: ${pagePlan.layoutHint}

BLOCK IDS (use these strings exactly in children):
${blockIds.join(", ")}

BLOCKS (${blocks.length}):
${JSON.stringify(blockSummary, null, 2)}

Design a production-grade layout like a Framer template — varied rhythm, no uniform card rows.
children must be block id strings or nested Stack/Row/Grid/Section nodes — never block objects.`;

  const raw = await llm.chat(COMPOSITION_SYSTEM, userPrompt, {
    jsonMode: true,
    temperature: 0.35,
    maxTokens: 2048,
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
    validated = LayoutNodeSchema.parse(normalized);
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
  brief: ExpandedBrief,
  sitePlan: SitePlan
): LayoutNode {
  const v = detectVertical(brief.expandedBrief);
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

    if (v === "finserv" && stats.length > 0) {
      children.push(section(false, [{ type: "Row", children: stats }]));
      mark(stats);
    } else if (v === "fitness" && stats.length > 0) {
      children.push(section(false, [{ type: "Row", children: stats }]));
      mark(stats);
    } else if (v === "salon" && galleries.length > 0) {
      children.push(section(true, [{ type: "Grid", children: galleries.slice(0, 3), minColumnWidth: 300 }]));
      mark(galleries.slice(0, 3));
    } else if (v === "fitness" && galleries.length > 0) {
      children.push(section(true, [{ type: "Grid", children: galleries.slice(0, 4), minColumnWidth: 280 }]));
      mark(galleries.slice(0, 4));
    }

    if (stats.length > 0 && v !== "finserv" && v !== "fitness") {
      children.push(section(false, [{ type: "Grid", children: stats, minColumnWidth: 180 }]));
      mark(stats);
    }

    if (texts.length > 0) {
      children.push(section(false, texts.map((id) => id)));
      mark(texts);
    }

    if (features.length > 0) {
      const layout =
        v === "salon"
          ? { type: "Grid" as const, children: features, minColumnWidth: 280 }
          : v === "fitness"
            ? { type: "Grid" as const, children: features, minColumnWidth: 340 }
            : { type: "Grid" as const, children: features, minColumnWidth: 320 };
      children.push(section(false, [layout]));
      mark(features);
    }

    if (galleries.length > 0 && v !== "salon" && v !== "fitness") {
      children.push(section(true, [{ type: "Grid", children: galleries, minColumnWidth: 260 }]));
      mark(galleries);
    }

    if (images.length > 0) {
      children.push(section(v === "salon", images.map((id) => id)));
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

    void sitePlan;
    return { type: "Stack", children };
  }

  const children: LayoutNode["children"] = [];

  if (headlines[0]) {
    children.push(section(false, [headlines[0]!]));
    mark([headlines[0]!]);
  }

  if (pagePlan.slug === "services" && galleries.length > 0) {
    children.push(section(true, [{ type: "Grid", children: galleries, minColumnWidth: 250 }]));
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
