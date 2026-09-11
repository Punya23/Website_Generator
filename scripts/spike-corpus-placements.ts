/**
 * Phase 2A spike (docs/PLACEMENTS_ORCHESTRATION_PLAN.md rev 2).
 *
 * Question the plan needs answered before wiring the orchestrator: `from-corpus.ts` synthesises
 * placement selectors from `SlotLocator.selector` / `PhotoSlot.selector`, both of which were
 * recorded at ingest time against a section's OWN cached fragment. Production compose wraps every
 * section in `[data-tpl]` and namespaces ids. Do those selectors still resolve on the composed
 * page, or only on the raw fragment?
 *
 * Measures three things:
 *   1. Selector hit rate on the COMPOSED page (plan option B) vs the RAW fragment (control).
 *   2. Constraint tightness — corpus `genericProseConstraints` vs the hand-mapped real-estate map.
 *   3. Photo fill policy — how many photos in people sections (team/testimonials) become llmQuery.
 *
 * No LLM calls: every `llm` placement gets a deterministic dummy value, every `llmQuery` image a
 * dummy URL. We are measuring selector resolution, not copy quality.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { selectSiteSections } from "../src/templates/select.js";
import { composeSite } from "../src/templates/compose.js";
import { templateStore } from "../src/templates/store.js";
import { templateCachePath } from "../src/templates/ingest/ingest-template.js";
import { buildPlacementsFromSelection } from "../src/templates/placements/from-corpus.js";
import { applyPlacements } from "../src/templates/placements/fill.js";
import { extractRealEstateTemplate } from "../src/templates/placements/extract.js";
import type { ExpandedBrief } from "../src/types.js";
import type { PagePlacements, PlacementsFile, TextPlacement } from "../src/templates/placements/schema.js";
import type { PlacedSection } from "../src/templates/types.js";

const RAW_BRIEF =
  "Harbor Homes is a boutique residential brokerage in Alameda, CA, helping first-time buyers and downsizers.";

const BRIEF: ExpandedBrief = {
  businessName: "Harbor Homes",
  tagline: "Bay Area homes, handled personally",
  elevatorPitch: "A boutique residential brokerage in Alameda serving first-time buyers and downsizers.",
  expandedBrief: RAW_BRIEF,
  targetAudience: "First-time buyers and downsizers in Alameda and the East Bay",
  services: ["Buyer representation", "Listing and staging", "Relocation guidance", "Market valuation"],
  differentiators: ["Boutique caseload", "Alameda-native agents", "Transparent fee structure"],
  tone: "warm, direct, local",
  primaryCta: "Book a consultation",
  secondaryCta: "Browse listings",
};

const PAGES = ["home", "about", "services", "contact"];

/** Every non-fixed text placement gets a dummy of a length its own constraints accept, so a skip
 *  can only ever mean "selector did not resolve" — never "value rejected by the clamp". */
function dummyValues(page: PagePlacements): Record<string, string> {
  const values: Record<string, string> = {};
  for (const placement of page.text) {
    if (placement.fillSource !== "llm") continue;
    const min = placement.constraints.minChars ?? 1;
    values[placement.id] = "x".repeat(Math.max(min, 3));
  }
  for (const image of page.images) {
    values[image.id] = "https://example.invalid/spike.jpg";
  }
  return values;
}

interface HitRate {
  applied: number;
  skipped: number;
  skippedIds: string[];
}

function rate(h: HitRate): string {
  const total = h.applied + h.skipped;
  return total === 0 ? "n/a" : `${((h.applied / total) * 100).toFixed(1)}% (${h.applied}/${total})`;
}

async function measureComposed(html: string, page: PagePlacements): Promise<HitRate> {
  const result = await applyPlacements(html, page, {
    brief: { businessName: BRIEF.businessName },
    llmValues: dummyValues(page),
  });
  return {
    applied: result.appliedText + result.appliedImages,
    skipped: result.skipped.length,
    skippedIds: result.skipped,
  };
}

/** Control: apply each section's own placement subset against that section's cached fragment —
 *  the exact HTML the selectors were recorded against. Isolates compose-time damage. */
