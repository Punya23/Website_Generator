/**
 * The hard gate between a brief and the corpus: which templates is this site allowed to be built
 * from at all?
 *
 * Ranking was not enough. `rankByTaxonomy` narrows to the best-affinity tier *within whatever pool
 * a role happens to have*, and falls back to the entire pool the moment nothing scores — so a
 * brief whose industry the corpus is thin on would quietly draw its hero from a wedding template
 * and its features from a crypto one. This module turns that preference into a constraint: a site
 * is scoped to one taxonomy tier, and sections outside it are not candidates, not low-ranked ones.
 *
 * The ladder exists so "hard" does not mean "empty". Tiers, best first:
 *
 *   industry  — the template's own classified industry is the brief's industry
 *   related   — either side's near-miss list contains the other's industry (`runnersUp`)
 *   category  — same coarse SkinCategory (local-service / hospitality / professional / creative)
 *   any       — no taxonomy relationship at all; strict mode refuses to go here
 *
 * Every tier above `any` requires the shared coarse category, so under strict mode a site can
 * never draw from outside its own category. A `universalFit` template — filed as multipurpose AND
 * saying nothing about any vertical in its own markup — joins from the `category` tier down; a
 * multipurpose-shelf template whose demo content is plainly a dental clinic is classified as one
 * and gated like one, because that is what a site built from it looks like.
 *
 * Scope is resolved once per site against the roles a page genuinely cannot do without
 * (nav/hero/footer): the ladder descends only as far as it must for those to exist. Optional roles
 * widen individually — a plumber's site takes its hero from a plumbing template and only borrows a
 * `faq` band from a sibling trade when no plumbing template in the corpus has one — so one rare
 * role can never drag the whole site down a tier.
 */
import { industryCategory, type TaxonomyMatch } from "../skins/taxonomy.js";
import type { IndexedSection } from "./store.js";
import type { SectionRole } from "./types.js";

export const TAXONOMY_TIERS = ["industry", "related", "category", "any"] as const;
export type TaxonomyTier = (typeof TAXONOMY_TIERS)[number];

/** Deepest tier a strictly-scoped site may descend to. `any` is what strict mode exists to
 *  forbid — a template with no taxonomy relationship to the brief whatsoever. */
const STRICT_MAX_TIER: TaxonomyTier = "category";

export function tierIndex(tier: TaxonomyTier): number {
  return TAXONOMY_TIERS.indexOf(tier);
}

/**
 * Where one candidate sits relative to the brief.
 *
 * `related` is deliberately constrained to the brief's own category. A near-miss industry is a
 * useful widening — a bakery brief should be able to use a restaurant template — but "near-miss"
 * is measured by keyword-score proximity, and score proximity crosses category lines freely: a
 * creative-category template whose mixed demo copy put `beauty-wellness` in its own runners-up
 * list was being admitted to a salon site one tier ABOVE the category tier, so the ladder let
 * cross-category templates in *before* it had even tried same-category ones. Measured on this
 * repo's corpus that leaked on 9 of 32 verticals — a nightlife brief pulled from all four
 * categories at once. Requiring the shared category makes the ladder monotonically narrowing:
 * industry ⊆ related ⊆ category, and nothing outside the category is reachable at all under
 * strict mode.
 */
export function sectionTier(section: IndexedSection, match: TaxonomyMatch): TaxonomyTier {
  if (section.industry && section.industry === match.industry) return "industry";
  const sameCategory = section.category === match.category;
  if (sameCategory && section.industry && match.runnersUp.includes(section.industry)) return "related";
  if (
    sameCategory &&
    section.industryRunnersUp.some(
      (industry) => industry === match.industry && industryCategory(industry) === match.category
    )
  ) {
    return "related";
  }
  if (sameCategory) return "category";
  return "any";
}

/**
 * `universalFit` is an escape hatch, not a wildcard: it only buys eligibility from the `category`
 * tier down. A template earns the flag by being filed as multipurpose *and* saying nothing about
 * any vertical in its own markup, which makes it a reasonable filler once same-category options
 * are already on the table — but not a peer of an exact industry match, which is what "eligible at
 * every tier" made it.
 */
export function withinTier(section: IndexedSection, match: TaxonomyMatch, tier: TaxonomyTier): boolean {
  if (section.universalFit && tierIndex(tier) >= tierIndex("category")) return true;
  return tierIndex(sectionTier(section, match)) <= tierIndex(tier);
}

