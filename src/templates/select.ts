/**
 * Cross-template section selection — locks one ANCHOR template's identity for the whole site (its
 * chrome and its hero), then fills every other role from a pool that mixes in a DIFFERENT template
 * only when a design-fingerprint compatibility check says the mix will not visibly clash.
 *
 * This has gone through three shapes. Originally `pick()` actively preferred whichever template the
 * site had NOT drawn from yet, so a typical site ended up with 16-18 distinct source templates
 * across ~24 sections — nav from one, hero from another, footer from a third, every section its own
 * design system, boxes and corners disagreeing everywhere. That was fixed by locking one anchor
 * template and only reaching into another when the anchor had nothing at all for a role — safe, but
 * it also meant genuine mixing almost never happened (one real generation drew 23 of 24 sections
 * from a single template), which defeated the actual point of ingesting a corpus of hundreds of
 * templates in the first place: this shape is the fix for THAT — mixing is scored, not
 * either-banned-or-unbounded.
 *
 * The mix is bounded four times before any ranking runs:
 *   1. taxonomy — the site is scoped to one tier of the brief's vertical (`taxonomy-scope.ts`),
 *      so an infrastructure brief draws only from infrastructure-classified templates;
 *   2. theme — one original light/dark origin for the whole site, never both;
 *   3. identity roles (nav/footer/hero) — always anchor-first, any-template-fallback only when the
 *      anchor has nothing: a nav or hero that changes between pages, or a chrome/hero swap mid-site,
 *      reads as broken regardless of how compatible the two templates' design languages are. See
 *      `IDENTITY_ROLES` and `pick()` below.
 *   4. mixable roles (everything else) — a combined pool of the anchor's own sections PLUS any other
 *      template's sections whose `fingerprintCompatibility` against the anchor clears
 *      `templateMixCompatibilityThreshold()`; below that bar a candidate is not a lower-ranked
 *      option, it is not a candidate. See `mixScore()`.
 * Ranking (`rankByTaxonomy`, `scoreSection`, `mixScore`) then orders what is left within whichever
 * tier wins.
 *
 * Determinism and the per-consumer history mirror `src/skins/picker.ts` so repeat generations for
 * one customer keep varying — a different anchor and a different accepted mix next time, not
 * different sections within one site on the same seed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pickFrom, hashString } from "../design/variation.js";
import { classifyBriefTaxonomy } from "../skins/picker.js";
import { taxonomyAffinity, type TaxonomyMatch } from "../skins/taxonomy.js";
import type { ExpandedBrief } from "../types.js";
import {
  anchorExploreBand,
  strictTaxonomyScope,
  templateMixCompatibilityThreshold,
  templateMixEnabled,
  templateSectionHistoryPath,
} from "./config.js";
import { fingerprintCompatibility } from "./ingest/design-fingerprint.js";
import { templateStore, type IndexedSection, type TemplateStore } from "./store.js";
import { resolveTaxonomyScope, type TaxonomyTier } from "./taxonomy-scope.js";
import type { DesignFingerprint, PlacedSection, SectionRole } from "./types.js";

/** Roles that define a site's identity: a nav, footer or hero that differs between pages, or that
 *  swaps template between pages, reads as broken no matter how compatible the two design languages
 *  measure. These stay anchor-first with an any-template fallback only when the anchor has nothing
 *  — the exact behaviour selection had before this module's mixing rewrite. Every other role is
 *  "mixable": scored and ranked across a compatibility-gated combined pool — see `mixScore()`. */
const IDENTITY_ROLES = new Set<SectionRole>(["nav", "footer", "hero"]);

/**
 * How well a classified section fits a brief's taxonomy match. Reuses the exact scoring
 * `src/skins/picker.ts` ranks authored skins with (`taxonomyAffinity`) — a category-folder-tagged
 * template and an authored skin are ranked by the same rule, just adapted from a skin's
 * `industries[]`/`categories[]` arrays to a template's single `industry`/`category` fields (one
 * template only ever carries the one classification its bundle folder gave it).
 */
