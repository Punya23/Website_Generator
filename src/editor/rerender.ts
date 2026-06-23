import type { GenerationResult, SiteContext, SiteTheme } from "../types.js";
import { assemblePageFromSections } from "../site-context/assemble.js";
import { renderSite } from "../renderer/render.js";
import { renderCmsPages } from "../cms/render.js";
import { getPagePlan } from "../agents/site-planner-agent.js";

export function rerenderFromContext(ctx: SiteContext): Record<string, string> {
  const pages = Object.values(ctx.pages).map((page) => {
    const { content, layout } = assemblePageFromSections(page.sections);
    return {
      slug: page.slug,
      title: page.title,
      navLabel: page.navLabel,
      content,
      layout,
    };
  });

  const cmsNav = (ctx.cmsCollections ?? []).map((c) => ({
    slug: c.slug,
    label: c.name,
  }));

  const navPages = [...pages, ...cmsNav.map((n) => ({ ...n, title: n.label, content: [], layout: { type: "Stack" as const, children: [] } }))];

  const html = renderSite(
    ctx.businessName,
    ctx.expandedBrief.expandedBrief,
    ctx.designSystem,
    pages,
    ctx.sitePlan.motionStyle
  );

  if (ctx.cmsCollections?.length) {
    const cmsHtml = renderCmsPages(
      ctx.cmsCollections,
      ctx.businessName,
      ctx.expandedBrief.expandedBrief,
      ctx.designSystem,
      pages.map((p) => ({ slug: p.slug, label: p.navLabel ?? p.title })).concat(cmsNav),
      ctx.sitePlan.motionStyle
    );
    Object.assign(html, cmsHtml);
  }

  return html;
}

export function applyThemePatch(ctx: SiteContext, patch: Partial<SiteTheme>): SiteContext {
  ctx.designSystem = {
    ...ctx.designSystem,
    ...patch,
    colors: { ...ctx.designSystem.colors, ...(patch.colors ?? {}) },
    layout: patch.layout
      ? { ...ctx.designSystem.layout, ...patch.layout }
      : ctx.designSystem.layout,
  };
  return ctx;
}

export function reorderSections(
  ctx: SiteContext,
  pageSlug: string,
  sectionIds: string[]
): SiteContext {
  const page = ctx.pages[pageSlug];
  if (!page) throw new Error(`Page not found: ${pageSlug}`);

  const map = new Map(page.sections.map((s) => [s.id, s]));
  page.sections = sectionIds.map((id) => {
    const section = map.get(id);
    if (!section) throw new Error(`Section not found: ${id}`);
    return section;
  });
  return ctx;
}

export function buildGenerationPreview(result: Partial<GenerationResult>): {
  ctx: SiteContext;
  htmlPages: Record<string, string>;
} {
  const ctx = result.siteContext!;
  const htmlPages = result.htmlPages ?? rerenderFromContext(ctx);
  return { ctx, htmlPages };
}
