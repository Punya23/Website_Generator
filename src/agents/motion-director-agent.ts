/** Motion Director — choreographs per-section entrance, parallax, and chrome animation. */
import type { PageBlueprint, SiteMotionPlan, SiteContext } from "../types.js";
import { SiteMotionPlanSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { getTemplate } from "../section-templates/registry.js";
import { pickFrom } from "../design/variation.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { coerceSectionEntrance, normalizeMotionPlan, resolveMotionPreset } from "../motion/presets.js";
import {
  defaultSectionMotion,
  freezeSnapshot,
  type MotionDirectorSnapshot,
  unwrapAgentPayload,
} from "./contracts/index.js";

const MOTION_PROMPT = `You are a motion design director for premium marketing websites (Framer quality).

INPUT (read-only): page blueprints, site motion style, design mood, optional chrome spec.
OUTPUT (your only job): SiteMotionPlan JSON with per-section entrance choreography.
FORBIDDEN: Do not change templateId, copy, colors, fonts, or section order.

Rules:
- globalPreset: fade-up | stagger | scale-in | slide-left | parallax-hero | none
- Vary entrance types across each page — never 4+ consecutive identical entrances
- Hero templates (hero_editorial, hero_split_cinematic, hero_video, hero_spotlight): parallax true, entrance reveal or slide-left
- testimonial_carousel / portfolio_carousel / stats_animated: entrance stagger
- stats_marquee / logo_marquee / text_marquee: entrance stagger, marquee true
- cta_band: entrance scale-in
- intro_statement / testimonial: entrance reveal
- feature_bento / team_grid: entrance stagger with staggerDelay 0.06-0.08
- chrome.footer: entrance stagger for link columns
- chrome.nav: compactOnScroll true, shadowOnScroll true when navScrollEnhance
- reducedMotion: respect

Output JSON only (flat sections map — NOT nested by page slug):
{
  "globalPreset": "...",
  "reducedMotion": "respect",
  "navScrollEnhance": true,
  "sections": { "section_id": { "entrance": "reveal|stagger|scale-in|slide-left|none", "staggerDelay": 0.06, "parallax": false, "marquee": false } },
  "chrome": {
    "footer": { "entrance": "stagger", "staggerDelay": 0.06 },
    "nav": { "compactOnScroll": true, "shadowOnScroll": true }
  }
}`;

const PER_PAGE_SECTION_THRESHOLD = 10;

function compactMotionSectionList(blueprints: PageBlueprint[]): string {
  return blueprints
    .map(
      (bp) =>
        `Page ${bp.slug}:\n` +
        bp.sections
          .map((s) => {
            const t = getTemplate(s.templateId);
            return `  ${s.id}: ${s.templateId} (${t?.defaultMotion ?? "fade"})`;
          })
          .join("\n")
    )
    .join("\n\n");
}

function motionUserPrompt(
  snapshot: MotionDirectorSnapshot,
  ctx: SiteContext,
  sectionList: string,
  parseError?: string
): string {
  const retry = parseError
    ? `\nPRIOR RESPONSE WAS INVALID JSON (${parseError}). Return ONLY valid flat JSON with top-level "sections" map.`
    : "";
  return `Business: ${snapshot.businessName}
Motion style: ${snapshot.sitePlan.motionStyle ?? snapshot.designSystem.motionStyle ?? "staggered reveals"}
Mood: ${snapshot.designSystem.mood}
Global preset hint: ${snapshot.designSystem.motionPreset ?? "stagger"}
Vertical profile: ${ctx.verticalProfile?.profileId ?? "generic"}
Variation seed: ${ctx.variationSeed ?? "none"}

Sections (id: templateId):
${sectionList}
${snapshot.chromeSpec ? `Chrome footer layout: ${snapshot.chromeSpec.footer.layout}` : ""}${retry}`;
}

/** Accept flat sections or page-nested { home: { sections: {...} } } from LLM. */
export function flattenMotionSectionsPayload(raw: unknown): Record<string, unknown> {
  const payload = unwrapAgentPayload(raw);
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
    } else if ("entrance" in page || "parallax" in page || "marquee" in page) {
      merged[key] = page;
    }
  }
  return merged;
}

