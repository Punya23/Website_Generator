import type { SiteContext } from "../types.js";
import { pickFrom } from "../design/variation.js";
import { SECTION_TEMPLATES } from "../section-templates/registry.js";
import { CONVERSION_COMPONENT_NAMES } from "./component-manifest.js";
import type { SiteLookProfile } from "./site-look-agent.js";

export interface PageCompositionHint {
  heroComponent: string;
  avoidComponents: string[];
  encourageComponents: string[];
  notes: string;
}

export interface SiteCompositionPlan {
  pages: Record<string, PageCompositionHint>;
  siteAvoid: string[];
  /** The committed one-sentence art direction, injected verbatim into every page's copy prompt. */
  aestheticDirection: string;
}

/** Heroes weighted against always picking HeroSpotlight (cursor/mesh FX). */
const HERO_WEIGHT: Record<string, number> = {
  HeroEditorial: 3,
  HeroSplitCinematic: 3,
  HeroVideo: 2,
  HeroSpotlight: 1,
};

/** Only templates registered as hero_* are shaped to open a page — derived, not hand-capped,
 *  so a newly registered hero template is picked up automatically. */
const HERO_COMPONENTS = SECTION_TEMPLATES.filter((t) => t.id.startsWith("hero_")).map(
  (t) => t.componentName
);

function weightedHeroPool(): string[] {
  const pool: string[] = [];
  for (const name of HERO_COMPONENTS) {
    const weight = HERO_WEIGHT[name] ?? 2;
    for (let i = 0; i < weight; i++) pool.push(name);
  }
  return pool.length > 0 ? pool : [...HERO_COMPONENTS];
}

/** Components that read as repetitive when reused across pages — capped to one page per site. */
const RARE_COMPONENT_ASSIGNMENTS: Array<{ name: string; candidateSlugs: string[] }> = [
  { name: "FaqAccordion", candidateSlugs: ["contact", "services", "about"] },
  { name: "StatsMarquee", candidateSlugs: ["home", "about", "services", "portfolio"] },
  { name: "IntroStatement", candidateSlugs: ["about", "portfolio", "home", "services"] },
  { name: "TextMarquee", candidateSlugs: ["home", "portfolio", "about"] },
  { name: "NewsletterBand", candidateSlugs: ["home", "about"] },
];

/** Every non-hero, non-conversion template — the real pool the LLM should be encouraged to use,
 *  instead of a small hand-curated list that structurally excluded most of the library. */
function nonHeroNonConversionComponents(): string[] {
  const heroSet = new Set(HERO_COMPONENTS);
  return SECTION_TEMPLATES.map((t) => t.componentName).filter(
    (name) => !heroSet.has(name) && !CONVERSION_COMPONENT_NAMES.has(name)
  );
}

function seededShuffle(seed: number | string, key: string, items: string[]): string[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Number(pickFrom(seed, `${key}-${i}`, Array.from({ length: i + 1 }, (_, k) => k)));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

function shuffledHeroes(seed: number | string): string[] {
  const unique = [...new Set(seededShuffle(seed, "hero-shuffle", weightedHeroPool()))];
  return unique.length > 0 ? unique : seededShuffle(seed, "hero-shuffle", HERO_COMPONENTS);
}

/** Pick this page's encouraged components: LLM-proposed preferences first (this is what makes
 *  composition follow the brief instead of just reshuffling a fixed pool), then the rest of the
 *  library ranked by how little it's been used on earlier pages of this same site so distinct
 *  pages favor distinct sections, seeded-shuffled for tie-breaking. */
function pickEncourage(
  seed: number | string,
  slug: string,
  pool: string[],
  preferred: string[] = [],
  usageCounts?: Map<string, number>
): string[] {
  const preferredSet = new Set(preferred.filter((c) => pool.includes(c)));
  const rest = pool.filter((c) => !preferredSet.has(c));
  const shuffled = seededShuffle(seed, `encourage-shuffle-${slug}`, rest);
  shuffled.sort((a, b) => (usageCounts?.get(a) ?? 0) - (usageCounts?.get(b) ?? 0));
  const ranked = [...preferredSet, ...shuffled];
  return ranked.slice(0, Math.min(10, ranked.length));
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
        pages[slug]!.avoidComponents = pages[slug]!.avoidComponents.filter((c) => c !== rare.name);
      }
    }
  }
}

/** Deterministic per-page composition hints so parallel codegen does not converge on the same
 *  hero/FAQ. `lookProfile` (from site-look-agent) is an optional per-brief bias so composition
 *  follows the business, not just a random seed reshuffling the same small pool. */
export function buildSiteCompositionPlan(
  ctx: SiteContext,
  lookProfile?: SiteLookProfile
): SiteCompositionPlan {
  const seed = ctx.variationSeed ?? ctx.businessName;
  const pageSlugs = ctx.sitePlan.pages.map((p) => p.slug);
  const heroes = shuffledHeroes(seed);
  const pages: Record<string, PageCompositionHint> = {};
  const usedHeroes = new Set<string>();
  const usageCounts = new Map<string, number>();
  const encouragePool = nonHeroNonConversionComponents();

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

    const notes = [
      page.contentFocus?.length
        ? `Content focus: ${page.contentFocus.join(", ")}`
        : "",
      page.layoutHint ? `Layout hint: ${page.layoutHint}` : "",
      lookProfile?.layoutArchetype ? `Visual direction: ${lookProfile.layoutArchetype}` : "",
    ]
      .filter(Boolean)
      .join(". ");

    const encourageComponents = pickEncourage(
      seed,
      page.slug,
      encouragePool,
      lookProfile?.preferredTemplateIds,
      usageCounts
    );
    for (const c of encourageComponents) {
      usageCounts.set(c, (usageCounts.get(c) ?? 0) + 1);
    }

    pages[page.slug] = {
      heroComponent: hero,
      avoidComponents: ["NewsletterBand"],
      encourageComponents,
      notes,
    };
  }

  assignRareComponents(seed, pageSlugs, pages);

  for (const slug of pageSlugs) {
    const hint = pages[slug]!;
    hint.encourageComponents = hint.encourageComponents.filter(
      (c) => !hint.avoidComponents.includes(c)
    );
  }

  const siteAvoid = [
    ...(ctx.sitePlan.avoidPatterns ?? []),
    "Do not reuse the same section types across pages unless the brief explicitly requires it.",
  ];

  return { pages, siteAvoid, aestheticDirection: lookProfile?.aestheticDirection ?? "" };
}

export function formatCompositionHintBlock(
  plan: SiteCompositionPlan,
  pageSlug: string,
): string {
  const hint = plan.pages[pageSlug];
  if (!hint) return "";

  const lines = [
    plan.aestheticDirection
      ? `ART DIRECTION (hold this look across every section — copy, tone, and mood must match it): ${plan.aestheticDirection}`
      : "",
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
