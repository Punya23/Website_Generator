/**
 * Phase 3 (docs/PLACEMENTS_ORCHESTRATION_PLAN.md): "fail if output contains other curated demo
 * brands when brief name differs." `fill.ts`'s `swapTemplateBrandName` already substitutes each
 * template's own fictional brand into the real business's name — this is the check that catches it
 * NOT happening somewhere (a testimonial, a copyright line, an alt text) rather than trusting the
 * swap silently worked everywhere. A leak here means a real gap in `swapTemplateBrandName` or in a
 * new placement that should have gone through it, not something to just re-run and hope passes.
 *
 * The four names below are each template's own shipped brand (`real-estate/*\/placements.json`'s
 * `templateName`) — a fixed, small, hand-known set, same reasoning `real-estate-map.ts`'s own header
 * comment gives for treating these four templates as hand-mapped rather than heuristically scanned.
 */
import type { TemplateManifest } from "../types.js";
import type { TemplateStore } from "../store.js";

export const KNOWN_DEMO_BRAND_NAMES: readonly string[] = [
  "Prestige Realty",
  "Aurelia Estates",
  "Cornerstone Commercial Realty",
  "Harborview Property Management",
  // Logo text renders the brand as one run with no space (`.footer__logo`'s original content, e.g.
  // "PrestigeRealty") — checked too, since that's exactly the shape a nav/footer leak would take.
  "PrestigeRealty",
  "AureliaEstates",
  "CornerstoneCommercial Realty",
  "HarborviewPM",
];

export interface BrandLeak {
  brand: string;
  /** How many times `brand` appears in the checked HTML. */
  count: number;
}

/**
 * Scans `html` for any `KNOWN_DEMO_BRAND_NAMES` entry — excluding `ownBrandName` itself, so a real
 * business that happens to be named the same as a template's own demo brand is never flagged against
 * its own correct content. Case-sensitive: these are proper nouns, and a case-insensitive match risks
 * a false positive on ordinary text ("prestige", "cornerstone") that isn't a leak at all.
 *
 * Returns an empty array when the output is clean.
 */
export function checkBrandLeak(html: string, ownBrandName: string): BrandLeak[] {
  const own = ownBrandName.trim().toLowerCase();
  const leaks: BrandLeak[] = [];
  for (const brand of KNOWN_DEMO_BRAND_NAMES) {
    if (brand.toLowerCase() === own) continue;
    const count = html.split(brand).length - 1;
    if (count > 0) leaks.push({ brand, count });
  }
  return leaks;
}

/**
 * The corpus generalization of the check above (docs/PLACEMENTS_ORCHESTRATION_PLAN.md §7 Phase 3:
 * "corpus-side brand-leak detection ... needs a different, generic mechanism; still open"). A
 * hand-typed brand list works for 4 known templates; it cannot work for the ~900-template corpus,
 * where a composition draws from a handful of DIFFERENT source templates chosen fresh per site.
 *
 * No new ingestion metadata needed: `classify-section.ts` already records every `businessName`-kind
 * slot's ORIGINAL text (`SlotLocator.originalText`) for every section it locates — that IS each
 * template's own demo brand name, exactly as scraped, sitting in the manifest already. A leak is
 * that same string surviving somewhere OUTSIDE the slots ingestion classified (a testimonial quote,
 * an about-page paragraph, an `alt` attribute, a copyright line) — content compose's own copy-slot
 * pass never touches because it was never recognized as "the business name" in the first place.
 */
function templateOwnBrandNames(manifest: TemplateManifest): string[] {
  const names = new Set<string>();
  for (const section of manifest.sections) {
    for (const slot of section.slots) {
      if (slot.kind === "businessName" && slot.originalText.trim()) names.add(slot.originalText.trim());
    }
  }
  return [...names];
}

/** Every source template's own demo brand name(s), across a whole composition — computed once per
 *  site (not once per page) since the same handful of `templateIds` is checked against every page.
 *  `store.manifest` reads are cheap, cached JSON already on disk from ingestion; a template with no
 *  manifest (stale reference) is silently skipped, matching `from-corpus.ts`'s own tolerance for it. */
export async function collectTemplateBrandNames(templateIds: string[], store: TemplateStore): Promise<string[]> {
  const names = new Set<string>();
  for (const templateId of templateIds) {
    const manifest = await store.manifest(templateId);
    if (!manifest) continue;
    for (const name of templateOwnBrandNames(manifest)) names.add(name);
  }
  return [...names];
}

/** Same matching rule `checkBrandLeak` uses (case-sensitive proper-noun substring match, `ownBrandName`
 *  itself excluded so a business sharing a name with a source template's demo brand is never flagged
 *  against its own correct content) against an arbitrary, caller-supplied brand list — what
 *  `checkBrandLeak` is for the 4 curated templates' fixed list, this is for `collectTemplateBrandNames`'s
 *  per-composition one. Kept as a separate function from `checkBrandLeak` rather than a shared
 *  implementation the curated path also routes through, so that path's own tested behavior can't
 *  regress as a side effect of this addition. */
export function checkBrandLeakAgainst(html: string, brandNames: string[], ownBrandName: string): BrandLeak[] {
  const own = ownBrandName.trim().toLowerCase();
  const leaks: BrandLeak[] = [];
  for (const brand of brandNames) {
    if (brand.toLowerCase() === own) continue;
    const count = html.split(brand).length - 1;
    if (count > 0) leaks.push({ brand, count });
  }
  return leaks;
}