function mockMotionPlan(ctx: SiteContext, blueprints: PageBlueprint[]): SiteMotionPlan {
  const presetPool: SiteMotionPlan["globalPreset"][] = [
    ctx.designSystem.motionPreset ?? "stagger",
    "fade-up",
    "parallax-hero",
    "slide-left",
  ].filter((v, i, a) => a.indexOf(v) === i) as SiteMotionPlan["globalPreset"][];

  const globalPreset = ctx.variationSeed
    ? pickFrom(ctx.variationSeed, "global-motion", presetPool)
    : (ctx.designSystem.motionPreset ??
        resolveMotionPreset(ctx.designSystem.motionStyle, ctx.sitePlan.motionStyle));

  const sections: SiteMotionPlan["sections"] = {};
  for (const bp of blueprints) {
    let lastEntrance = "";
    let run = 0;
    for (const s of bp.sections) {
      let cfg = defaultSectionMotion(s.templateId);
      if (cfg.entrance === lastEntrance) {
        run++;
        if (run >= 3) {
          cfg = { ...cfg, entrance: cfg.entrance === "reveal" ? "slide-left" : "reveal" };
          run = 0;
        }
      } else {
        run = 1;
        lastEntrance = cfg.entrance;
      }
      sections[s.id] = cfg;
    }
  }

  return {
    globalPreset,
    reducedMotion: "respect",
    navScrollEnhance: true,
    sections,
    chrome: {
      footer: { entrance: "stagger", staggerDelay: 0.06 },
      nav: { compactOnScroll: true, shadowOnScroll: true },
    },
  };
}

function parseStaggerDelay(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Merge LLM motion output with per-template defaults; fill every blueprint section. */
function sanitizeLlmMotionPlan(
  raw: unknown,
  ctx: SiteContext,
  blueprints: PageBlueprint[]
): SiteMotionPlan {
  const fallback = mockMotionPlan(ctx, blueprints);
  const payload = unwrapAgentPayload(raw);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }

  const obj = payload as Record<string, unknown>;
  const sections: SiteMotionPlan["sections"] = { ...fallback.sections };
  const rawSections = flattenMotionSectionsPayload(payload);

  for (const [id, cfg] of Object.entries(rawSections)) {
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
    const c = cfg as Record<string, unknown>;
    const base = sections[id] ?? { entrance: "reveal" as const };
    sections[id] = {
      entrance: coerceSectionEntrance(String(c.entrance ?? base.entrance)),
      staggerDelay: parseStaggerDelay(c.staggerDelay) ?? base.staggerDelay,
      parallax: c.parallax === true || (c.parallax === undefined && base.parallax),
      marquee: c.marquee === true || (c.marquee === undefined && base.marquee),
    };
  }

  const chromeRaw =
    obj.chrome && typeof obj.chrome === "object" && !Array.isArray(obj.chrome)
      ? (obj.chrome as Record<string, unknown>)
      : {};
  const footerRaw =
    chromeRaw.footer && typeof chromeRaw.footer === "object" && !Array.isArray(chromeRaw.footer)
      ? (chromeRaw.footer as Record<string, unknown>)
      : {};
  const navRaw =
    chromeRaw.nav && typeof chromeRaw.nav === "object" && !Array.isArray(chromeRaw.nav)
      ? (chromeRaw.nav as Record<string, unknown>)
      : {};

  const plan = normalizeMotionPlan({
    globalPreset: String(obj.globalPreset ?? fallback.globalPreset),
    reducedMotion: obj.reducedMotion === "minimal" ? "minimal" : "respect",
    navScrollEnhance: obj.navScrollEnhance === true,
    sections,
    chrome: {
      footer: {
        entrance: coerceSectionEntrance(
          String(footerRaw.entrance ?? fallback.chrome.footer.entrance)
        ),
        staggerDelay:
          parseStaggerDelay(footerRaw.staggerDelay) ?? fallback.chrome.footer.staggerDelay,
      },
      nav: {
        compactOnScroll: navRaw.compactOnScroll !== false,
        shadowOnScroll: navRaw.shadowOnScroll !== false,
      },
    },
  });

  return SiteMotionPlanSchema.parse(plan);
}

