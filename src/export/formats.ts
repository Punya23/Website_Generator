import type { SiteContext } from "../types.js";
import { assemblePageFromSections } from "../site-context/assemble.js";

export function exportProjectJson(ctx: SiteContext): string {
  return JSON.stringify(ctx, null, 2);
}

export function exportWebflowJson(ctx: SiteContext): string {
  const pages = ctx.reactPages
    ? Object.values(ctx.reactPages).map((page) => ({
        slug: page.slug,
        title: page.title,
        sections: page.sections.map((s) => ({
          id: s.id,
          templateId: s.templateId,
          intent: s.intent,
          props: s.props,
        })),
      }))
    : Object.values(ctx.pages).map((page) => {
        const { content, layout } = assemblePageFromSections(page.sections);
        return {
          slug: page.slug,
          title: page.title,
          sections: page.sections,
          content,
          layout,
        };
      });

  return JSON.stringify(
    {
      version: "2.0",
      platform: "website-generator",
      businessName: ctx.businessName,
      designSystem: ctx.designSystem,
      pages,
      cmsCollections: ctx.cmsCollections ?? [],
      mediaRegistry: ctx.mediaRegistry,
    },
    null,
    2
  );
}

/** Returns a summary of the React project (full project is written by codegen to disk). */
export function exportReactProject(ctx: SiteContext): string {
  if (ctx.reactPages) {
    return JSON.stringify(
      {
        mode: "react",
        businessName: ctx.businessName,
        pages: Object.values(ctx.reactPages).map((p) => ({
          slug: p.slug,
          title: p.title,
          sectionCount: p.sections.length,
          templates: p.sections.map((s) => s.templateId),
        })),
      },
      null,
      2
    );
  }

  const pages = Object.values(ctx.pages);
  return JSON.stringify(
    {
      mode: "html-legacy",
      message: "Regenerate with OUTPUT_MODE=react for full Next.js project",
      pages: pages.map((p) => p.slug),
    },
    null,
    2
  );
}
