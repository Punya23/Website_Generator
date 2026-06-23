import type { CmsCollection, CmsItem, SiteTheme } from "../types.js";
import { renderPage, type RenderPageOptions } from "../renderer/render.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCollectionList(
  collection: CmsCollection,
  base: Omit<RenderPageOptions, "title" | "slug" | "content" | "layout">
): string {
  const items = collection.items
    .map(
      (item) => `<article class="cms-card reveal">
  <a href="${collection.slug}-${item.slug}.html">
    ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" />` : ""}
    <h2>${escapeHtml(item.title)}</h2>
    ${item.excerpt ? `<p>${escapeHtml(item.excerpt)}</p>` : ""}
    ${item.publishedAt ? `<time>${escapeHtml(item.publishedAt)}</time>` : ""}
  </a>
</article>`
    )
    .join("\n");

  const layout = {
    type: "Stack" as const,
    children: [
      {
        type: "Section" as const,
        fullBleed: false,
        children: [
          {
            type: "Grid" as const,
            columns: 2,
            children: collection.items.map((i) => `cms_${i.id}`),
          },
        ],
      },
    ],
  };

  const content = collection.items.map((item) => ({
    id: `cms_${item.id}`,
    type: "feature",
    title: item.title,
    description: item.excerpt ?? "",
  }));

  return renderPage({
    ...base,
    title: collection.name,
    slug: collection.slug,
    content,
    layout,
  }).replace(
    "</main>",
    `<section class="cms-list layout-grid" data-layout="Grid">${items}</section></main>`
  );
}

function renderCollectionDetail(
  collection: CmsCollection,
  item: CmsItem,
  base: Omit<RenderPageOptions, "title" | "slug" | "content" | "layout">
): string {
  const layout = {
    type: "Stack" as const,
    children: [
      {
        type: "Section" as const,
        fullBleed: false,
        children: ["cms_detail"],
      },
    ],
  };

  const content = [
    {
      id: "cms_detail",
      type: "text",
      title: item.title,
      text: item.body ?? item.excerpt ?? "",
    },
  ];

  let html = renderPage({
    ...base,
    title: item.title,
    slug: `${collection.slug}-${item.slug}`,
    content,
    layout,
  });

  if (item.imageUrl) {
    html = html.replace(
      '<div class="prose">',
      `<img class="cms-hero" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" style="width:100%;max-height:420px;object-fit:cover;border-radius:16px;margin-bottom:1.5rem" /><div class="prose">`
    );
  }

  return html;
}

export function renderCmsPages(
  collections: CmsCollection[],
  businessName: string,
  businessBrief: string,
  theme: SiteTheme,
  navLinks: Array<{ slug: string; label: string }>,
  motionStyle?: string
): Record<string, string> {
  const pages: Record<string, string> = {};
  const base = {
    businessName,
    businessBrief,
    theme,
    navLinks,
    motionStyle,
  };

  for (const collection of collections) {
    pages[collection.slug] = renderCollectionList(collection, base);
    for (const item of collection.items) {
      pages[`${collection.slug}-${item.slug}`] = renderCollectionDetail(collection, item, base);
    }
  }

  return pages;
}