async function directMotionPlanForPage(
  ctx: SiteContext,
  snapshot: MotionDirectorSnapshot,
  blueprint: PageBlueprint
): Promise<SiteMotionPlan["sections"]> {
  const sectionList =
    `Page ${blueprint.slug}:\n` +
    blueprint.sections
      .map((s) => {
        const t = getTemplate(s.templateId);
        return `  ${s.id}: ${s.templateId} (${t?.defaultMotion ?? "fade"})`;
      })
      .join("\n");

  const raw = await chatJsonWithRetry(
    `motion director (${blueprint.slug})`,
    MOTION_PROMPT,
    (parseError) => motionUserPrompt(snapshot, ctx, sectionList, parseError),
    { tokenRole: "composition", initialTemperature: 0.45 },
    (r) => parseLlmJson(r)
  );

  const plan = sanitizeLlmMotionPlan(raw, ctx, [blueprint]);
  return plan.sections;
}

export async function directMotionPlan(
  ctx: SiteContext,
  blueprints: PageBlueprint[]
): Promise<SiteMotionPlan> {
  const snapshot = freezeSnapshot<MotionDirectorSnapshot>({
    businessName: ctx.businessName,
    sitePlan: ctx.sitePlan,
    designSystem: ctx.designSystem,
    blueprints,
    chromeSpec: ctx.chromeSpec,
    verticalProfile: ctx.verticalProfile,
    variationSeed: ctx.variationSeed,
  });

  if (llm.isAvailable) {
    const totalSections = blueprints.reduce((n, bp) => n + bp.sections.length, 0);
    const usePerPage = totalSections > PER_PAGE_SECTION_THRESHOLD;

    try {
      if (usePerPage) {
        pipelineLog(
          `[pipeline] Motion director: per-page mode (${totalSections} sections across ${blueprints.length} pages)`
        );
        const base = mockMotionPlan(ctx, blueprints);
        const sections: SiteMotionPlan["sections"] = { ...base.sections };
        for (const bp of blueprints) {
          try {
            const pageSections = await directMotionPlanForPage(ctx, snapshot, bp);
            Object.assign(sections, pageSections);
          } catch (err) {
            pipelineLog(
              `[pipeline] Motion director ${bp.slug} failed: ${err instanceof Error ? err.message : String(err)} — page defaults`
            );
            recordFallback("motion_director");
          }
        }
        const plan = SiteMotionPlanSchema.parse({ ...base, sections });
        pipelineLog(`[pipeline] Motion director: ${Object.keys(plan.sections).length} sections choreographed`);
        return plan;
      }

      const sectionList = compactMotionSectionList(blueprints);
      const raw = await chatJsonWithRetry(
        "motion director",
        MOTION_PROMPT,
        (parseError) => motionUserPrompt(snapshot, ctx, sectionList, parseError),
        { tokenRole: "composition", initialTemperature: 0.45 },
        (r) => parseLlmJson(r)
      );

      const plan = sanitizeLlmMotionPlan(raw, ctx, blueprints);
      pipelineLog(`[pipeline] Motion director: ${Object.keys(plan.sections).length} sections choreographed`);
      return plan;
    } catch (err) {
      pipelineLog(
        `[pipeline] Motion director LLM failed: ${err instanceof Error ? err.message : String(err)} — using default choreography`
      );
      recordFallback("motion_director");
    }
  } else {
    if (!allowMocks()) requireLlm("motion director");
  }

  return mockMotionPlan(ctx, blueprints);
}
