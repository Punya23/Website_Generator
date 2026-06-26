/** Motion Director — choreographs per-section entrance, parallax, and chrome animation. */
import type { PageBlueprint, SiteMotionPlan, SiteContext } from "../types.js";
import { SiteMotionPlanSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { getTemplate } from "../section-templates/registry.js";
import { pickFrom } from "../design/variation.js";
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

Output JSON only:
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
  const rawSections =
    obj.sections && typeof obj.sections === "object" && !Array.isArray(obj.sections)
      ? (obj.sections as Record<string, unknown>)
      : {};

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
    navScrollEnhance: obj.navScrollEnhance !== false,
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
    try {
      const sectionList = blueprints
        .map(
          (bp) =>
            `Page ${bp.slug} (${bp.rhythm}):\n` +
            bp.sections
              .map((s) => {
                const t = getTemplate(s.templateId);
                return `  - ${s.id}: ${s.templateId} (${t?.defaultMotion ?? "fade"}) — ${s.intent}`;
              })
              .join("\n")
        )
        .join("\n\n");

      const raw = await llm.chat(
        MOTION_PROMPT,
        `Business: ${snapshot.businessName}
Motion style: ${snapshot.sitePlan.motionStyle ?? snapshot.designSystem.motionStyle ?? "staggered reveals"}
Mood: ${snapshot.designSystem.mood}
Global preset hint: ${snapshot.designSystem.motionPreset ?? "stagger"}
Vertical profile: ${ctx.verticalProfile?.profileId ?? "generic"}
Variation seed: ${ctx.variationSeed ?? "none"}

Blueprints:
${sectionList}

${snapshot.chromeSpec ? `Chrome footer layout: ${snapshot.chromeSpec.footer.layout}` : ""}`,
        { jsonMode: true, temperature: 0.45, tokenRole: "composition" }
      );

      const plan = sanitizeLlmMotionPlan(JSON.parse(raw), ctx, blueprints);
      pipelineLog(`[pipeline] Motion director: ${Object.keys(plan.sections).length} sections choreographed`);
      return plan;
    } catch (err) {
      pipelineLog(
        `[pipeline] Motion director LLM failed: ${err instanceof Error ? err.message : String(err)} — using default choreography`
      );
    }
  } else {
    if (!allowMocks()) requireLlm("motion director");
  }

  return mockMotionPlan(ctx, blueprints);
}
