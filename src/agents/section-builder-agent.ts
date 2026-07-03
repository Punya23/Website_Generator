import { z } from "zod";
import type {
  ContentBlock,
  ExpandedBrief,
  LayoutNode,
  PagePlan,
  PageSection,
  SectionPlan,
  SiteContext,
  SitePlan,
} from "../types.js";
import { LayoutNodeSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { briefToContext } from "./expand-brief-agent.js";
import { normalizeLayoutNode } from "./layout-normalize.js";
import { collectIds, sanitizeLayoutNode } from "./layout-normalize.js";
import { enrichSectionImages } from "../media/enrich-content.js";
import { MediaRegistry } from "../media/media-registry.js";
import { ensurePageSections } from "../site-context/assemble.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import {
  ARCHETYPE_BLOCK_TYPES,
  buildArchetypeLayout,
  isSectionArchetype,
} from "../components/archetypes.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { normalizeContentBlocks } from "./content-normalize.js";

const SECTION_CONTENT_PROMPT = `You are an expert copywriter. Generate content blocks for ONE section of a page.
No layout fields. No src URLs. imageQuery required on image/gallery blocks.

Output JSON: { "blocks": [ { "id", "type", ...fields } ] }

Use ONLY these block types — never invent new type names:
headline, stat, testimonial, cta, text, feature, gallery, image, contact, faq, pricing, logo, bento, list, form.

Field names (use exactly):
- cta: { headline, subtext?, buttonText, buttonUrl? }
- testimonial: { quote, author, role? }
- text: { title?, text }
- list: { title?, items: string[] }
- form: { title?, fields: [{ label, type: "text"|"email"|"tel"|"select"|"textarea"|"datetime-local", required?, options? }], submitLabel? }
- pricing: { title, price, period?, description?, features[], buttonText?, highlighted? }
- logo: { name, imageQuery? }
- bento: { title, description?, imageQuery?, span: "normal"|"wide"|"tall"|"large" }

IDs must be unique and prefixed with the section id.`;

const SECTION_LAYOUT_PROMPT = `You are a layout architect for ONE page section.

Output JSON: { "reasoning": "...", "layout": { "type": "Section", "fullBleed"?: boolean, "children": [...] } }

Primitives: Section, Stack, Row, Grid, Bento, block id strings.
Every block id appears exactly once. Set "columns" on Row/Grid/Bento when alignment matters.
Think: uniform card grids, heroes may bleed, bento uses span on blocks.`;

function tagSectionLayout(layout: LayoutNode, sectionId: string): LayoutNode {
  if (layout.type === "Section") return { ...layout, id: sectionId };
  return { type: "Section", id: sectionId, fullBleed: false, children: [layout] };
}

export async function buildPageSections(
  ctx: SiteContext,
  pagePlan: PagePlan,
  registry: MediaRegistry
): Promise<PageSection[]> {
  const sectionPlans = ensurePageSections(pagePlan.slug, pagePlan.layoutHint, pagePlan.sections);
  const built: PageSection[] = [];
  const priorSummary = () =>
    built.map((s) => `${s.id}: ${s.blocks.map((b) => b.type).join(",")}`).join("; ") || "none";

  for (const plan of sectionPlans) {
    pipelineLog(`[pipeline] ${pagePlan.slug}/${plan.id}: content…`);
    const blocks = await generateSectionContent(ctx, pagePlan, plan, priorSummary());
    pipelineLog(`[pipeline] ${pagePlan.slug}/${plan.id}: layout…`);
    const layout = await generateSectionLayout(ctx, pagePlan, plan, blocks, priorSummary());
    const enriched = await enrichSectionImages(
      blocks,
      pagePlan.slug,
      ctx.businessName,
      ctx.expandedBrief.expandedBrief,
      ctx.designSystem,
      registry,
      plan.id
    );
    built.push({
      id: plan.id,
      intent: plan.intent,
      archetype: plan.archetype,
      blocks: enriched,
      layout: tagSectionLayout(layout, plan.id),
    });
  }

  return built;
}

