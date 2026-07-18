/** One-shot per-site "visual direction" call. This is the concrete lever that makes composition
 *  follow the brief instead of just reshuffling the same fixed pool with a random seed: the model
 *  invents a layout archetype and picks which section types from the full catalog express it,
 *  which page-composition-hints.ts then biases per-page encourage pools toward. */
import { llm } from "../llm/client.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { allowMocks, requireLlm, strictLlmRequired, handleLlmFailure } from "../util/llm-required.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { SECTION_TEMPLATES } from "../section-templates/registry.js";
import type { SiteContext, SiteTheme } from "../types.js";

export type TypeScaleChoice = "compact" | "balanced" | "dramatic";
export type SpacingDensityChoice = "compact" | "comfortable" | "spacious";
export type MotionIntensityChoice = "subtle" | "standard" | "expressive";

export interface SiteLookProfile {
  layoutArchetype: string;
  toneKeywords: string[];
  preferredTemplateIds: string[];
  /** The committed one-sentence art direction, injected verbatim into the copy prompt. */
  aestheticDirection: string;
  /** Machine-readable design-token decisions the LLM commits to for THIS brand. */
  typeScale: TypeScaleChoice;
  spacingDensity: SpacingDensityChoice;
  motionIntensity: MotionIntensityChoice;
}

const SITE_LOOK_PROMPT = `You are an award-winning web art director briefing a design team. Given a business brief, commit to ONE distinctive, internally-consistent visual system for its marketing site — not a repeating Framer kit. The point is that two different businesses should get visibly different type scale, spacing, motion and mood, all chosen to fit the brand.

AVOID as the default look (only pick them when the brief truly wants them):
- Cursor-following radial spotlight / mesh gradient heroes
- Frosted glass panels and heavy backdrop blur
- The same "premium dark luxury" package every time

Prefer directions that feel specific to THIS business: editorial type, image-led, dense product bento, warm solid surfaces, cinema stills, print-like typography, etc.

Choose each design decision deliberately for the brand:
- typeScale: "compact" (calm/corporate/dense-info), "balanced" (default), or "dramatic" (editorial/fashion/landing — huge display headings)
- spacingDensity: "compact" (utilitarian, information-dense), "comfortable" (default), or "spacious" (luxury/editorial, lots of air)
- motionIntensity: "subtle" (serious/clinical/legal), "standard" (default), or "expressive" (creative/consumer/entertainment)

Respond with JSON only:
{
  "aestheticDirection": "ONE committed sentence naming the look: palette feel + type personality + spatial feel, e.g. 'Warm ivory editorial with oversized serif display, generous whitespace, and quiet fade motion.'",
  "layoutArchetype": "short label, e.g. 'image-led warm editorial', 'dense bento product tour', 'solid-surface wellness studio'",
  "toneKeywords": ["3-5 words describing the visual mood — avoid generic 'premium luxury glass blur'"],
  "typeScale": "compact | balanced | dramatic",
  "spacingDensity": "compact | comfortable | spacious",
  "motionIntensity": "subtle | standard | expressive",
  "preferredComponents": ["8-12 exact component names from the catalog that fit this direction — do NOT always lead with HeroSpotlight"]
}`;

/** Thread the art-director's committed decisions onto the theme so they actually drive tokens:
 *  type-scale ratio (heading drama), motion intensity (timing), and — only when the LLM deliberately
 *  chose a non-default — the spacing density. This is what makes two different briefs render with
 *  visibly different systems rather than the same heuristic defaults. */
export function applyDesignBriefToTheme(theme: SiteTheme, profile: SiteLookProfile): void {
  theme.typeScaleRatio = profile.typeScale;
  theme.motionIntensity = profile.motionIntensity;
  if (profile.spacingDensity === "compact") theme.sectionGapMode = "tight";
  else if (profile.spacingDensity === "spacious") theme.sectionGapMode = "airy";
  // "comfortable" leaves the design system's own sectionGapMode untouched.
}

