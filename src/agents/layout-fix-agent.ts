/** Layout Fix Agent — surgical layoutPlan/chromeSpec patches from vision QA. */
import type { SiteContext, SiteLayoutPlan, SectionLayoutSpec, LayoutVariant } from "../types.js";
import type { VisionSectionFix } from "../qa/vision-router.js";
import { pipelineLog } from "../util/pipeline-log.js";

const VARIANT_CYCLE: LayoutVariant[] = [
  "default",
  "full-bleed-left",
  "centered-stack",
  "split-offset",
  "band-compact",
  "band-wide",
];

function nextVariant(current: LayoutVariant): LayoutVariant {
  const idx = VARIANT_CYCLE.indexOf(current);
  return VARIANT_CYCLE[(idx + 1) % VARIANT_CYCLE.length] ?? "split-offset";
}

function bumpDensity(density?: SectionLayoutSpec["density"]): SectionLayoutSpec["density"] {
  if (density === "airy") return "normal";
  if (density === "normal") return "compact";
  return "normal";
}

export function applyLayoutFixes(
  ctx: SiteContext,
  layoutSections: VisionSectionFix[]
): SiteContext {
  if (!ctx.layoutPlan) {
    ctx.layoutPlan = { sections: {} };
  }

  const plan: SiteLayoutPlan = {
    sections: { ...ctx.layoutPlan.sections },
  };

  for (const fix of layoutSections) {
    const existing = plan.sections[fix.sectionId] ?? { variant: "default" as LayoutVariant };
    const suggestion = (fix.suggestion ?? "").toLowerCase();

    let variant = existing.variant;
    let density = existing.density;

    if (suggestion.includes("center")) {
      variant = "centered-stack";
    } else if (suggestion.includes("wide") || suggestion.includes("bleed")) {
      variant = "band-wide";
    } else if (suggestion.includes("compact") || suggestion.includes("cramped")) {
      variant = existing.variant === "default" ? "band-compact" : existing.variant;
      density = bumpDensity(existing.density);
    } else if (suggestion.includes("split") || suggestion.includes("offset")) {
      variant = "split-offset";
    } else {
      variant = nextVariant(existing.variant);
      density = bumpDensity(existing.density);
    }

    plan.sections[fix.sectionId] = {
      ...existing,
      variant,
      density,
    };
    pipelineLog(`[pipeline] Layout fix ${fix.sectionId}: ${existing.variant} → ${variant}`);
  }

  if (layoutSections.length > 0 && ctx.chromeSpec) {
    ctx.chromeSpec = {
      ...ctx.chromeSpec,
      footer: {
        ...ctx.chromeSpec.footer,
        layout: ctx.chromeSpec.footer.layout === "centered" ? "two-column" : ctx.chromeSpec.footer.layout,
      },
    };
  }

  ctx.layoutPlan = plan;
  return ctx;
}

export function layoutSpecToProps(spec: SectionLayoutSpec): Record<string, unknown> {
  return {
    layoutVariant: spec.variant,
    density: spec.density,
    mediaPosition: spec.mediaPosition,
  };
}