async function measureRaw(placed: PlacedSection[], page: PagePlacements): Promise<HitRate> {
  const store = templateStore();
  let applied = 0;
  const skippedIds: string[] = [];

  for (const section of placed) {
    const manifest = await store.manifest(section.templateId);
    const meta = manifest?.sections.find((s) => s.id === section.sectionId);
    if (!meta) continue;

    let fragment = "";
    try {
      fragment = await fs.readFile(path.join(templateCachePath(section.templateId), meta.htmlCachePath), "utf8");
    } catch {
      continue; // fragment gone from cache — not a selector failure, exclude from the control
    }

    const key = `${section.templateId}:${section.sectionId}`;
    const subset: PagePlacements = {
      page: page.page,
      text: page.text.filter((t) => t.section === key),
      images: page.images.filter((i) => i.section === key),
    };
    if (subset.text.length === 0 && subset.images.length === 0) continue;

    const result = await applyPlacements(fragment, subset, {
      brief: { businessName: BRIEF.businessName },
      llmValues: dummyValues(subset),
    });
    applied += result.appliedText + result.appliedImages;
    skippedIds.push(...result.skipped);
  }

  return { applied, skipped: skippedIds.length, skippedIds };
}

function charBudgetStats(placements: TextPlacement[], label: string): string {
  const prose = placements.filter((p) => p.fillSource === "llm" && p.constraints.maxChars);
  if (prose.length === 0) return `${label}: no llm placements with maxChars`;
  const maxes = prose.map((p) => p.constraints.maxChars!).sort((a, b) => a - b);
  const ratios = prose
    .filter((p) => p.original.length > 0)
    .map((p) => p.constraints.maxChars! / p.original.length);
  const median = maxes[Math.floor(maxes.length / 2)];
  const meanRatio = ratios.reduce((sum, r) => sum + r, 0) / (ratios.length || 1);
  return `${label}: n=${prose.length} maxChars min=${maxes[0]} median=${median} max=${maxes[maxes.length - 1]} | mean(maxChars/original)=${meanRatio.toFixed(2)}`;
}

function peoplePhotoPolicy(file: PlacementsFile, placedByPage: Record<string, PlacedSection[]>): string {
  const peopleSections = new Set<string>();
  for (const placed of Object.values(placedByPage)) {
    for (const section of placed) {
      if (section.role === "team" || section.role === "testimonials") {
        peopleSections.add(`${section.templateId}:${section.sectionId}`);
      }
    }
  }
  let peoplePhotos = 0;
  let peopleLlmQuery = 0;
  let peopleTextFixed = 0;
  let peopleTextTotal = 0;
  for (const page of Object.values(file.pages)) {
    for (const image of page.images) {
      if (!peopleSections.has(image.section)) continue;
      peoplePhotos += 1;
      if (image.fillSource === "llmQuery") peopleLlmQuery += 1;
    }
    for (const text of page.text) {
      if (!peopleSections.has(text.section)) continue;
      peopleTextTotal += 1;
      if (text.fillSource === "fixed") peopleTextFixed += 1;
    }
  }
  return `people sections=${peopleSections.size} | text locked fixed=${peopleTextFixed}/${peopleTextTotal} | photos llmQuery=${peopleLlmQuery}/${peoplePhotos}`;
}

