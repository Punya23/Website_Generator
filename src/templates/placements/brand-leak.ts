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
