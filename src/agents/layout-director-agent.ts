/** Layout Director — per-section layout variants and density only. */
import type { PageBlueprint, SiteContext, SiteLayoutPlan, SectionLayoutSpec, LayoutVariant } from "../types.js";
import { SiteLayoutPlanSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { defaultLayoutForTemplate } from "../qa/layout-qa.js";
import { parseLlmJson } from "../llm/parse-json.js";
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

Output JSON:
{
  "sections": {
    "section_id": { "variant": "full-bleed-left", "density": "airy", "mediaPosition": "background" }
  }
}`;

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

  const obj = payload as Record<string, unknown>;
  const rawSections =
    obj.sections && typeof obj.sections === "object" && !Array.isArray(obj.sections)
      ? (obj.sections as Record<string, unknown>)
      : Array.isArray(obj.sections)
        ? Object.fromEntries(
            obj.sections
              .filter((item) => item && typeof item === "object" && !Array.isArray(item))
              .map((item) => {
                const row = item as Record<string, unknown>;
                const id = String(row.id ?? row.sectionId ?? row.section_id ?? "");
                return [id, row] as const;
              })
              .filter(([id]) => id.length > 0)
          )
        : {};

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

export async function directLayoutPlan(
  ctx: SiteContext,
  blueprints: PageBlueprint[]
): Promise<SiteLayoutPlan> {
  if (llm.isAvailable) {
    try {
      const sectionList = blueprints
        .map(
          (bp) =>
            `Page ${bp.slug} (${bp.rhythm}):\n` +
            bp.sections.map((s) => `  - ${s.id}: ${s.templateId} — ${s.intent}`).join("\n")
        )
        .join("\n\n");

      const raw = await llm.chat(
        LAYOUT_PROMPT,
        `Mood: ${ctx.designSystem.mood}
Composition: ${ctx.sitePlan.compositionStrategy}
Page tone: ${ctx.designSystem.pageTone ?? "light"}
Vertical profile: ${ctx.verticalProfile?.profileId ?? "generic"}
Variation seed: ${ctx.variationSeed ?? "none"}

Blueprints:
${sectionList}`,
        { jsonMode: true, temperature: 0.45, tokenRole: "composition" }
      );

      const plan = sanitizeLlmLayoutPlan(parseLlmJson(raw), ctx, blueprints);
      pipelineLog(`[pipeline] Layout director: ${Object.keys(plan.sections).length} sections`);
      return plan;
    } catch (err) {
      pipelineLog(
        `[pipeline] Layout director LLM failed: ${err instanceof Error ? err.message : String(err)} — using default layout`
      );
    }
  } else {
    if (!allowMocks()) requireLlm("layout director");
  }

  return mockLayoutPlan(ctx, blueprints);
}