async function generateSectionContent(
  ctx: SiteContext,
  pagePlan: PagePlan,
  section: SectionPlan,
  priorSections: string
): Promise<ContentBlock[]> {
  requireLlm("section content");

  if (llm.isAvailable) {
    const raw = await llm.chat(
      SECTION_CONTENT_PROMPT,
      `${briefToContext(ctx.expandedBrief)}

PAGE: ${pagePlan.slug} — ${pagePlan.title}
SECTION: ${section.id}
INTENT: ${section.intent}
${section.archetype ? `ARCHETYPE: ${section.archetype} (use block types: ${ARCHETYPE_BLOCK_TYPES[section.archetype].join(", ")})` : ""}
BLOCK TYPES: ${section.blockTypes.join(", ")}
PRIOR SECTIONS ON PAGE: ${priorSections}
DESIGN MOOD: ${ctx.designSystem.mood}

Generate 2-8 blocks for this section only. IDs must start with "${section.id}_".`,
      {
        jsonMode: true,
        temperature: 0.8,
        tokenRole: "section",
        model: llm.getSectionModel(),
      }
    );
    const parsed = JSON.parse(raw) as { blocks: ContentBlock[] };
    return normalizeContentBlocks(parsed.blocks, section.id);
  }

  if (!allowMocks()) throw new Error("Section content requires LLM");
  return mockSectionContent(ctx.expandedBrief, pagePlan, section);
}

async function generateSectionLayout(
  ctx: SiteContext,
  pagePlan: PagePlan,
  section: SectionPlan,
  blocks: ContentBlock[],
  priorSections: string
): Promise<LayoutNode> {
  requireLlm("section layout");
  const blockIds = blocks.map((b) => b.id);

  if (llm.isAvailable) {
    const raw = await llm.chat(
      SECTION_LAYOUT_PROMPT,
      `BUSINESS: ${ctx.businessName}
PAGE: ${pagePlan.slug}
SECTION: ${section.id} — ${section.intent}
PRIOR SECTIONS: ${priorSections}
GRID COLUMNS (default): ${ctx.designSystem.layout?.gridColumns ?? 3}
AVOID: ${ctx.sitePlan.avoidPatterns.join("; ")}

BLOCK IDS: ${blockIds.join(", ")}
BLOCKS: ${JSON.stringify(blocks.map((b) => ({ id: b.id, type: b.type })))}`,
      {
        jsonMode: true,
        temperature: 0.35,
        tokenRole: "composition",
        model: llm.getCompositionModel(),
      }
    );
    return parseSectionLayout(raw, blocks, section);
  }

  if (!allowMocks()) throw new Error("Section layout requires LLM");
  return section.archetype && isSectionArchetype(section.archetype)
    ? buildArchetypeLayout(section.archetype, blocks, section.id.includes("hero"))
    : mockSectionLayout(blocks, section);
}

export async function regenerateSection(
  ctx: SiteContext,
  pagePlan: PagePlan,
  sectionId: string,
  registry: MediaRegistry
): Promise<PageSection> {
  const plan = ensurePageSections(pagePlan.slug, pagePlan.layoutHint, pagePlan.sections).find(
    (s) => s.id === sectionId
  );
  if (!plan) throw new Error(`Section not found: ${sectionId}`);

  const prior = ctx.pages[pagePlan.slug]?.sections ?? [];
  const priorSummary =
    prior.filter((s) => s.id !== sectionId).map((s) => `${s.id}: ${s.blocks.map((b) => b.type).join(",")}`).join("; ") ||
    "none";

  pipelineLog(`[editor] Regenerating ${pagePlan.slug}/${sectionId}…`);
  const blocks = await generateSectionContent(ctx, pagePlan, plan, priorSummary);
  const layout = await generateSectionLayout(ctx, pagePlan, plan, blocks, priorSummary);
  const enriched = await enrichSectionImages(
    blocks,
    pagePlan.slug,
    ctx.businessName,
    ctx.expandedBrief.expandedBrief,
    ctx.designSystem,
    registry,
    plan.id
  );

  return {
    id: plan.id,
    intent: plan.intent,
    archetype: plan.archetype,
    blocks: enriched,
    layout: tagSectionLayout(layout, plan.id),
  };
}

