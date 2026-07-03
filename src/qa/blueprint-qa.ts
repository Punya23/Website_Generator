import type { PageBlueprint, SiteContext } from "../types.js";
import type { QAIssue, QAResult } from "../types.js";
import { getTemplate } from "../section-templates/registry.js";
import { extractBriefIntent } from "../design/brief-intent.js";
import { homeSectionBudget } from "../llm/pipeline-speed.js";

const HERO_PREFIX = "hero_";
const PREMIUM_TEMPLATES = new Set(["hero_spotlight", "scroll_showcase", "horizontal_gallery"]);
const CONVERSION_TEMPLATES = new Set(["cta_band", "footer_cta", "newsletter_band"]);
const PRICING_TEMPLATES = new Set(["pricing_toggle", "pricing_tiers"]);

const MOTION_HEAVY = new Set([
  "hero_spotlight",
  "scroll_showcase",
  "horizontal_gallery",
  "text_marquee",
  "stats_marquee",
  "hero_video",
]);

export function runBlueprintQA(
  blueprints: PageBlueprint[],
  ctx: SiteContext
): QAResult {
  const issues: QAIssue[] = [];

  for (const bp of blueprints) {
    if (bp.sections.length < 2) {
      issues.push({
        severity: "hard",
        code: "BLUEPRINT_TOO_SHORT",
        message: `Page ${bp.slug} has fewer than 2 sections`,
      });
      continue;
    }

    for (const s of bp.sections) {
      if (!getTemplate(s.templateId)) {
        issues.push({
          severity: "hard",
          code: "UNKNOWN_TEMPLATE",
          message: `Unknown template ${s.templateId} on ${bp.slug}`,
          sectionId: s.id,
        });
      }
    }

    if (bp.slug === "home" && !bp.sections[0]?.templateId.startsWith(HERO_PREFIX)) {
      issues.push({
        severity: "hard",
        code: "HOME_MISSING_HERO",
        message: "Home page must start with a hero_* template",
        sectionId: bp.sections[0]?.id,
      });
    }

    let run = 0;
    let last = "";
    for (const s of bp.sections) {
      if (s.templateId === last) run++;
      else {
        run = 1;
        last = s.templateId;
      }
      if (run >= 4) {
        issues.push({
          severity: "hard",
          code: "BLUEPRINT_MONOTONY",
          message: `4+ consecutive "${s.templateId}" on ${bp.slug}`,
          sectionId: s.id,
        });
      }
    }

    const conversionBands = bp.sections.filter((s) =>
      ["cta_band", "footer_cta"].includes(s.templateId)
    );
    if (conversionBands.length > 1) {
      issues.push({
        severity: "hard",
        code: "DUPLICATE_CTA_CLOSER",
        message: `${bp.slug} has ${conversionBands.length} CTA closers (max 1)`,
      });
    }

    for (let i = 0; i < bp.sections.length - 1; i++) {
      const a = bp.sections[i]!.templateId;
      const b = bp.sections[i + 1]!.templateId;
      if (
        (a === "footer_cta" && b === "cta_band") ||
        (a === "cta_band" && b === "footer_cta")
      ) {
        issues.push({
          severity: "hard",
          code: "ADJACENT_CTA_BANDS",
          message: `Adjacent footer_cta + cta_band on ${bp.slug}`,
          sectionId: bp.sections[i + 1]!.id,
        });
      }
    }

    const lastTwo = bp.sections.slice(-2);
    const conversionInTail = lastTwo.filter((s) => CONVERSION_TEMPLATES.has(s.templateId));
    if (conversionInTail.length > 1) {
      issues.push({
        severity: "hard",
        code: "STACKED_CONVERSION_BANDS",
        message: `${bp.slug} has ${conversionInTail.length} conversion bands in last 2 slots`,
      });
    }

    const lastSection = bp.sections[bp.sections.length - 1];
    const hasCloser = bp.sections.some((s) =>
      ["cta_band", "footer_cta"].includes(s.templateId)
    );
    if (bp.slug !== "contact" && lastSection && !hasCloser) {
      issues.push({
        severity: "soft",
        code: "MISSING_CTA_CLOSE",
        message: `${bp.slug} has no CTA closer (cta_band or footer_cta)`,
      });
    }

    const intent = extractBriefIntent(ctx);
    for (const s of bp.sections) {
      if (PRICING_TEMPLATES.has(s.templateId) && !intent.pricing) {
        issues.push({
          severity: "soft",
          code: "PRICING_WITHOUT_INTENT",
          message: `${s.templateId} on ${bp.slug} without pricing intent in brief`,
          sectionId: s.id,
        });
      }
    }

    if (bp.slug === "home") {
      const budget = homeSectionBudget();
      const count = bp.sections.length;
      if (count < budget.min || count > budget.max) {
        issues.push({
          severity: "soft",
          code: "HOME_SECTION_BUDGET",
          message: `Home has ${count} sections (target ${budget.min}–${budget.max})`,
        });
      }
    }

    const profile = ctx.verticalProfile?.profileId;
    if (profile === "clinical-light" && bp.slug === "home") {
      const hasTrust =
        bp.sections.some((s) =>
          ["stats_animated", "stats_marquee", "testimonial_carousel", "before_after"].includes(
            s.templateId
          )
        );
      if (!hasTrust) {
        issues.push({
          severity: "soft",
          code: "CLINICAL_MISSING_TRUST",
          message: "Clinical home should include stats or testimonial proof",
        });
      }
    }

    if (bp.slug === "home") {
      const hasPremium = bp.sections.some((s) => PREMIUM_TEMPLATES.has(s.templateId));
      const hasMotion = bp.sections.some((s) => MOTION_HEAVY.has(s.templateId));
      if (!hasPremium) {
        issues.push({
          severity: "soft",
          code: "HOME_MISSING_PREMIUM",
          message: "Home should include at least one immersive premium section",
        });
      }
      if (!hasMotion) {
        issues.push({
          severity: "soft",
          code: "HOME_MISSING_MOTION",
          message: "Home should include at least one motion-heavy section",
        });
      }
    }

    if (profile === "luxury-dark" && bp.slug === "home") {
      const hasSpotlight = bp.sections.some((s) =>
        ["hero_spotlight", "hero_video"].includes(s.templateId)
      );
      if (!hasSpotlight) {
        issues.push({
          severity: "soft",
          code: "LUXURY_MISSING_SPOTLIGHT",
          message: "Luxury home should open with hero_spotlight or hero_video",
        });
      }
    }

    if (profile === "editorial-light" && bp.slug === "home") {
      const hasGallery = bp.sections.some((s) =>
        ["horizontal_gallery", "gallery_masonry", "scroll_showcase"].includes(s.templateId)
      );
      if (!hasGallery) {
        issues.push({
          severity: "soft",
          code: "EDITORIAL_MISSING_GALLERY",
          message: "Editorial home should include a gallery or scroll showcase",
        });
      }
    }
  }

  const hard = issues.filter((i) => i.severity === "hard");
  return { passed: hard.length === 0, issues };
}
