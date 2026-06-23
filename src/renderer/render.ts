import type { ContentBlock, LayoutChild, LayoutNode, SiteTheme } from "../types.js";
import { renderContentBlock } from "./blocks.js";
import { buildStyles } from "./styles.js";
import { PAGE_SCRIPTS } from "./scripts.js";

export function buildContentMap(blocks: ContentBlock[]): Map<string, ContentBlock> {
  return new Map(blocks.map((b) => [b.id, b]));
}

export function renderLayoutNode(
  node: LayoutNode,
  contentMap: Map<string, ContentBlock>
): string {
  const childrenHtml = node.children
    .map((child) => renderLayoutChild(child, contentMap))
    .join("\n");

  switch (node.type) {
    case "Stack":
      return `<div class="layout-stack" data-layout="Stack">\n${childrenHtml}\n</div>`;
    case "Row":
      return `<div class="layout-row" data-layout="Row">\n${childrenHtml}\n</div>`;
    case "Grid": {
      const min = node.minColumnWidth ?? 260;
      return `<div class="layout-grid" data-layout="Grid" style="--grid-min: ${min}px">\n${childrenHtml}\n</div>`;
    }
    case "Section": {
      const bleed = node.fullBleed ? "layout-section layout-section--bleed" : "layout-section layout-section--contained";
      return `<div class="${bleed}" data-layout="Section">\n${childrenHtml}\n</div>`;
    }
  }
}

function renderLayoutChild(
  child: LayoutChild,
  contentMap: Map<string, ContentBlock>
): string {
  if (typeof child === "string") {
    const block = contentMap.get(child);
    if (!block) {
      return `<div class="block reveal" data-block-id="${child}"><p>Missing block: ${child}</p></div>`;
    }
    return renderContentBlock(block);
  }
  return renderLayoutNode(child, contentMap);
}

export interface RenderPageOptions {
  title: string;
  slug: string;
  businessName: string;
  businessBrief: string;
  theme: SiteTheme;
  navLinks: Array<{ slug: string; label: string }>;
  visualArchetype?: string;
  content: ContentBlock[];
  layout: LayoutNode;
}

function inferArchetype(vertical: string): string {
  const map: Record<string, string> = {
    salon: "editorial-magazine",
    finserv: "trust-dashboard",
    fitness: "energy-bento",
    restaurant: "warm-storytelling",
  };
  return map[vertical] ?? "warm-storytelling";
}

export function renderPage(options: RenderPageOptions): string {
  const contentMap = buildContentMap(options.content);
  const body = renderLayoutNode(options.layout, contentMap);
  const styles = buildStyles(options.theme);
  const year = new Date().getFullYear();
  const archetype = options.visualArchetype ?? inferArchetype(options.theme.vertical);

  const nav = options.navLinks
    .map(
      (link) =>
        `<a href="${link.slug}.html"${link.slug === options.slug ? ' class="active"' : ""}>${link.label}</a>`
    )
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${escapeAttr(options.businessBrief.slice(0, 160))}" />
  <title>${escapeAttr(options.title)} — ${escapeAttr(options.businessName)}</title>
  <style>${styles}</style>
</head>
<body data-vertical="${escapeAttr(options.theme.vertical)}" data-archetype="${escapeAttr(archetype)}" data-motion="${options.theme.vertical === "fitness" ? "bold" : "subtle"}">
  <nav class="site-nav">
    <span class="brand">${escapeAttr(options.businessName)}</span>
    ${nav}
  </nav>
  <main class="site-main">
    ${body}
  </main>
  <footer class="site-footer">
    © ${year} ${escapeAttr(options.businessName)} · ${escapeAttr(options.theme.mood)}
  </footer>
  ${PAGE_SCRIPTS}
</body>
</html>`;
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderSite(
  businessName: string,
  businessBrief: string,
  theme: SiteTheme,
  pages: Array<{
    slug: string;
    title: string;
    content: ContentBlock[];
    layout: LayoutNode;
  }>,
  visualArchetype?: string
): Record<string, string> {
  const navLinks = pages.map((p) => ({
    slug: p.slug,
    label: p.title,
  }));

  const result: Record<string, string> = {};
  for (const page of pages) {
    result[page.slug] = renderPage({
      title: page.title,
      slug: page.slug,
      businessName,
      businessBrief,
      theme,
      navLinks,
      visualArchetype,
      content: page.content,
      layout: page.layout,
    });
  }
  return result;
}

export function collectLayoutBlockIds(node: LayoutNode): string[] {
  const ids: string[] = [];
  for (const child of node.children) {
    if (typeof child === "string") {
      ids.push(child);
    } else {
      ids.push(...collectLayoutBlockIds(child));
    }
  }
  return ids;
}