export interface TaxonomyScopeOptions {
  /** Roles a generated page genuinely cannot do without. The ladder descends until all of these
   *  have at least one candidate — never further on their account. */
  requiredRoles: readonly SectionRole[];
  /** Refuse the `any` tier unless the required roles are otherwise uncoverable. Default true:
   *  the whole point of the gate. `TEMPLATE_STRICT_TAXONOMY=0` turns it off. */
  strict?: boolean;
}

export interface TaxonomyScope {
  /** Deepest tier the site as a whole is scoped to. */
  tier: TaxonomyTier;
  strict: boolean;
  /** True when strict mode had to be broken because the corpus could not cover the required roles
   *  within `category` — the "your corpus has nothing for this vertical" signal, worth logging. */
  widenedBeyondStrict: boolean;
  /** Tier actually used per role, as of the last `poolFor` call for it: the site tier, or deeper
   *  for a role the site tier has no usable candidate for. Never deeper than the strict cap unless
   *  the site tier already was. */
  tierByRole: Map<SectionRole, TaxonomyTier>;
  /**
   * Candidates for one role, already gated.
   *
   * `accept` is the caller's *other* hard constraint — in practice the site-wide light/dark theme
   * lock. It is consulted when deciding how far down the ladder this role has to go, but not used
   * to filter the result: widening has to see the constraint or it resolves to a tier whose only
   * candidates the caller then throws away, which is how a theme-locked site ended up with pages
   * missing their nav and footer entirely. The caller applies its own filter to what comes back.
   */
  poolFor(role: SectionRole, accept?: (section: IndexedSection) => boolean): IndexedSection[];
}

function rolesCovered(sections: readonly IndexedSection[], roles: readonly SectionRole[]): boolean {
  const present = new Set(sections.map((section) => section.role));
  return roles.every((role) => present.has(role));
}

/**
 * Resolve the tier a site is scoped to, and the per-role widening on top of it.
 *
 * `match` being undefined means the caller has no brief to classify (ad-hoc and test callers), in
 * which case there is nothing to gate on and every section stays eligible — the gate constrains,
 * it does not invent a classification to constrain by.
 */
export function resolveTaxonomyScope(
  sections: readonly IndexedSection[],
  match: TaxonomyMatch | undefined,
  options: TaxonomyScopeOptions
): TaxonomyScope {
  const byRole = new Map<SectionRole, IndexedSection[]>();
  for (const section of sections) {
    byRole.set(section.role, [...(byRole.get(section.role) ?? []), section]);
  }

  if (!match) {
    return {
      tier: "any",
      strict: false,
      widenedBeyondStrict: false,
      tierByRole: new Map(),
      poolFor: (role) => byRole.get(role) ?? [],
    };
  }


  const strict = options.strict ?? true;
  const cap = strict ? tierIndex(STRICT_MAX_TIER) : tierIndex("any");

  const at = (tier: TaxonomyTier): IndexedSection[] =>
    sections.filter((section) => withinTier(section, match, tier));

  let siteTier: TaxonomyTier = "industry";
  let widenedBeyondStrict = false;
  for (const tier of TAXONOMY_TIERS) {
    siteTier = tier;
    if (rolesCovered(at(tier), options.requiredRoles)) break;
    if (tierIndex(tier) >= cap) {
      // Nothing within the strict cap can produce a page at all. Refusing to generate would be a
      // worse answer than a template from an unrelated vertical, so the cap yields — loudly.
      if (strict && rolesCovered(sections, options.requiredRoles)) {
        siteTier = "any";
        widenedBeyondStrict = true;
      }
      break;
    }
  }

  const siteIndex = tierIndex(siteTier);
  const effectiveCap = widenedBeyondStrict ? tierIndex("any") : Math.max(cap, siteIndex);

  const tierByRole = new Map<SectionRole, TaxonomyTier>();

  const poolFor = (
    role: SectionRole,
    accept: (section: IndexedSection) => boolean = () => true
  ): IndexedSection[] => {
    const candidates = byRole.get(role) ?? [];
    let roleTier = siteTier;
    for (let i = siteIndex; i <= effectiveCap; i++) {
      roleTier = TAXONOMY_TIERS[i]!;
      if (candidates.some((section) => withinTier(section, match, roleTier) && accept(section))) break;
    }
    tierByRole.set(role, roleTier);
    return candidates.filter((section) => withinTier(section, match, roleTier));
  };

  return { tier: siteTier, strict, widenedBeyondStrict, tierByRole, poolFor };
}
