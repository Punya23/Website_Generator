/** Layout Director — per-section layout variants and density only. */
import type { PageBlueprint, SiteContext, SiteLayoutPlan, SectionLayoutSpec, LayoutVariant } from "../types.js";
import { SiteLayoutPlanSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { defaultLayoutForTemplate } from "../qa/layout-qa.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import {
  unwrapAgentPayload,
} from "./contracts/index.js";

const HERO_TEMPLATES = new Set([
  "hero_editorial",
  "hero_split_cinematic",
  "hero_video",
  "hero_spotlight",
]);
const HERO_ONLY_VARIANTS = new Set(["full-bleed-left", "split-offset"]);

function sanitizeLayoutPlan(
  plan: SiteLayoutPlan,
  ctx: SiteContext,
  blueprints: PageBlueprint[]
): SiteLayoutPlan {
  const isEditorial = Boolean(
    ctx.designSystem.accentRole === "editorial" ||
      ctx.sitePlan.visualArchetype?.toLowerCase().includes("editorial") ||
      ctx.sitePlan.visualArchetype?.toLowerCase().includes("fashion") ||
      ctx.verticalProfile?.profileId === "editorial-light" ||
      ctx.verticalProfile?.profileId === "luxury-dark"
  );
  const seed = ctx.variationSeed;

  const sections: SiteLayoutPlan["sections"] = { ...plan.sections };

  for (const bp of blueprints) {
    for (const s of bp.sections) {
      let spec = sections[s.id] ?? defaultLayoutForTemplate(s.templateId, isEditorial, seed);

      if (!HERO_TEMPLATES.has(s.templateId)) {
        if (HERO_ONLY_VARIANTS.has(spec.variant)) {
          spec = defaultLayoutForTemplate(s.templateId, isEditorial, seed);
        }
        if (spec.mediaPosition) {
          const { mediaPosition: _, ...rest } = spec;
          spec = rest;
        }
      }

      sections[s.id] = spec;
    }
  }

  return { sections };
}

const LAYOUT_PROMPT = `You are a layout director for premium marketing websites (Framer quality).

INPUT (read-only): page blueprints, design mood, composition strategy.
OUTPUT (your only job): SiteLayoutPlan JSON with per-section layout specs.
FORBIDDEN: Do not change templateId, copy, colors, fonts, or motion.

Variant options: default | full-bleed-left | centered-stack | split-offset | band-compact | band-wide
density: airy | normal | compact
mediaPosition (heroes only): background | left | right

Rules:
- hero_spotlight on home: split-offset or centered-stack for luxury/editorial profiles
- hero_editorial on home: full-bleed-left or split-offset for editorial/fashion
- hero_split_cinematic: mediaPosition left or right by rhythm
- cta_band closers: band-wide or centered-stack
- footer_cta pre-footer strips: band-wide or centered-stack, airy density
- Vary variants — never 3+ identical variants in a row on one page
- split-offset only on hero templates

Output JSON (flat sections map only — NOT nested by page slug):
{
  "sections": {
    "home_s0_herospotlight": { "variant": "split-offset", "density": "airy", "mediaPosition": "background" }
  }
}`;

const PER_PAGE_SECTION_THRESHOLD = 10;

function compactBlueprintList(blueprints: PageBlueprint[]): string {
  return blueprints
    .map(
      (bp) =>
        `Page ${bp.slug}:\n` + bp.sections.map((s) => `  ${s.id}: ${s.templateId}`).join("\n")
    )
    .join("\n\n");
}

function layoutUserPrompt(ctx: SiteContext, sectionList: string, parseError?: string): string {
  const retry = parseError
    ? `\nPRIOR RESPONSE WAS INVALID JSON (${parseError}). Return ONLY flat { "sections": { ... } } — no page slugs as keys.`
    : "";
  return `Mood: ${ctx.designSystem.mood}
Composition: ${ctx.sitePlan.compositionStrategy}
Page tone: ${ctx.designSystem.pageTone ?? "light"}
Vertical profile: ${ctx.verticalProfile?.profileId ?? "generic"}
Variation seed: ${ctx.variationSeed ?? "none"}

Sections (id: templateId):
${sectionList}${retry}`;
}