export function sectionTaxonomyAffinity(section: IndexedSection, match: TaxonomyMatch): number {
  return taxonomyAffinity(
    {
      industries: section.industry ? [section.industry] : undefined,
      categories: section.category ? [section.category] : [],
      ...(section.archetype ? { archetype: section.archetype } : {}),
    },
    match
  );
}

/** Narrow a pool to its best-taxonomy-fit tier; untagged sections (no category-folder hint at
 *  ingest) fall through unchanged — this is what keeps selection working exactly as before for a
 *  corpus, or the part of one, that was never dropped into a category folder. */
export function rankByTaxonomy(pool: IndexedSection[], match: TaxonomyMatch): IndexedSection[] {
  if (pool.length === 0) return pool;
  const scored = pool.map((section) => ({ section, affinity: sectionTaxonomyAffinity(section, match) }));
  const best = Math.max(...scored.map((row) => row.affinity));
  if (best <= 0) return pool;
  // A `universalFit` section ("Multipurpose & Landing Pages") stays eligible for every brief even
  // once some other template in the pool has a real industry match — it is not competing to be
  // the best-fit vertical, it is declaring it fits any of them.
  return scored.filter((row) => row.affinity === best || row.section.universalFit).map((row) => row.section);
}

/** Page skeletons, one ordered role list per slug. Mirrors the page set the rest of the app
 *  already assumes (`SKIN_PAGE_TITLES` in `src/skins/schema.ts`). */
export const PAGE_ROLE_PLAN: Record<string, SectionRole[]> = {
  home: ["nav", "hero", "features", "story", "gallery", "testimonials", "cta", "footer"],
  about: ["nav", "hero", "story", "team", "stats", "cta", "footer"],
  services: ["nav", "hero", "features", "pricing", "faq", "cta", "footer"],
  contact: ["nav", "hero", "contact", "footer"],
};

/**
 * Testimonials and team sections are skipped by default. The brief carries no real customer
 * quotes and no real staff, so placing those sections means shipping either the template
 * author's invented people or newly invented ones — fake reviews and fake staff on a real
 * business's site. Set TEMPLATE_ALLOW_FABRICATED_PEOPLE=1 to place them anyway.
 */
function fabricatedPeopleAllowed(): boolean {
  return (process.env.TEMPLATE_ALLOW_FABRICATED_PEOPLE ?? "0").trim() === "1";
}

const PEOPLE_ROLES = new Set<SectionRole>(["testimonials", "team"]);

function planForPage(slug: string): SectionRole[] {
  const plan = PAGE_ROLE_PLAN[slug] ?? PAGE_ROLE_PLAN.home!;
  return fabricatedPeopleAllowed() ? plan : plan.filter((role) => !PEOPLE_ROLES.has(role));
}

/** Roles a page can do without when the corpus has nothing suitable. */
const OPTIONAL_ROLES = new Set<SectionRole>([
  "gallery",
  "testimonials",
  "team",
  "stats",
  "pricing",
  "faq",
  "cta",
  "story",
  "features",
  "contact",
]);

export interface SectionHistoryFile {
  consumers: Record<string, { used: string[]; updatedAt: number }>;
}

/** Per-consumer memory of placed sections, so the same customer regenerating does not get the
 *  same hero twice. Same shape as `SkinHistoryStore`. */
export class SectionHistoryStore {
  constructor(private readonly filePath = templateSectionHistoryPath()) {}

  async getUsed(consumerId: string): Promise<string[]> {
    const data = await this.read();
    return data.consumers[consumerId]?.used ?? [];
  }

  async record(consumerId: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const data = await this.read();
    const prev = data.consumers[consumerId]?.used ?? [];
    const used = [...new Set([...prev, ...keys])].slice(-500);
    data.consumers[consumerId] = { used, updatedAt: Date.now() };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  private async read(): Promise<SectionHistoryFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as SectionHistoryFile;
      return parsed?.consumers ? parsed : { consumers: {} };
    } catch {
      return { consumers: {} };
    }
  }
}

