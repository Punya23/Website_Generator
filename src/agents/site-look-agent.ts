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
import type { SiteContext } from "../types.js";

export interface SiteLookProfile {
  layoutArchetype: string;
  toneKeywords: string[];
  preferredTemplateIds: string[];
}

const SITE_LOOK_PROMPT = `You are an award-winning web art director briefing a design team. Given a business brief, invent a distinctive visual/layout direction for its marketing site — not a repeating Framer kit.

AVOID as the default look (only pick them when the brief truly wants them):
- Cursor-following radial spotlight / mesh gradient heroes
- Frosted glass panels and heavy backdrop blur
- The same "premium dark luxury" package every time

Prefer directions that feel specific to THIS business: editorial type, image-led, dense product bento, warm solid surfaces, cinema stills, print-like typography, etc.

Respond with JSON only:
{
  "layoutArchetype": "short label for the direction, e.g. 'image-led warm editorial', 'dense bento product tour', 'solid-surface wellness studio'",
  "toneKeywords": ["3-5 words describing the visual mood — avoid generic 'premium luxury glass blur'"],
  "preferredComponents": ["8-12 exact component names from the catalog that fit this direction — do NOT always lead with HeroSpotlight"]
}`;

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
  return { layoutArchetype: "", toneKeywords: [], preferredTemplateIds: [] };
}

interface RawSiteLook {
  layoutArchetype?: unknown;
  toneKeywords?: unknown;
  preferredComponents?: unknown;
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

    pipelineLog(
      `[pipeline] Site look: ${layoutArchetype || "—"} (${preferredTemplateIds.length} preferred components)`
    );
    return { layoutArchetype, toneKeywords, preferredTemplateIds };
  } catch (err) {
    recordFallback("site_look");
    if (strictLlmRequired()) handleLlmFailure("site look profile", err);
    pipelineLog(
      `[pipeline] Site look profile failed: ${err instanceof Error ? err.message : String(err)} — falling back to default pool`
    );
    return fallbackProfile();
  }
}