async function main(): Promise<void> {
  console.log("=== Phase 2A spike: corpus placements vs composed HTML ===\n");

  const selected = await selectSiteSections({ brief: BRIEF, variationSeed: "spike-2a", pages: PAGES });
  console.log(
    `select: anchor=${selected.anchorTemplateId ?? "none"} templates=${selected.templateIds.length} theme=${selected.theme ?? "none"}`
  );
  for (const [slug, sections] of Object.entries(selected.pages)) {
    console.log(`  ${slug}: ${sections.map((s) => s.role).join(", ")}`);
  }

  const file = await buildPlacementsFromSelection(selected, templateStore(), {
    templateId: selected.anchorTemplateId ?? "spike",
    templateName: "Corpus composition",
    vertical: "real estate",
  });
  const totalText = Object.values(file.pages).reduce((n, p) => n + p.text.length, 0);
  const totalImages = Object.values(file.pages).reduce((n, p) => n + p.images.length, 0);
  console.log(`\nplacements: text=${totalText} images=${totalImages}`);

  const composed = await composeSite({
    brief: BRIEF,
    rawBrief: RAW_BRIEF,
    pages: selected.pages,
    anchorTemplateId: selected.anchorTemplateId,
  });
  console.log(
    `compose: pages=${Object.keys(composed.htmlPages).length} slotsApplied=${composed.stats.slotsApplied} slotsSkipped=${composed.stats.slotsSkipped} selectorErrors=${composed.stats.selectorErrors}`
  );

  console.log("\n--- 1. selector hit rate ---");
  const composedTotal: HitRate = { applied: 0, skipped: 0, skippedIds: [] };
  const rawTotal: HitRate = { applied: 0, skipped: 0, skippedIds: [] };

  for (const slug of Object.keys(file.pages)) {
    const page = file.pages[slug]!;
    const html = composed.htmlPages[slug];
    if (!html) {
      console.log(`  ${slug}: no composed HTML — skipped`);
      continue;
    }
    const onComposed = await measureComposed(html, page);
    const onRaw = await measureRaw(selected.pages[slug] ?? [], page);
    console.log(`  ${slug}: composed ${rate(onComposed)} | raw fragment ${rate(onRaw)}`);
    if (onComposed.skippedIds.length > 0) console.log(`      skipped ids: ${onComposed.skippedIds.join(", ")}`);

    // Same measurement with chrome (nav/footer) sections excluded — compose deliberately rebuilds
    // both (`rewriteNavLinks`, logo→wordmark in copy-slots), so their slots are not template-owned
    // copy any more. This is the number that matters if placements skips chrome.
    const chromeKeys = new Set(
      (selected.pages[slug] ?? [])
        .filter((s) => s.role === "nav" || s.role === "footer")
        .map((s) => `${s.templateId}:${s.sectionId}`)
    );
    const bodyOnly: PagePlacements = {
      page: page.page,
      text: page.text.filter((t) => !chromeKeys.has(t.section)),
      images: page.images.filter((i) => !chromeKeys.has(i.section)),
    };
    const onBody = await measureComposed(html, bodyOnly);
    console.log(`      body-only (chrome excluded): ${rate(onBody)}`);

    composedTotal.applied += onComposed.applied;
    composedTotal.skipped += onComposed.skipped;
    composedTotal.skippedIds.push(...onComposed.skippedIds);
    rawTotal.applied += onRaw.applied;
    rawTotal.skipped += onRaw.skipped;
    rawTotal.skippedIds.push(...onRaw.skippedIds);
  }

  console.log(`\n  TOTAL composed: ${rate(composedTotal)}`);
  console.log(`  TOTAL raw:      ${rate(rawTotal)}`);
  if (composedTotal.skippedIds.length > 0) {
    const byRole = new Map<string, number>();
    for (const id of composedTotal.skippedIds) {
      const role = id.split(".").slice(1).join(".") || id;
      byRole.set(role, (byRole.get(role) ?? 0) + 1);
    }
    const top = [...byRole.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`  top skipped slot kinds on composed: ${top.map(([r, n]) => `${r}=${n}`).join(" ")}`);
  }

  console.log("\n--- 2. constraint tightness (corpus vs hand map) ---");
  const corpusText = Object.values(file.pages).flatMap((p) => p.text);
  console.log(`  ${charBudgetStats(corpusText, "corpus (genericProseConstraints)")}`);
  try {
    const handMap = await extractRealEstateTemplate(
      path.resolve(process.cwd(), "real-estate", "real-estate-agency"),
      "real-estate-agency"
    );
    const handText = Object.values(handMap.pages).flatMap((p) => p.text);
    console.log(`  ${charBudgetStats(handText, "hand map (measure.ts)          ")}`);
  } catch (err) {
    console.log(`  hand map: unavailable (${(err as Error).message})`);
  }

  console.log("\n--- 3. people-section fill policy ---");
  console.log(`  this selection: ${peoplePhotoPolicy(file, selected.pages)}`);
  await peopleRichPass();
}

/** The selection above happened to land on an anchor with no team/testimonials, so the people
 *  policy went untested. Force it with the same people-rich corpus template the existing bridge
 *  test pins, composed the same way. */
const PEOPLE_TEMPLATE_ID = "tpl_0050107a0d3b"; // pinned by tests/placements-corpus-bridge.test.ts

async function peopleRichPass(): Promise<void> {
  const manifest = await templateStore().manifest(PEOPLE_TEMPLATE_ID);
  if (!manifest) {
    console.log(`  people-rich pass: ${PEOPLE_TEMPLATE_ID} not in this cache — skipped`);
    return;
  }
  const wanted = ["nav", "hero", "testimonials", "team", "footer"] as const;
  const placed: PlacedSection[] = wanted
    .map((role) => manifest.sections.find((s) => s.role === role))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ templateId: manifest.templateId, sectionId: s.id, role: s.role }));

  const pages = { home: placed };
  const peopleFile = await buildPlacementsFromSelection({ pages }, templateStore(), {
    templateId: manifest.templateId,
    templateName: manifest.name,
    vertical: manifest.industry ?? "general",
  });
  console.log(`  people-rich (${manifest.name}): roles=${placed.map((s) => s.role).join(", ")}`);
  console.log(`  ${peoplePhotoPolicy(peopleFile, pages)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
