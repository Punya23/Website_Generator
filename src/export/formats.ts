import type { SiteContext } from "../types.js";
import { assemblePageFromSections } from "../site-context/assemble.js";

export function exportProjectJson(ctx: SiteContext): string {
  return JSON.stringify(ctx, null, 2);
}

export function exportWebflowJson(ctx: SiteContext): string {
  const pages = Object.values(ctx.pages).map((page) => {
    const { content, layout } = assemblePageFromSections(page.sections);
    return {
      slug: page.slug,
      title: page.title,
      sections: page.sections.map((s) => ({
        id: s.id,
        intent: s.intent,
        archetype: s.archetype,
        blocks: s.blocks,
        layout: s.layout,
      })),
      content,
      layout,
    };
  });

  return JSON.stringify(
    {
      version: "1.0",
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

export function exportReactProject(ctx: SiteContext): string {
  const pages = Object.values(ctx.pages);
  const componentNames = pages.map((p) => p.slug.replace(/[^a-z0-9]/gi, "_"));

  const imports = `import type { SiteTheme } from "./types";\n\nexport const theme: SiteTheme = ${JSON.stringify(ctx.designSystem, null, 2)};\n`;

  const pageComponents = pages
    .map((page, i) => {
      const name = componentNames[i]!;
      const sections = page.sections
        .map(
          (s) => `    <section key="${s.id}" data-section="${s.id}"${s.archetype ? ` data-archetype="${s.archetype}"` : ""}>
      {/* ${s.intent} — ${s.blocks.length} blocks */}
    </section>`
        )
        .join("\n");
      return `export function ${capitalize(name)}Page() {
  return (
    <main className="page-${page.slug}">
${sections}
    </main>
  );
}`;
    })
    .join("\n\n");

  const routes = pages
    .map((p, i) => `  { path: "/${p.slug}", element: <${capitalize(componentNames[i]!)}Page /> },`)
    .join("\n");

  return `${imports}
${pageComponents}

export const routes = [
${routes}
];
`;
}

function capitalize(slug: string): string {
  return slug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}
