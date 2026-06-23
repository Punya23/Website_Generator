import type { ContentBlock, LayoutChild, LayoutNode, SiteTheme } from "../types.js";
import { renderContentBlock } from "./blocks.js";
import { buildStyles } from "./styles.js";
import { buildThemeTokens } from "../theme/contrast.js";
import { resolveMotionPreset, buildMotionScript } from "../motion/presets.js";

export function buildContentMap(blocks: ContentBlock[]): Map<string, ContentBlock> {
  return new Map(blocks.map((b) => [b.id, b]));
}

export function renderLayoutNode(
  node: LayoutNode,
  contentMap: Map<string, ContentBlock>,
  defaultColumns: number
): string {
  const childrenHtml = node.children
    .map((child) => renderLayoutChild(child, contentMap, defaultColumns))
    .join("\n");

  switch (node.type) {
    case "Stack":
      return `<div class="layout-stack" data-layout="Stack">\n${childrenHtml}\n</div>`;
    case "Row": {
      const cols = node.columns ?? defaultColumns;
      return `<div class="layout-row" data-cols="${cols}" data-layout="Row" style="--grid-columns: ${cols}">\n${childrenHtml}\n</div>`;
    }
    case "Grid": {
      const cols = node.columns ?? defaultColumns;
      const min = node.minColumnWidth ?? 260;
      return `<div class="layout-grid" data-cols="${cols}" data-layout="Grid" style="--grid-columns: ${cols}; --grid-min: ${min}px">\n${childrenHtml}\n</div>`;
    }
    case "Bento": {
      const cols = node.columns ?? 4;
      return `<div class="layout-bento" data-cols="${cols}" data-layout="Bento" style="--bento-columns: ${cols}">\n${childrenHtml}\n</div>`;
    }
    case "Section": {
      const bleed = node.fullBleed ? "layout-section layout-section--bleed" : "layout-section layout-section--contained";
      const sectionId = node.id ? ` data-section-id="${escapeAttr(node.id)}"` : "";
      return `<div class="${bleed}" data-layout="Section"${sectionId}>\n${childrenHtml}\n</div>`;
    }
  }
}

function renderLayoutChild(
  child: LayoutChild,
  contentMap: Map<string, ContentBlock>,
  defaultColumns: number
): string {
  if (typeof child === "string") {
    const block = contentMap.get(child);
    if (!block) {
      return `<div class="block reveal" data-block-id="${child}"><p>Missing block: ${child}</p></div>`;
    }
    return renderContentBlock(block);
  }
  return renderLayoutNode(child, contentMap, defaultColumns);
}

export interface RenderPageOptions {
  title: string;
  slug: string;
  businessName: string;
  businessBrief: string;
  theme: SiteTheme;
  navLinks: Array<{ slug: string; label: string }>;
  motionStyle?: string;
  content: ContentBlock[];
  layout: LayoutNode;
}

export function renderPage(options: RenderPageOptions): string {
  const contentMap = buildContentMap(options.content);
  const tokens = buildThemeTokens(options.theme);
  const body = renderLayoutNode(options.layout, contentMap, tokens.gridColumns);
  const styles = buildStyles(options.theme);
  const year = new Date().getFullYear();
  const motionPreset = resolveMotionPreset(
    options.theme.motionPreset,
    options.motionStyle ?? options.theme.motionStyle
  );

  const nav = options.navLinks
    .map(
      (link) =>
        `<a href="${link.slug}.html"${link.slug === options.slug ? ' class="active"' : ""}>${escapeAttr(link.label)}</a>`
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
<body data-vertical="${escapeAttr(options.theme.vertical)}" data-motion-preset="${escapeAttr(motionPreset)}">
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
  ${buildMotionScript(motionPreset)}
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
    navLabel?: string;
    content: ContentBlock[];
    layout: LayoutNode;
  }>,
  motionStyle?: string
): Record<string, string> {
  const navLinks = pages.map((p) => ({
    slug: p.slug,
    label: p.navLabel ?? p.title,
  }));

  const resolvedMotion = motionStyle ?? theme.motionStyle ?? "subtle";

  const result: Record<string, string> = {};
  for (const page of pages) {
    result[page.slug] = renderPage({
      title: page.title,
      slug: page.slug,
      businessName,
      businessBrief,
      theme,
      navLinks,
      motionStyle: resolvedMotion,
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