export function sectionKey(section: { templateId: string; sectionId: string }): string {
  return `${section.templateId}:${section.sectionId}`;
}

export interface SelectSiteOptions {
  /** Classified once, then used as a HARD gate: only templates within the resulting taxonomy tier
   *  are candidates at all (see `taxonomy-scope.ts`), and `rankByTaxonomy` orders within that.
   *  Optional only so ad-hoc/test callers are not forced to construct a full brief — with no brief
   *  there is nothing to gate on and the whole corpus stays eligible. Production callers pass it. */
  brief?: ExpandedBrief;
  variationSeed: number | string;
  consumerId?: string;
  store?: TemplateStore;
  history?: SectionHistoryStore;
  /** Page slugs to build. Defaults to every page in PAGE_ROLE_PLAN. */
  pages?: string[];
  /** Anchor templates to rule out before scoring — a redo after a failed final visual QA passes
   *  the previous attempt's `anchorTemplateId` here to force genuine exploration of a different
   *  one. If excluding leaves no qualifying candidate, the exclusion is dropped rather than
   *  failing the whole site (a worse-but-real anchor beats none). */
  excludeAnchorTemplateIds?: string[];
}

export interface SelectedSite {
  pages: Record<string, PlacedSection[]>;
  /** Distinct source templates the site drew from — the "cross-template" evidence. */
  templateIds: string[];
  /** The site-wide original-theme lock every picked section was filtered by, or `undefined` when
   *  nothing in the (taxonomy-scoped) pool carried a `theme` tag to lock onto. */
  theme?: "light" | "dark";
  /** The template every role-pick preferred, before falling back to another template for a role
   *  the anchor had nothing for. `undefined` only when the scoped pool has no single template
   *  covering all required roles (nav/hero/footer) at all. */
  anchorTemplateId?: string;
  /** Every qualifying anchor candidate this run actually compared, sorted best-first, with the
   *  composite score (coverage + section quality + taxonomy fit) that decided the shortlist a
   *  final anchor was drawn from — the "what else was considered" record for the admin
   *  provenance view and for a final-visual-QA redo picking a genuinely different anchor. */
  anchorCandidates?: Array<{ templateId: string; score: number }>;
  /** How the corpus was gated for this brief — what the site was locked to, and whether the lock
   *  had to be broken. Logged by the pipeline and stored with the generation record so a
   *  "why did my plumber site get a wedding hero?" question has an answer. */
  taxonomy?: {
    industry: string;
    category: string;
    archetype: string;
    /** Deepest tier admitted site-wide: `industry` is the strongest possible lock. */
    tier: TaxonomyTier;
    strict: boolean;
    /** True when the corpus had nothing in this vertical and the strict cap had to yield. */
    widened: boolean;
  };
}

interface AnchorCandidateScore {
  templateId: string;
  coverage: number;
  coverageRatio: number;
  quality: number;
  taxonomyFit: number;
  score: number;
}

function scoreSection(section: IndexedSection): number {
  // Confidence first, then slot richness: a section with locatable copy slots produces a page
  // that actually talks about this business rather than the template author's placeholder.
  return section.roleConfidence * 2 + Math.min(section.slotKinds.length, 6) * 0.15;
}

/** A small, deliberate edge for reusing the anchor over an equally-good compatible outsider — real
 *  mixing should win because it is a genuinely better or more varied pick, not because nothing
 *  favors staying put. Small enough that a meaningfully higher-quality or better-taxonomy-fit
 *  outsider still wins; large enough that two near-identical candidates don't flip on noise. */
const ANCHOR_AFFINITY_BONUS = 0.15;
/** How much a candidate's fingerprint compatibility with the anchor counts toward its rank on a
 *  mixable role, on top of `scoreSection`'s confidence/richness score. */
const MIX_COMPATIBILITY_WEIGHT = 0.35;

