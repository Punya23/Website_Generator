import type { GenerationResult, SiteContext, SiteTheme } from "../types.js";
import { assemblePageFromSections } from "../site-context/assemble.js";
import { renderSite } from "../renderer/render.js";
import { renderCmsPages } from "../cms/render.js";
import { getSkin } from "../skins/catalog.js";
import { renderSkinHtmlSite } from "../skins/render-html-site.js";

export function rerenderFromContext(ctx: SiteContext): Record<string, string> {
  if (ctx.skinId && ctx.reactPages && Object.keys(ctx.reactPages).length > 0) {
    const skin = getSkin(ctx.skinId);
    if (skin) {
      const instances: Record<string, typeof ctx.reactPages[string]["sections"]> = {};
      for (const [slug, page] of Object.entries(ctx.reactPages)) {
        instances[slug] = page.sections;
      }
      return renderSkinHtmlSite(ctx, skin, instances);
    }
  }

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
  const reactPage = ctx.reactPages?.[pageSlug];
  if (reactPage) {
    const map = new Map(reactPage.sections.map((s) => [s.id, s]));
    reactPage.sections = sectionIds.map((id) => {
      const section = map.get(id);
      if (!section) throw new Error(`Section not found: ${id}`);
      return section;
    });
  }

  const page = ctx.pages[pageSlug];
  if (page) {
    const map = new Map(page.sections.map((s) => [s.id, s]));
    page.sections = sectionIds.map((id) => {
      const section = map.get(id);
      if (!section) throw new Error(`Section not found: ${id}`);
      return section;
    });
  }

  if (!reactPage && !page) throw new Error(`Page not found: ${pageSlug}`);
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