function catalogForPrompt(): string {
  return SECTION_TEMPLATES.map((t) => `- ${t.componentName}: ${t.description}`).join("\n");
}

function buildUserPrompt(ctx: SiteContext): string {
  const b = ctx.expandedBrief;
  return `Business: ${ctx.businessName}
Essence: ${b.elevatorPitch}
Tone: ${b.tone}
Audience: ${b.targetAudience}
Site plan strategy: ${ctx.sitePlan.compositionStrategy}

CATALOG:
${catalogForPrompt()}

Propose the visual direction now.`;
}

function fallbackProfile(): SiteLookProfile {
  return {
    layoutArchetype: "",
    toneKeywords: [],
    preferredTemplateIds: [],
    aestheticDirection: "",
    typeScale: "balanced",
    spacingDensity: "comfortable",
    motionIntensity: "standard",
  };
}

interface RawSiteLook {
  layoutArchetype?: unknown;
  toneKeywords?: unknown;
  preferredComponents?: unknown;
  aestheticDirection?: unknown;
  typeScale?: unknown;
  spacingDensity?: unknown;
  motionIntensity?: unknown;
}

function pickEnum<T extends string>(val: unknown, allowed: readonly T[], fallback: T): T {
  return typeof val === "string" && (allowed as readonly string[]).includes(val) ? (val as T) : fallback;
}

export async function proposeSiteLookProfile(ctx: SiteContext): Promise<SiteLookProfile> {
  requireLlm("site look profile");
  if (!llm.isAvailable) {
    if (!allowMocks()) throw new Error("Site look profile requires LLM");
    recordFallback("site_look");
    return fallbackProfile();
  }

  try {
    const knownNames = new Set(SECTION_TEMPLATES.map((t) => t.componentName));
    const parsed = await chatJsonWithRetry<RawSiteLook>(
      "site look",
      SITE_LOOK_PROMPT,
      () => buildUserPrompt(ctx),
      {
        tokenRole: "composition",
        model: llm.getCompositionModel(),
        initialTemperature: 0.9,
        maxAttempts: 2,
      },
      (raw) => parseLlmJson<RawSiteLook>(raw)
    );

    const preferredTemplateIds = Array.isArray(parsed.preferredComponents)
      ? parsed.preferredComponents.filter(
          (name): name is string => typeof name === "string" && knownNames.has(name)
        )
      : [];
    const layoutArchetype = typeof parsed.layoutArchetype === "string" ? parsed.layoutArchetype : "";
    const toneKeywords = Array.isArray(parsed.toneKeywords)
      ? parsed.toneKeywords.filter((k): k is string => typeof k === "string")
      : [];
    const aestheticDirection =
      typeof parsed.aestheticDirection === "string" ? parsed.aestheticDirection.trim() : "";
    const typeScale = pickEnum<TypeScaleChoice>(parsed.typeScale, ["compact", "balanced", "dramatic"], "balanced");
    const spacingDensity = pickEnum<SpacingDensityChoice>(
      parsed.spacingDensity,
      ["compact", "comfortable", "spacious"],
      "comfortable"
    );
    const motionIntensity = pickEnum<MotionIntensityChoice>(
      parsed.motionIntensity,
      ["subtle", "standard", "expressive"],
      "standard"
    );

    pipelineLog(
      `[pipeline] Design brief: ${layoutArchetype || "—"} · type=${typeScale} space=${spacingDensity} motion=${motionIntensity} · ${preferredTemplateIds.length} components`
    );
    return {
      layoutArchetype,
      toneKeywords,
      preferredTemplateIds,
      aestheticDirection,
      typeScale,
      spacingDensity,
      motionIntensity,
    };
  } catch (err) {
    recordFallback("site_look");
    if (strictLlmRequired()) handleLlmFailure("site look profile", err);
    pipelineLog(
      `[pipeline] Site look profile failed: ${err instanceof Error ? err.message : String(err)} — falling back to default pool`
    );
    return fallbackProfile();
  }
}