function parseSectionLayout(raw: string, blocks: ContentBlock[], section: SectionPlan): LayoutNode {
  const blockIds = blocks.map((b) => b.id);
  const parsed = JSON.parse(raw) as { layout?: unknown };
  const layoutRaw = parsed.layout ?? parsed;
  const normalized = normalizeLayoutNode(layoutRaw, blockIds);
  if (!normalized) throw new Error("Could not normalize section layout");

  const used = collectIds(normalized);
  const missing = blockIds.filter((id) => !used.includes(id));
  if (missing.length > 0) {
    if (section.archetype && isSectionArchetype(section.archetype)) {
      return buildArchetypeLayout(
        section.archetype,
        blocks,
        section.id.includes("hero")
      );
    }
    throw new Error(`Section layout missing blocks: ${missing.join(", ")}`);
  }

  const sanitized = sanitizeLayoutNode(normalized);
  try {
    return LayoutNodeSchema.parse(sanitized);
  } catch (err) {
    if (err instanceof z.ZodError && section.archetype && isSectionArchetype(section.archetype)) {
      return buildArchetypeLayout(
        section.archetype,
        blocks,
        section.id.includes("hero")
      );
    }
    if (err instanceof z.ZodError) {
      throw new Error(`Section layout schema invalid: ${err.issues[0]?.message ?? "unknown"}`);
    }
    throw err;
  }
}

function mockSectionContent(
  brief: ExpandedBrief,
  pagePlan: PagePlan,
  section: SectionPlan
): ContentBlock[] {
  const p = section.id;
  const blocks: ContentBlock[] = [];

  if (section.blockTypes.includes("headline")) {
    blocks.push({
      id: `${p}_headline`,
      type: "headline",
      text: pagePlan.slug === "home" ? brief.businessName : pagePlan.title,
      subtext: brief.tagline,
    });
  }
  if (section.blockTypes.includes("feature")) {
    brief.services.slice(0, 3).forEach((svc, i) => {
      blocks.push({
        id: `${p}_feature_${i}`,
        type: "feature",
        title: svc,
        description: `${svc} — delivered with ${brief.tone} care.`,
      });
    });
  }
  if (section.blockTypes.includes("stat")) {
    ["500+", "98%", "24/7"].forEach((v, i) => {
      blocks.push({
        id: `${p}_stat_${i}`,
        type: "stat",
        value: v,
        label: ["Clients served", "Satisfaction", "Support"][i]!,
      });
    });
  }
  if (section.blockTypes.includes("testimonial")) {
    blocks.push({
      id: `${p}_testimonial_0`,
      type: "testimonial",
      quote: brief.elevatorPitch,
      author: "A happy client",
    });
  }
  if (section.blockTypes.includes("cta")) {
    blocks.push({
      id: `${p}_cta`,
      type: "cta",
      headline: brief.primaryCta,
      subtext: brief.secondaryCta,
      buttonText: brief.primaryCta,
    });
  }
  if (section.blockTypes.includes("text")) {
    blocks.push({
      id: `${p}_text`,
      type: "text",
      title: "Our story",
      text: brief.expandedBrief,
    });
  }
  if (section.blockTypes.includes("gallery")) {
    blocks.push({
      id: `${p}_gallery_0`,
      type: "gallery",
      caption: brief.businessName,
      imageQuery: `${brief.businessName} ${brief.services[0] ?? "service"}`,
    });
  }
  if (section.blockTypes.includes("contact")) {
    blocks.push({
      id: `${p}_contact`,
      type: "contact",
      title: "Contact us",
      email: "hello@example.com",
    });
  }

  return blocks.length > 0 ? blocks : [{ id: `${p}_text`, type: "text", text: brief.expandedBrief }];
}

function mockSectionLayout(blocks: ContentBlock[], section: SectionPlan): LayoutNode {
  const ids = blocks.map((b) => b.id);
  const features = blocks.filter((b) => b.type === "feature").map((b) => b.id);
  const stats = blocks.filter((b) => b.type === "stat").map((b) => b.id);
  const headline = blocks.find((b) => b.type === "headline")?.id;

  if (headline && ids.length === 1) {
    return { type: "Section", fullBleed: true, children: [headline] };
  }
  if (stats.length >= 2) {
    return {
      type: "Section",
      fullBleed: false,
      children: [{ type: "Row", children: stats, columns: stats.length }],
    };
  }
  if (features.length >= 2) {
    return {
      type: "Section",
      fullBleed: false,
      children: [{ type: "Grid", children: features, columns: 3 }],
    };
  }
  return { type: "Section", fullBleed: false, children: ids };
}
