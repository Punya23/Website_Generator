import type { ContentBlock, SiteTheme } from "../types.js";
import { heroImageUrl, stockImageUrl } from "./stock-images.js";

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

function withSrc(block: ContentBlock, src: string): ContentBlock {
  return { ...block, src };
}

/** Attach Unsplash stock photos to image/gallery blocks and hero backgrounds. */
export function enrichContentWithImages(
  blocks: ContentBlock[],
  pageKind: string,
  businessName: string,
  businessBrief: string,
  theme: SiteTheme
): ContentBlock[] {
  const vertical = theme.vertical;
  let enriched = blocks.map((block) => {
    if (block.type === "image" || block.type === "gallery") {
      const query = imageQueryFor(block);
      const src = stockImageUrl(query, `${block.id}-${pageKind}`, vertical, 900, 600);
      return withSrc(block, src);
    }
    if (block.type === "headline" && pageKind === "home" && !block.heroImage) {
      const src = heroImageUrl(businessName, businessBrief, vertical);
      return { ...block, heroImage: src };
    }
    return block;
  });

  const hasVisual =
    enriched.some((b) => b.type === "image" || b.type === "gallery") ||
    enriched.some((b) => b.type === "headline" && b.heroImage);

  if (!hasVisual) {
    enriched = [
      {
        id: `${pageKind}_banner`,
        type: "image",
        alt: `${businessName} — ${pageKind}`,
        imageQuery: `${businessBrief} ${pageKind}`,
        src: stockImageUrl(`${businessBrief} ${pageKind}`, `${pageKind}-banner`, vertical, 1200, 500),
      },
      ...enriched,
    ];
  }

  if (pageKind === "services" && !enriched.some((b) => b.type === "gallery")) {
    enriched.push(
      {
        id: `${pageKind}_gallery_1`,
        type: "gallery",
        caption: "Our work",
        imageQuery: `${businessBrief} service`,
        src: stockImageUrl(businessBrief, `${pageKind}-g1`, vertical, 600, 600),
      },
      {
        id: `${pageKind}_gallery_2`,
        type: "gallery",
        caption: "The experience",
        imageQuery: `${businessBrief} interior`,
        src: stockImageUrl(`${businessBrief} interior`, `${pageKind}-g2`, vertical, 600, 600),
      }
    );
  }

  return enriched;
}

/** Legacy: strip broken LLM URLs — enrichment replaces with stock. */
export function sanitizeContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type === "image" || block.type === "gallery") {
      const src = str(block.src);
      if (src && !src.includes("images.unsplash.com")) {
        const { src: _s, ...rest } = block;
        return rest as ContentBlock;
      }
    }
    return block;
  });
}
