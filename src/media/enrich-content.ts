import type { ContentBlock, SiteTheme } from "../types.js";
import { stockImageUrl } from "./stock-images.js";
import type { MediaRegistry } from "./media-registry.js";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function imageQueryFor(block: ContentBlock): string {
  return (
    str(block.imageQuery) ||
    str(block.alt) ||
    str(block.caption) ||
    str(block.title) ||
    str(block.text) ||
    block.type
  );
}

export async function resolveUniqueImage(
  query: string,
  cacheKey: string,
  registry: MediaRegistry,
  blockId: string,
  sectionId: string,
  pageSlug: string,
  width: number,
  height: number,
  vertical?: string
): Promise<string> {
  let q = query;
  for (let attempt = 0; attempt < 4; attempt++) {
    const src = await stockImageUrl(q, `${cacheKey}-${attempt}`, vertical, width, height);
    if (!registry.isDuplicate(src)) {
      registry.register({ url: src, query: q, blockId, sectionId, pageSlug });
      return src;
    }
    q = registry.uniqueQuery(query, blockId, sectionId);
  }
  const fallback = await stockImageUrl(`${query} ${blockId}`, cacheKey, vertical, width, height);
  registry.register({ url: fallback, query, blockId, sectionId, pageSlug });
  return fallback;
}

/** Attach stock photos — no synthetic banner/gallery injection. */
export async function enrichSectionImages(
  blocks: ContentBlock[],
  pageSlug: string,
  businessName: string,
  businessBrief: string,
  _theme: SiteTheme,
  registry: MediaRegistry,
  sectionId: string
): Promise<ContentBlock[]> {
  const enriched: ContentBlock[] = [];

  for (const block of blocks) {
    if (block.type === "image" || block.type === "gallery") {
      const query = imageQueryFor(block);
      const src = await resolveUniqueImage(
        query,
        `${block.id}-${pageSlug}`,
        registry,
        block.id,
        sectionId,
        pageSlug,
        900,
        600
      );
      enriched.push({ ...block, src });
      continue;
    }

    if (block.type === "beforeAfter") {
      const beforeQuery = str(block.beforeImageQuery) || str(block.beforeImage) || "before";
      const afterQuery = str(block.afterImageQuery) || str(block.afterImage) || "after";
      const beforeSrc = await resolveUniqueImage(
        `${businessBrief} ${beforeQuery}`,
        `${block.id}-before`,
        registry,
        block.id,
        sectionId,
        pageSlug,
        800,
        600
      );
      const afterSrc = await resolveUniqueImage(
        `${businessBrief} ${afterQuery}`,
        `${block.id}-after`,
        registry,
        block.id,
        sectionId,
        pageSlug,
        800,
        600
      );
      enriched.push({ ...block, beforeSrc, afterSrc });
      continue;
    }

    if (block.type === "headline" && !block.heroImage) {
      const isHeroSection = sectionId.includes("hero");
      if (isHeroSection) {
        const src = await resolveUniqueImage(
          `${businessBrief} ${businessName} hero`,
          `hero-${pageSlug}-${sectionId}`,
          registry,
          block.id,
          sectionId,
          pageSlug,
          1600,
          900
        );
        enriched.push({ ...block, heroImage: src });
        continue;
      }
    }

    if (block.type === "headline" && block.splitImage === undefined) {
      const isSplit = sectionId.includes("split") || String(block.layoutVariant) === "split";
      if (isSplit) {
        const src = await resolveUniqueImage(
          imageQueryFor(block),
          `${block.id}-split`,
          registry,
          block.id,
          sectionId,
          pageSlug,
          1200,
          900
        );
        enriched.push({ ...block, splitImage: src });
        continue;
      }
    }

    if (block.type === "logo") {
      const src = await resolveUniqueImage(
        str(block.imageQuery) || `${str(block.name)} logo`,
        `${block.id}-logo`,
        registry,
        block.id,
        sectionId,
        pageSlug,
        400,
        200
      );
      enriched.push({ ...block, src });
      continue;
    }

    if (block.type === "bento" || block.type === "pricing") {
      if (block.type === "bento" && (block.imageQuery || block.title)) {
        const src = await resolveUniqueImage(
          imageQueryFor(block),
          `${block.id}-bento`,
          registry,
          block.id,
          sectionId,
          pageSlug,
          800,
          600
        );
        enriched.push({ ...block, src });
        continue;
      }
    }

    enriched.push(block);
  }

  return enriched;
}

/** @deprecated use enrichSectionImages */
export async function enrichContentWithImages(
  blocks: ContentBlock[],
  pageKind: string,
  businessName: string,
  businessBrief: string,
  theme: SiteTheme
): Promise<ContentBlock[]> {
  const { MediaRegistry: Reg } = await import("./media-registry.js");
  const registry = new Reg();
  return enrichSectionImages(
    blocks,
    pageKind,
    businessName,
    businessBrief,
    theme,
    registry,
    `${pageKind}_legacy`
  );
}

/** Strip broken LLM URLs — enrichment replaces with resolved stock. */
export function sanitizeContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type === "image" || block.type === "gallery") {
      const src = str(block.src);
      if (src && !src.startsWith("https://")) {
        const { src: _s, ...rest } = block;
        return rest as ContentBlock;
      }
    }
    return block;
  });
}