/** Ranks a mixable-role candidate for the combined (anchor + compatible-outsider) pool: the
 *  anchor's own sections get a flat affinity bonus (see `ANCHOR_AFFINITY_BONUS`); everything else is
 *  scored by how compatible its template's design fingerprint is with the anchor's. A candidate from
 *  a template with no recorded fingerprint (not yet backfilled) scores 0 compatibility — see
 *  `fingerprintCompatibility` — which `pick()` has already gated out of this pool entirely, so this
 *  branch only ever runs for candidates that already cleared the bar. */
function mixScore(
  section: IndexedSection,
  anchorTemplateId: string | undefined,
  anchorFingerprint: DesignFingerprint | undefined,
  taxonomyMatch: TaxonomyMatch | undefined
): number {
  const base = scoreSection(section);
  const taxonomyBonus = taxonomyMatch ? sectionTaxonomyAffinity(section, taxonomyMatch) * 0.1 : 0;
  if (anchorTemplateId && section.templateId === anchorTemplateId) {
    return base + taxonomyBonus + ANCHOR_AFFINITY_BONUS;
  }
  const compatibility = fingerprintCompatibility(anchorFingerprint, section.designFingerprint);
  return base + taxonomyBonus + compatibility * MIX_COMPATIBILITY_WEIGHT;
}

