import type { SiteContext } from "../site-context/types.js";
import { pickFrom } from "../design/variation.js";

export interface PageCompositionHint {
  heroComponent: string;
  avoidComponents: string[];
  encourageComponents: string[];
  notes: string;
}

export interface SiteCompositionPlan {
  pages: Record<string, PageCompositionHint>;
  siteAvoid: string[];
}

const HERO_COMPONENTS = [
  "HeroEditorial",
  "HeroSplitCinematic",
  "HeroSpotlight",
  "HeroVideo",
] as const;

/** Components that read as repetitive when reused across pages. */
const RARE_COMPONENT_ASSIGNMENTS: Array<{ name: string; candidateSlugs: string[] }> = [
  { name: "FaqAccordion", candidateSlugs: ["contact", "services", "about"] },
  { name: "StatsMarquee", candidateSlugs: ["home", "about", "services", "portfolio"] },
  { name: "IntroStatement", candidateSlugs: ["about", "portfolio", "home", "services"] },
  { name: "TextMarquee", candidateSlugs: ["home", "portfolio", "about"] },
  { name: "NewsletterBand", candidateSlugs: ["home", "about"] },
];

const PAGE_ENCOURAGE: Record<string, string[]> = {
  home: [
    "FeatureBento",
    "PortfolioStrip",
    "ScrollShowcase",
    "HorizontalGallery",
    "StatsAnimated",
    "TestimonialFeatured",
    "GalleryMasonry",
  ],
  about: [
    "TeamGrid",
    "ScrollShowcase",
    "BeforeAfter",
    "TestimonialFeatured",
    "StatsAnimated",
    "TextMarquee",
  ],
  services: [
    "ServicesShowcase",
    "ScrollShowcase",
    "FeatureBento",
    "PricingTiers",
    "BeforeAfter",
    "StatsAnimated",
  ],
  portfolio: [
    "GalleryMasonry",
    "PortfolioCarousel",
    "HorizontalGallery",
    "PortfolioStrip",
    "ScrollShowcase",
  ],
  contact: [
    "ContactSplit",
    "ServicesShowcase",
    "ScrollShowcase",
    "IntroStatement",
  ],
};

function shuffledHeroes(seed: number | string): string[] {
  const heroes = [...HERO_COMPONENTS];
  for (let i = heroes.length - 1; i > 0; i--) {
    const j = Number(pickFrom(seed, `hero-shuffle-${i}`, Array.from({ length: i + 1 }, (_, k) => k)));
    [heroes[i], heroes[j]] = [heroes[j]!, heroes[i]!];
  }
  return heroes;
}

function pickEncourage(seed: number | string, slug: string, pool: string[]): string[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Number(pickFrom(seed, `encourage-shuffle-${slug}-${i}`, Array.from({ length: i + 1 }, (_, k) => k)));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, Math.min(4, shuffled.length));
}

function assignRareComponents(
  seed: number | string,
  pageSlugs: string[],
  pages: Record<string, PageCompositionHint>,
): void {
  for (const rare of RARE_COMPONENT_ASSIGNMENTS) {
    const candidates = rare.candidateSlugs.filter((slug) => pageSlugs.includes(slug));
    if (candidates.length === 0) continue;
    const assignTo = pickFrom(seed, `assign-${rare.name}`, candidates);
    for (const slug of pageSlugs) {
      if (slug !== assignTo) {
        pages[slug]!.avoidComponents.push(rare.name);
      } else {
        pages[slug]!.encourageComponents.unshift(rare.name);
      }
    }
  }
}

/** Deterministic per-page composition hints so parallel codegen does not converge on the same hero/FAQ. */
export function buildSiteCompositionPlan(ctx: SiteContext): SiteCompositionPlan {
  const seed = ctx.variationSeed ?? ctx.businessName;
  const pageSlugs = ctx.sitePlan.pages.map((p) => p.slug);
  const heroes = shuffledHeroes(seed);
  const pages: Record<string, PageCompositionHint> = {};
  const usedHeroes = new Set<string>();

  for (const page of ctx.sitePlan.pages) {
    const pool =
      page.slug === "home"
        ? heroes
        : heroes.filter((h) => !usedHeroes.has(h));
    const hero =
      pool.length > 0
        ? pickFrom(seed, `hero-${page.slug}`, pool)
        : pickFrom(seed, `hero-${page.slug}`, heroes);
    usedHeroes.add(hero);

    const encouragePool = PAGE_ENCOURAGE[page.slug] ?? PAGE_ENCOURAGE.home ?? [];
    const notes = [
      page.contentFocus?.length
        ? `Content focus: ${page.contentFocus.join(", ")}`
        : "",
      page.layoutHint ? `Layout hint: ${page.layoutHint}` : "",
    ]
      .filter(Boolean)
      .join(". ");

    pages[page.slug] = {
      heroComponent: hero,
      avoidComponents: ["NewsletterBand"],
      encourageComponents: pickEncourage(seed, page.slug, encouragePool),
      notes,
    };
  }

  assignRareComponents(seed, pageSlugs, pages);

  const siteAvoid = [
    ...(ctx.sitePlan.avoidPatterns ?? []),
    "Do not reuse the same section types across pages unless the brief explicitly requires it.",
  ];

  return { pages, siteAvoid };
}

export function formatCompositionHintBlock(
  plan: SiteCompositionPlan,
  pageSlug: string,
): string {
  const hint = plan.pages[pageSlug];
  if (!hint) return "";

  const lines = [
    "COMPOSITION HINT (follow this — do not default to FAQ or HeroSpotlight):",
    `- Required hero: ${hint.heroComponent}`,
    hint.encourageComponents.length > 0
      ? `- Prefer these section types: ${hint.encourageComponents.join(", ")}`
      : "",
    hint.avoidComponents.length > 0
      ? `- Do NOT use: ${hint.avoidComponents.join(", ")}`
      : "",
    hint.notes ? `- ${hint.notes}` : "",
    plan.siteAvoid.length > 0 ? `- Site-wide avoid: ${plan.siteAvoid.join("; ")}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}
