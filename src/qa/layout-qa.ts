import type { PageBlueprint, SiteLayoutPlan, SectionLayoutSpec } from "../types.js";
import type { QAIssue, QAResult } from "../types.js";
import { pickFrom } from "../design/variation.js";

const HERO_TEMPLATES = new Set([
  "hero_editorial",
  "hero_split_cinematic",
  "hero_video",
  "hero_spotlight",
]);

const HERO_LAYOUT_VARIANTS = ["full-bleed-left", "split-offset", "centered-stack"] as const;

export function runLayoutQA(
  plan: SiteLayoutPlan,
  blueprints: PageBlueprint[]
): QAResult {
  const issues: QAIssue[] = [];

  for (const bp of blueprints) {
    let run = 0;
    let lastVariant = "";
    for (const s of bp.sections) {
      const spec = plan.sections[s.id];
      if (!spec) {
        issues.push({
          severity: "hard",
          code: "MISSING_LAYOUT_SPEC",
          message: `No layout spec for section ${s.id}`,
          sectionId: s.id,
        });
        continue;
      }

      if (spec.variant === lastVariant) run++;
      else {
        run = 1;
        lastVariant = spec.variant;
      }
      if (run >= 4) {
        issues.push({
          severity: "hard",
          code: "LAYOUT_MONOTONY",
          message: `4+ consecutive "${spec.variant}" layouts on ${bp.slug}`,
          sectionId: s.id,
        });
      }

      if (spec.variant === "split-offset" && !HERO_TEMPLATES.has(s.templateId)) {
        issues.push({
          severity: "hard",
          code: "SPLIT_OFFSET_NON_HERO",
          message: `split-offset on non-hero ${s.templateId}`,
          sectionId: s.id,
        });
      }
    }
  }

  const hard = issues.filter((i) => i.severity === "hard");
  return { passed: hard.length === 0, issues };
}

export function defaultLayoutForTemplate(
  templateId: string,
  isEditorial: boolean,
  variationSeed?: number
): SectionLayoutSpec {
  if (templateId === "hero_spotlight") {
    const variant =
      variationSeed !== undefined
        ? pickFrom(variationSeed, "hero_spotlight", [...HERO_LAYOUT_VARIANTS])
        : isEditorial
          ? "split-offset"
          : "full-bleed-left";
    return {
      variant,
      density: isEditorial ? "airy" : "normal",
      mediaPosition: "right",
    };
  }
  if (templateId === "hero_editorial") {
    const variant =
      variationSeed !== undefined
        ? pickFrom(variationSeed, "hero_editorial", [...HERO_LAYOUT_VARIANTS])
        : isEditorial
          ? "full-bleed-left"
          : "default";
    return {
      variant,
      density: isEditorial ? "airy" : "normal",
      mediaPosition: "background",
    };
  }
  if (templateId === "hero_split_cinematic") {
    const positions = ["left", "right"] as const;
    return {
      variant: "default",
      density: "normal",
      mediaPosition:
        variationSeed !== undefined
          ? pickFrom(variationSeed, "hero_split", [...positions])
          : "right",
    };
  }
  if (templateId === "cta_band") {
    return {
      variant: isEditorial ? "band-wide" : "default",
      density: "normal",
    };
  }
  if (templateId === "footer_cta") {
    return {
      variant: isEditorial ? "band-wide" : "default",
      density: isEditorial ? "airy" : "normal",
    };
  }
  if (templateId === "text_marquee") {
    return { variant: "default", density: "compact" };
  }
  return { variant: "default", density: "normal" };
}
