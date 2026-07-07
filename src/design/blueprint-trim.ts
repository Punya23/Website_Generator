import type { PageBlueprint, SiteContext } from "../types.js";
import { pickFrom } from "./variation.js";
import { extractBriefIntent, contentFocusBoost, type BriefIntent } from "./brief-intent.js";
import { isTemplateRelevant } from "./template-relevance.js";
import type { VerticalProfileId } from "./vertical-profiles.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { homeSectionBudget } from "../llm/pipeline-speed.js";

export const HOME_SECTION_BUDGET = { min: 5, max: 6 } as const;

const CONVERSION_TEMPLATES = new Set(["cta_band", "footer_cta", "newsletter_band"]);
const PRICING_TEMPLATES = new Set(["pricing_toggle", "pricing_tiers"]);
const HERO_PREFIX = "hero_";

const PROOF_TEMPLATES = new Set([
  "testimonial_carousel",
  "testimonial_featured",
  "stats_animated",
  "stats_marquee",
  "before_after",
  "logo_marquee",
]);

const LOW_PRIORITY_TEMPLATES = new Set([
  "text_marquee",
  "newsletter_band",
  "logo_marquee",
]);

function pickPageCloser(profileId: VerticalProfileId, seed: number): "cta_band" | "footer_cta" {
  const editorial = profileId === "luxury-dark" || profileId === "editorial-light";
  if (editorial) {
    return pickFrom(seed, "page-closer", ["footer_cta", "cta_band"] as const);
  }
  return pickFrom(seed, "page-closer", ["cta_band", "footer_cta"] as const);
}

function isHero(templateId: string): boolean {
  return templateId.startsWith(HERO_PREFIX);
}

function dropPricingUnlessRelevant(
  sections: PageBlueprint["sections"],
  intent: BriefIntent
): PageBlueprint["sections"] {
  if (intent.pricing) return sections;
  return sections.filter((s) => !PRICING_TEMPLATES.has(s.templateId));
}

function dropIrrelevantByIntent(
  sections: PageBlueprint["sections"],
  intent: BriefIntent
): PageBlueprint["sections"] {
  return sections.filter((s) => isTemplateRelevant(s.templateId, intent));
}

function ensureMinSections(
  sections: PageBlueprint["sections"],
  slug: string,
  ctx: SiteContext
): PageBlueprint["sections"] {
  if (sections.length >= 2) return sections;

  const pageGoal = ctx.sitePlan.pages.find((p) => p.slug === slug)?.goal ?? "Welcome";
  const filler: PageBlueprint["sections"][number] = {
    id: `${slug}_s0_introstatement`,
    templateId: "intro_statement",
    intent: pageGoal,
  };

  if (sections.length === 0) {
    return [
      filler,
      {
        id: `${slug}_s1_ctaband`,
        templateId: "cta_band",
        intent: ctx.expandedBrief.primaryCta,
      },
    ];
  }

  const hasCloser = sections.some((s) => CONVERSION_TEMPLATES.has(s.templateId));
  if (hasCloser) {
    pipelineLog(`[pipeline] Injected intro_statement on ${slug} (trim left <2 sections)`);
    return [filler, ...sections];
  }

  pipelineLog(`[pipeline] Injected intro_statement + cta_band on ${slug} (trim left <2 sections)`);
  return [
    filler,
    ...sections,
    {
      id: `${slug}_s${sections.length + 1}_ctaband`,
      templateId: "cta_band",
      intent: ctx.expandedBrief.primaryCta,
    },
  ];
}

function dedupeConversionSections(
  sections: PageBlueprint["sections"],
  closer: "cta_band" | "footer_cta"
): PageBlueprint["sections"] {
  const conversionIndices: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    if (CONVERSION_TEMPLATES.has(sections[i]!.templateId)) {
      conversionIndices.push(i);
    }
  }
  if (conversionIndices.length <= 1) return sections;

  // Keep exactly one conversion closer — prefer the profile's chosen closer type.
  let keepIdx = conversionIndices.find((i) => sections[i]!.templateId === closer);
  if (keepIdx === undefined) {
    keepIdx = conversionIndices[conversionIndices.length - 1]!;
  }

  const toRemove = new Set(conversionIndices.filter((i) => i !== keepIdx));
  return sections.filter((_, i) => !toRemove.has(i));
}

function sectionPriority(
  section: PageBlueprint["sections"][number],
  contentFocus: string[]
): number {
  if (isHero(section.templateId)) return 100;
  if (CONVERSION_TEMPLATES.has(section.templateId)) return 95;
  if (PRICING_TEMPLATES.has(section.templateId)) return 40;
  if (PROOF_TEMPLATES.has(section.templateId)) return 70;
  if (LOW_PRIORITY_TEMPLATES.has(section.templateId)) return 20;
  return 50 + contentFocusBoost(section.templateId, contentFocus);
}

function compressHomeToBudget(
  sections: PageBlueprint["sections"],
  ctx: SiteContext
): PageBlueprint["sections"] {
  const { max } = homeSectionBudget();
  if (sections.length <= max) return sections;

  const contentFocus =
    ctx.sitePlan.pages.find((p) => p.slug === "home")?.contentFocus ?? [];

  const hero = sections.filter((s) => isHero(s.templateId));
  const closers = sections.filter((s) => CONVERSION_TEMPLATES.has(s.templateId));
  const middle = sections.filter(
    (s) => !isHero(s.templateId) && !CONVERSION_TEMPLATES.has(s.templateId)
  );

  const sortedMiddle = [...middle].sort(
    (a, b) => sectionPriority(b, contentFocus) - sectionPriority(a, contentFocus)
  );

  const carouselTypes = new Set<string>();
  const pickedMiddle: typeof middle = [];
  for (const s of sortedMiddle) {
    if (pickedMiddle.length >= max - hero.length - 1) break;
    const isCarousel = s.templateId.includes("carousel");
    if (isCarousel) {
      if (carouselTypes.has("carousel")) continue;
      carouselTypes.add("carousel");
    }
    pickedMiddle.push(s);
  }

  pickedMiddle.sort((a, b) => sections.indexOf(a) - sections.indexOf(b));

  const closer =
    closers.find((s) => s.templateId === "cta_band" || s.templateId === "footer_cta") ??
    closers[closers.length - 1];

  const out = [...hero, ...pickedMiddle];
  if (closer) out.push(closer);
  return out.slice(0, max);
}

export function trimBlueprint(bp: PageBlueprint, ctx: SiteContext): PageBlueprint {
  const intent = extractBriefIntent(ctx);
  const profileId = (ctx.verticalProfile?.profileId ?? "corporate-light") as VerticalProfileId;
  const seed = ctx.variationSeed ?? Date.now();
  const closer = pickPageCloser(profileId, seed);

  let sections = [...bp.sections];
  sections = dropPricingUnlessRelevant(sections, intent);
  sections = dropIrrelevantByIntent(sections, intent);
  sections = dedupeConversionSections(sections, closer);

  if (bp.slug === "home") {
    sections = compressHomeToBudget(sections, ctx);
    sections = dedupeConversionSections(sections, closer);
  } else {
    sections = dedupeConversionSections(sections, closer);
  }

  sections = ensureMinSections(sections, bp.slug, ctx);

  return {
    ...bp,
    sections: sections.map((s, i) => ({
      ...s,
      id: `${bp.slug}_s${i}_${s.templateId.replace(/_/g, "")}`,
    })),
  };
}

export function trimBlueprints(blueprints: PageBlueprint[], ctx: SiteContext): PageBlueprint[] {
  return blueprints.map((bp) => trimBlueprint(bp, ctx));
}
