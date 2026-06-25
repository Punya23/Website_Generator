import type { ContentBlock, LayoutNode, PageSection, SectionPlan, SiteContext } from "../types.js";
import { normalizeContentBlocks } from "../agents/content-normalize.js";

export function ensurePageSections(
  pageSlug: string,
  layoutHint: string,
  sections?: SectionPlan[]
): SectionPlan[] {
  if (sections && sections.length > 0) return sections;
  return [
    { id: `${pageSlug}_hero`, intent: "Opening hero or headline", blockTypes: ["headline"], archetype: "split_hero" },
    { id: `${pageSlug}_body`, intent: layoutHint, blockTypes: ["text", "feature", "stat", "gallery", "image"], archetype: "feature_grid" },
    { id: `${pageSlug}_proof`, intent: "Social proof and testimonials", blockTypes: ["testimonial", "stat"], archetype: "testimonial_band" },
    { id: `${pageSlug}_close`, intent: "Call to action", blockTypes: ["cta", "contact", "faq"], archetype: "cta_band" },
  ];
}

export function assemblePageFromSections(sections: PageSection[]): {
  content: ContentBlock[];
  layout: LayoutNode;
} {
  const content: ContentBlock[] = [];
  for (const section of sections) {
    content.push(...normalizeContentBlocks(section.blocks, section.id));
  }

  const layout: LayoutNode = {
    type: "Stack",
    children: sections.map((s) => s.layout),
  };

  return { content, layout };
}

export function initSiteContext(
  businessBrief: string,
  expanded: SiteContext["expandedBrief"],
  sitePlan: SiteContext["sitePlan"],
  designSystem: SiteContext["designSystem"]
): SiteContext {
  return {
    businessName: expanded.businessName,
    businessBrief,
    expandedBrief: expanded,
    sitePlan,
    designSystem,
    pages: {},
    mediaRegistry: [],
    cmsCollections: [],
    qaHistory: [],
  };
}

export function recordQaIteration(
  ctx: SiteContext,
  pageSlug: string,
  iteration: number,
  issues: SiteContext["qaHistory"][0]["issues"]
): void {
  ctx.qaHistory.push({ pageSlug, iteration, issues });
}

export function serializeContextForFix(ctx: SiteContext, pageSlug: string): string {
  const page = ctx.pages[pageSlug];
  return JSON.stringify(
    {
      businessName: ctx.businessName,
      designSystem: ctx.designSystem,
      compositionStrategy: ctx.sitePlan.compositionStrategy,
      page: page ?? null,
      mediaUrls: ctx.mediaRegistry.map((m) => m.url),
    },
    null,
    2
  );
}