export async function selectSiteSections(options: SelectSiteOptions): Promise<SelectedSite> {
  const store = options.store ?? templateStore();
  const index = await store.index();
  const ready = index.sections;
  if (ready.length === 0) {
    throw new Error(
      "No ingested templates available. Run `npm run templates:ingest` over templates_bundle/ first."
    );
  }

  const history = options.history ?? new SectionHistoryStore();
  const previouslyUsed = new Set(
    options.consumerId ? await history.getUsed(options.consumerId) : []
  );
  const taxonomyMatch = options.brief ? classifyBriefTaxonomy(options.brief) : undefined;

  const seed = options.variationSeed;
  const slugs = options.pages ?? Object.keys(PAGE_ROLE_PLAN);
  const plannedRoles = [...new Set(slugs.flatMap(planForPage))];
  const requiredRoles = plannedRoles.filter((role) => !OPTIONAL_ROLES.has(role));

  // The hard gate. Everything below picks from `scope.poolFor(role)`, never from the raw index:
  // an out-of-vertical section is not a low-ranked candidate here, it is not a candidate.
  // See `taxonomy-scope.ts` for the tier ladder and why it descends the way it does.
  const scope = resolveTaxonomyScope(ready, taxonomyMatch, {
    requiredRoles,
    strict: strictTaxonomyScope(),
  });

  // Recolor forces every template onto the same target palette, but it only rewrites color
  // values — a decorative shape or photo with a light or dark tone baked into its own pixels
  // still reads that way afterward. Locking one theme for the whole site (not per page: nav and
  // footer are shared chrome, picked once) keeps sections drawn from an originally-light template
  // off a page otherwise built from originally-dark ones, on top of the shared color palette.
  //
  // The lock is read off the taxonomy-scoped pool, not the whole corpus, so it reflects what this
  // brief can actually be built from. Opposite-theme sections are never eligible. Sections with no
  // theme at all (ingested before the field existed, not yet backfilled) are the one concession:
  // they fill a role the locked theme has no candidate for, per role, rather than being dropped
  // corpus-wide — an un-backfilled corpus degrades to thinner constraint, not to empty pages.
  const compatibleWith = (theme: "light" | "dark") => (section: IndexedSection) =>
    !section.theme || section.theme === theme;

  const availableThemes = (["light", "dark"] as const).filter((theme) =>
    plannedRoles.some((role) => scope.poolFor(role).some((section) => section.theme === theme))
  );
  // Only a theme that still leaves every required role fillable may be locked in. Without this the
  // two hard constraints fight: the taxonomy scope reports nav and footer as covered, the theme
  // lock then removes the only candidates for them, and the page ships with no chrome at all.
  const viableThemes = availableThemes.filter((theme) =>
    requiredRoles.every((role) => scope.poolFor(role, compatibleWith(theme)).some(compatibleWith(theme)))
  );
  const lockedTheme = viableThemes.length > 0 ? pickFrom(seed, "site:theme", viableThemes) : undefined;

  const poolCache = new Map<SectionRole, IndexedSection[]>();
  const themedPoolFor = (role: SectionRole): IndexedSection[] => {
    const cached = poolCache.get(role);
    if (cached) return cached;
    // Widening is told about the theme lock, so a role whose own-industry candidates are all the
    // wrong theme descends a tier rather than coming back empty.
    const pool = lockedTheme ? scope.poolFor(role, compatibleWith(lockedTheme)) : scope.poolFor(role);
    // Within the tier: same-theme first, and only sections with no theme at all as a fallback.
    // A section whose origin theme is the opposite of the lock is never a candidate.
    const onTheme = lockedTheme ? pool.filter((section) => section.theme === lockedTheme) : pool;
    const resolved = onTheme.length > 0 ? onTheme : pool.filter((section) => !section.theme);
    poolCache.set(role, resolved);
    return resolved;
  };

  // Which template to build the site FROM. Coverage is counted over every planned role against
  // the already taxonomy+theme-scoped pools, so every candidate is always eligible on its own
  // terms — never a template that would have been filtered out anyway. Required roles
  // (nav/hero/footer) must be fully covered to qualify at all.
  //
  // Among qualifiers, the winner used to be whichever covered the most roles, full stop — ties
  // (rare: coverage is an integer count) got a seeded pick, everything else got none. That meant
  // "exploring" candidates almost never actually happened: two templates covering 6 vs. 7 roles
  // never got compared on anything else, even when the 6-role one had far better section quality
  // or a tighter taxonomy fit. Score every qualifier on three signals instead, shortlist everyone
  // within `anchorExploreBand()` of the top score, and seed-pick among THAT — real exploration on
  // every generation, not just on an exact-tie coin flip.
  const roleCoverage = new Map<string, Set<SectionRole>>();
  for (const role of plannedRoles) {
    for (const section of themedPoolFor(role)) {
      const covered = roleCoverage.get(section.templateId) ?? new Set<SectionRole>();
      covered.add(role);
      roleCoverage.set(section.templateId, covered);
    }
  }
  const fullyCoversRequired = (templateId: string): boolean =>
    requiredRoles.every((role) => roleCoverage.get(templateId)?.has(role));
  const qualifiers = [...roleCoverage.entries()].filter(([templateId]) => fullyCoversRequired(templateId));

  const excluded = new Set(options.excludeAnchorTemplateIds ?? []);
  const eligible = excluded.size > 0 ? qualifiers.filter(([templateId]) => !excluded.has(templateId)) : qualifiers;
  // A redo forcing a genuinely different anchor still needs SOME anchor if that was the only
  // qualifier — a worse-but-real anchor beats shipping with none at all.
  const candidates = eligible.length > 0 ? eligible : qualifiers;

  const scored: AnchorCandidateScore[] = candidates.map(([templateId, covered]) => {
    const coverageRatio = plannedRoles.length > 0 ? covered.size / plannedRoles.length : 0;
    const bestPerRole = [...covered].map((role) => {
      const sections = themedPoolFor(role).filter((section) => section.templateId === templateId);
      const quality = sections.length > 0 ? Math.max(...sections.map(scoreSection)) : 0;
      const taxonomyFit = taxonomyMatch
        ? sections.length > 0
          ? Math.max(...sections.map((section) => sectionTaxonomyAffinity(section, taxonomyMatch)))
          : 0
        : 0;
      return { quality, taxonomyFit };
    });
    const mean = (values: number[]) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0);
    return {
      templateId,
      coverage: covered.size,
      coverageRatio,
      quality: mean(bestPerRole.map((row) => row.quality)),
      taxonomyFit: mean(bestPerRole.map((row) => row.taxonomyFit)),
      score: 0, // filled in below once quality/taxonomyFit are normalized across all candidates
    };
  });

  const normalize = (values: number[]): number[] => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) return values.map(() => 1);
    return values.map((v) => (v - min) / (max - min));
  };
  const qualityNorm = normalize(scored.map((c) => c.quality));
  const taxonomyNorm = normalize(scored.map((c) => c.taxonomyFit));
  scored.forEach((c, i) => {
    c.score = 0.5 * c.coverageRatio + 0.3 * (qualityNorm[i] ?? 0) + 0.2 * (taxonomyNorm[i] ?? 0);
  });
  scored.sort((a, b) => b.score - a.score);

  const band = anchorExploreBand();
  const topScore = scored.length > 0 ? scored[0]!.score : 0;
  const shortlist = scored.filter((c) => c.score >= topScore - band).map((c) => c.templateId);
  const anchorTemplateId: string | undefined =
    shortlist.length > 0 ? pickFrom(seed, "site:anchor", shortlist) : undefined;
  const anchorCandidateReport = scored.map((c) => ({ templateId: c.templateId, score: c.score }));
  // Every section of a template carries the same fingerprint (duplicated at index time, same
  // pattern as `theme`/`category`) — any one of the anchor's sections in the raw, unscoped index
  // has it, regardless of whether the anchor has anything in a given role's THEMED pool.
  const anchorFingerprint: DesignFingerprint | undefined = anchorTemplateId
    ? ready.find((section) => section.templateId === anchorTemplateId)?.designFingerprint
    : undefined;
  const mixEnabled = templateMixEnabled();
  const mixThreshold = templateMixCompatibilityThreshold();

  const usedThisRun = new Set<string>();
  const templatesUsed = new Map<string, number>();
  const pages: Record<string, PlacedSection[]> = {};

  // Chrome is picked once per site: a nav that changes between pages reads as broken, not varied.
  const chrome = new Map<SectionRole, PlacedSection | null>();

  const byBestScore = (list: IndexedSection[]): IndexedSection[] => {
    if (list.length === 0) return list;
    const best = Math.max(...list.map(scoreSection));
    return list.filter((section) => scoreSection(section) >= best - 0.2);
  };

  /** Same shape as `byBestScore`, parameterized by whatever scoring function the caller ranks with
   *  (`scoreSection` for identity roles, `mixScore` for mixable ones). */
  const byBestOf = (list: IndexedSection[], scorer: (section: IndexedSection) => number): IndexedSection[] => {
    if (list.length === 0) return list;
    const best = Math.max(...list.map(scorer));
    return list.filter((section) => scorer(section) >= best - 0.2);
  };

  /** Splits `list` into unseen (never placed on this site, and not placed for this consumer on a
   *  previous run) / unused (never placed on THIS site, may repeat across a customer's history) /
   *  everything, in that preference order — the same "don't repeat yourself before you have to"
   *  tiering both identity and mixable roles rank within. */
  const preferenceTier = (list: IndexedSection[]): IndexedSection[] => {
    const unseen = list.filter(
      (section) => !usedThisRun.has(sectionKey(section)) && !previouslyUsed.has(sectionKey(section))
    );
    if (unseen.length > 0) return unseen;
    const unused = list.filter((section) => !usedThisRun.has(sectionKey(section)));
    return unused.length > 0 ? unused : list;
  };

  const pick = (role: SectionRole, key: string): PlacedSection | null => {
    const pool = themedPoolFor(role);
    if (pool.length === 0) return null;

    const place = (chosen: IndexedSection): PlacedSection => {
      usedThisRun.add(sectionKey(chosen));
      templatesUsed.set(chosen.templateId, (templatesUsed.get(chosen.templateId) ?? 0) + 1);
      return { templateId: chosen.templateId, sectionId: chosen.sectionId, role: chosen.role };
    };

    if (IDENTITY_ROLES.has(role)) {
      // The anchor supplies this role whenever it has ANYTHING classified for it — including a
      // section already placed on another page of this same site. A hero reused verbatim across
      // pages reads as one site; a hero borrowed from a different template per page reads as
      // broken, regardless of how compatible the two design languages measure. Only when the
      // anchor has nothing at all for this role does another template count.
      const anchorPool = anchorTemplateId ? pool.filter((section) => section.templateId === anchorTemplateId) : [];
      if (anchorPool.length > 0) {
        const chosen = pickFrom(seed, key, byBestScore(preferenceTier(anchorPool)));
        if (chosen) return place(chosen);
      }

      // No anchor, or the anchor has nothing for this role: best-fit candidate from the rest of the
      // pool. No "prefer a template not yet used" bias here — that bias is what used to fragment a
      // site across a dozen source templates in the first place.
      const rank = (list: IndexedSection[]): IndexedSection[] =>
        byBestScore(taxonomyMatch ? rankByTaxonomy(list, taxonomyMatch) : list);
      const chosen = pickFrom(seed, key, rank(preferenceTier(pool)));
      return chosen ? place(chosen) : null;
    }

    // Mixable role: rank the anchor's own candidates together with any OTHER template's candidates
    // whose design fingerprint clears the compatibility bar against the anchor's — real mixing,
    // bounded by "would this visibly clash" rather than "is there anything else at all". A
    // candidate below the bar is not a lower-ranked option here; it never enters the pool.
    const anchorPool = anchorTemplateId ? pool.filter((section) => section.templateId === anchorTemplateId) : [];
    const compatiblePool =
      mixEnabled && anchorTemplateId
        ? pool.filter(
            (section) =>
              section.templateId !== anchorTemplateId &&
              fingerprintCompatibility(anchorFingerprint, section.designFingerprint) >= mixThreshold
          )
        : [];
    // Neither the anchor nor anything compatible has a candidate here (a cold corpus with no
    // fingerprints backfilled yet, or an anchor genuinely uncovered for this role): fall back to
    // the full pool, unfiltered, exactly like the identity-role branch's own last resort — a
    // worse-but-real section beats an empty one.
    const combinedPool = anchorPool.length + compatiblePool.length > 0 ? [...anchorPool, ...compatiblePool] : pool;
    const scorer = (section: IndexedSection): number =>
      mixScore(section, anchorTemplateId, anchorFingerprint, taxonomyMatch);
    const chosen = pickFrom(seed, key, byBestOf(preferenceTier(combinedPool), scorer));
    return chosen ? place(chosen) : null;
  };

  for (const slug of slugs) {
    const plan = planForPage(slug);
    const placed: PlacedSection[] = [];
    for (const role of plan) {
      if (role === "nav" || role === "footer") {
        if (!chrome.has(role)) chrome.set(role, pick(role, `chrome:${role}`));
        const shared = chrome.get(role);
        if (shared) placed.push(shared);
        continue;
      }
      const section = pick(role, `${slug}:${role}:${hashString(slug)}`);
      if (section) placed.push(section);
      else if (!OPTIONAL_ROLES.has(role)) {
        // A page with no hero at all is worse than one built from an "other" section.
        const fallback = pick("other", `${slug}:${role}:fallback`);
        if (fallback) placed.push({ ...fallback, role });
      }
    }
    pages[slug] = placed;
  }

  if (options.consumerId) {
    await history.record(options.consumerId, [...usedThisRun]);
  }

  return {
    pages,
    templateIds: [...templatesUsed.keys()],
    ...(lockedTheme ? { theme: lockedTheme } : {}),
    ...(anchorTemplateId ? { anchorTemplateId } : {}),
    ...(anchorCandidateReport.length > 0 ? { anchorCandidates: anchorCandidateReport } : {}),
    ...(taxonomyMatch
      ? {
          taxonomy: {
            industry: taxonomyMatch.industry,
            category: taxonomyMatch.category,
            archetype: taxonomyMatch.archetype,
            tier: scope.tier,
            strict: scope.strict,
            widened: scope.widenedBeyondStrict,
          },
        }
      : {}),
  };
}
