import type { ContentBlock, LayoutNode } from "../types.js";

export const SECTION_ARCHETYPES = [
  "split_hero",
  "logo_wall",
  "pricing_table",
  "bento_grid",
  "stats_row",
  "feature_grid",
  "testimonial_band",
  "cta_band",
] as const;

export type SectionArchetype = (typeof SECTION_ARCHETYPES)[number];

export function isSectionArchetype(value: string): value is SectionArchetype {
  return (SECTION_ARCHETYPES as readonly string[]).includes(value);
}

/** Layout primitives per archetype — AI fills blocks; structure stays consistent. */
export function buildArchetypeLayout(
  archetype: SectionArchetype,
  blocks: ContentBlock[],
  fullBleed = false
): LayoutNode {
  const ids = blocks.map((b) => b.id);
  const byType = (type: string) => blocks.filter((b) => b.type === type).map((b) => b.id);
  const first = (type: string) => byType(type)[0];
  const section = (children: LayoutNode["children"]): LayoutNode => ({
    type: "Section",
    fullBleed,
    children,
  });

  switch (archetype) {
    case "split_hero": {
      const headline = first("headline");
      const image = first("image") ?? first("gallery");
      if (headline && image) {
        return section([{ type: "Row", columns: 2, children: [headline, image] }]);
      }
      return section(ids);
    }
    case "logo_wall": {
      const logos = byType("logo");
      return section([
        logos.length >= 2
          ? { type: "Row", columns: Math.min(logos.length, 5), children: logos }
          : { type: "Grid", columns: 4, children: logos.length ? logos : ids },
      ]);
    }
    case "pricing_table": {
      const tiers = byType("pricing");
      return section([
        {
          type: "Grid",
          columns: Math.min(tiers.length || 3, 3),
          minColumnWidth: 260,
          children: tiers.length ? tiers : ids,
        },
      ]);
    }
    case "bento_grid": {
      const cards = byType("bento").length ? byType("bento") : ids;
      return section([{ type: "Bento", columns: 4, children: cards }]);
    }
    case "stats_row": {
      const stats = byType("stat");
      return section([
        {
          type: "Row",
          columns: Math.min(stats.length || 3, 4),
          children: stats.length ? stats : ids,
        },
      ]);
    }
    case "feature_grid": {
      const features = byType("feature");
      return section([
        {
          type: "Grid",
          columns: 3,
          children: features.length ? features : ids,
        },
      ]);
    }
    case "testimonial_band": {
      const quotes = byType("testimonial");
      return section([
        {
          type: "Row",
          columns: Math.min(quotes.length || 2, 3),
          children: quotes.length ? quotes : ids,
        },
      ]);
    }
    case "cta_band":
      return section([first("cta") ?? ids[0]!].filter(Boolean));
    default:
      return section(ids);
  }
}

export const ARCHETYPE_BLOCK_TYPES: Record<SectionArchetype, string[]> = {
  split_hero: ["headline", "text", "image"],
  logo_wall: ["text", "logo"],
  pricing_table: ["headline", "pricing"],
  bento_grid: ["bento"],
  stats_row: ["stat"],
  feature_grid: ["feature"],
  testimonial_band: ["testimonial"],
  cta_band: ["cta"],
};