/** Accept flat sections or page-nested { home: { sections: {...} } } from LLM. */
export function flattenLayoutSectionsPayload(raw: unknown): Record<string, unknown> {
  const payload = unwrapLayoutPayload(raw);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};

  const obj = payload as Record<string, unknown>;

  if (obj.sections && typeof obj.sections === "object" && !Array.isArray(obj.sections)) {
    return obj.sections as Record<string, unknown>;
  }

  const merged: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const page = val as Record<string, unknown>;
    if (page.sections && typeof page.sections === "object" && !Array.isArray(page.sections)) {
      Object.assign(merged, page.sections as Record<string, unknown>);
    } else if ("variant" in page || "density" in page) {
      merged[key] = page;
    }
  }
  return merged;
}

function mockLayoutPlan(ctx: SiteContext, blueprints: PageBlueprint[]): SiteLayoutPlan {
  const isEditorial = Boolean(
    ctx.designSystem.accentRole === "editorial" ||
    ctx.sitePlan.visualArchetype?.toLowerCase().includes("editorial") ||
    ctx.sitePlan.visualArchetype?.toLowerCase().includes("fashion")
  );

  const sections: SiteLayoutPlan["sections"] = {};
  for (const bp of blueprints) {
    let lastVariant = "";
    let run = 0;
    for (const s of bp.sections) {
      let spec = defaultLayoutForTemplate(s.templateId, isEditorial, ctx.variationSeed);
      if (spec.variant === lastVariant) {
        run++;
        if (run >= 2 && s.templateId === "hero_editorial") {
          spec = { ...spec, variant: "split-offset" };
          run = 0;
        }
      } else {
        run = 1;
        lastVariant = spec.variant;
      }
      if (s.templateId === "cta_band" && bp.sections[bp.sections.length - 1]?.id === s.id) {
        spec = { ...spec, variant: isEditorial ? "band-wide" : "band-compact" };
      }
      if (s.templateId === "footer_cta") {
        spec = { ...spec, variant: isEditorial ? "band-wide" : "default", density: "airy" };
      }
      sections[s.id] = spec;
    }
  }
  return { sections };
}

const LAYOUT_VARIANTS = new Set<LayoutVariant>([
  "default",
  "full-bleed-left",
  "centered-stack",
  "split-offset",
  "band-compact",
  "band-wide",
]);

const VARIANT_ALIASES: Record<string, LayoutVariant> = {
  "full-bleed": "full-bleed-left",
  fullbleed: "full-bleed-left",
  "full bleed left": "full-bleed-left",
  centered: "centered-stack",
  "center-stack": "centered-stack",
  split: "split-offset",
  "split offset": "split-offset",
  band: "band-wide",
  compact: "band-compact",
};

export function coerceLayoutVariant(value: unknown, fallback: LayoutVariant): LayoutVariant {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = value.toLowerCase().replace(/_/g, "-").trim();
  if (LAYOUT_VARIANTS.has(normalized as LayoutVariant)) {
    return normalized as LayoutVariant;
  }
  return VARIANT_ALIASES[normalized] ?? fallback;
}

function coerceDensity(
  value: unknown,
  fallback?: SectionLayoutSpec["density"]
): SectionLayoutSpec["density"] | undefined {
  if (typeof value !== "string") return fallback;
  const normalized = value.toLowerCase().trim();
  if (normalized === "airy" || normalized === "normal" || normalized === "compact") {
    return normalized;
  }
  return fallback;
}

function coerceMediaPosition(
  value: unknown,
  fallback?: SectionLayoutSpec["mediaPosition"]
): SectionLayoutSpec["mediaPosition"] | undefined {
  if (typeof value !== "string") return fallback;
  const normalized = value.toLowerCase().trim();
  if (normalized === "background" || normalized === "left" || normalized === "right") {
    return normalized;
  }
  return fallback;
}

function unwrapLayoutPayload(raw: unknown): unknown {
  const payload = unwrapAgentPayload(raw);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const obj = payload as Record<string, unknown>;
  if (obj.layoutPlan && typeof obj.layoutPlan === "object" && !Array.isArray(obj.layoutPlan)) {
    return obj.layoutPlan;
  }
  return payload;
}

/** Merge LLM layout output with per-template defaults; fill every blueprint section. */
export function sanitizeLlmLayoutPlan(
  raw: unknown,
  ctx: SiteContext,
  blueprints: PageBlueprint[]
): SiteLayoutPlan {
  const fallback = mockLayoutPlan(ctx, blueprints);
  const payload = unwrapLayoutPayload(raw);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return sanitizeLayoutPlan(fallback, ctx, blueprints);
  }

  const obj = { sections: flattenLayoutSectionsPayload(payload) };
  const rawSections = obj.sections;

  const sections: SiteLayoutPlan["sections"] = { ...fallback.sections };

  for (const bp of blueprints) {
    for (const s of bp.sections) {
      const base = sections[s.id] ?? defaultLayoutForTemplate(
        s.templateId,
        Boolean(ctx.designSystem.accentRole === "editorial"),
        ctx.variationSeed
      );
      const cfg = rawSections[s.id];
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;

      const c = cfg as Record<string, unknown>;
      const spec: SectionLayoutSpec = {
        variant: coerceLayoutVariant(c.variant, base.variant),
        density: coerceDensity(c.density, base.density),
      };
      const mediaPosition = coerceMediaPosition(c.mediaPosition, base.mediaPosition);
      if (mediaPosition) spec.mediaPosition = mediaPosition;
      sections[s.id] = spec;
    }
  }

  return sanitizeLayoutPlan(SiteLayoutPlanSchema.parse({ sections }), ctx, blueprints);
}

async function directLayoutPlanForPage(
  ctx: SiteContext,
  blueprint: PageBlueprint
): Promise<SiteLayoutPlan["sections"]> {
  const sectionList = `Page ${blueprint.slug}:\n` +
    blueprint.sections.map((s) => `  ${s.id}: ${s.templateId}`).join("\n");

  const raw = await chatJsonWithRetry(
    `layout director (${blueprint.slug})`,
    LAYOUT_PROMPT,
    (parseError) => layoutUserPrompt(ctx, sectionList, parseError),
    { tokenRole: "composition", initialTemperature: 0.45 },
    (r) => parseLlmJson(r)
  );

  const plan = sanitizeLlmLayoutPlan(raw, ctx, [blueprint]);
  return plan.sections;
}

export async function directLayoutPlan(
  ctx: SiteContext,
  blueprints: PageBlueprint[]
): Promise<SiteLayoutPlan> {
  const totalSections = blueprints.reduce((n, bp) => n + bp.sections.length, 0);
  const usePerPage = totalSections > PER_PAGE_SECTION_THRESHOLD;

  if (llm.isAvailable) {
    try {
      if (usePerPage) {
        pipelineLog(
          `[pipeline] Layout director: per-page mode (${totalSections} sections across ${blueprints.length} pages)`
        );
        const sections: SiteLayoutPlan["sections"] = {
          ...mockLayoutPlan(ctx, blueprints).sections,
        };
        for (const bp of blueprints) {
          try {
            const pageSections = await directLayoutPlanForPage(ctx, bp);
            Object.assign(sections, pageSections);
          } catch (err) {
            pipelineLog(
              `[pipeline] Layout director ${bp.slug} failed: ${err instanceof Error ? err.message : String(err)} — page defaults`
            );
            recordFallback("layout_director");
          }
        }
        const plan = sanitizeLayoutPlan(SiteLayoutPlanSchema.parse({ sections }), ctx, blueprints);
        pipelineLog(`[pipeline] Layout director: ${Object.keys(plan.sections).length} sections`);
        return plan;
      }

      const sectionList = compactBlueprintList(blueprints);
      const raw = await chatJsonWithRetry(
        "layout director",
        LAYOUT_PROMPT,
        (parseError) => layoutUserPrompt(ctx, sectionList, parseError),
        { tokenRole: "composition", initialTemperature: 0.45 },
        (r) => parseLlmJson(r)
      );

      const plan = sanitizeLlmLayoutPlan(raw, ctx, blueprints);
      pipelineLog(`[pipeline] Layout director: ${Object.keys(plan.sections).length} sections`);
      return plan;
    } catch (err) {
      pipelineLog(
        `[pipeline] Layout director LLM failed: ${err instanceof Error ? err.message : String(err)} — using profile layout defaults`
      );
      recordFallback("layout_director");
    }
  } else {
    if (!allowMocks()) requireLlm("layout director");
  }

  return mockLayoutPlan(ctx, blueprints);
}
