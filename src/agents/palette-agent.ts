/** Palette Agent — colors, gradients, and accent role only. */
import type { PalettePartial } from "../types.js";
import type { VerticalDesignProfile, VerticalProfileId } from "../design/vertical-profiles.js";
import { mockPaletteForProfile } from "../design/vertical-profiles.js";
import { applySeedToPalette } from "../design/seed-design.js";
import { PalettePartialSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { GENERIC_THEME, slugifyIndustry } from "./theme-agent.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { recordFallback } from "../util/fallback-tracker.js";
import {
  freezeSnapshot,
  type DesignCouncilSnapshot,
  validateAgentOutput,
  type AgentContract,
} from "./contracts/index.js";

const PALETTE_CONTRACT: AgentContract<PalettePartial> = {
  name: "PaletteAgent",
  role: "Output color palette and gradient mood only.",
  outputSchema: PalettePartialSchema as import("zod").ZodType<PalettePartial>,
  forbiddenFields: ["fontHeading", "fontBody", "navTreatment", "pageTone", "motionPreset", "templateId"],
};

const PALETTE_PROMPT = `You are a color palette specialist for premium marketing websites.

OUTPUT (your only job): palette JSON with colors and gradient mood.
FORBIDDEN: fonts, nav treatment, page tone, motion, templates.

Rules:
- All string fields must be plain strings, never JSON arrays
- gradientFrom/gradientTo share hue family with accent; vivid enough for white CTA text
- accentRole: sparing | hero | editorial
- gradientMood: subtle | vivid | monochrome
- Mindful contrast: text on surface, muted on bg

Output JSON:
{
  "vertical": "industry slug",
  "mood": "3-word mood",
  "gradientMood": "subtle|vivid|monochrome",
  "accentRole": "sparing|hero|editorial",
  "colors": { "bg", "surface", "text", "muted", "accent", "accentSoft", "gradientFrom", "gradientTo" }
}`;

export async function generatePalette(
  businessName: string,
  businessBrief: string,
  rawBrief?: string,
  verticalProfile?: VerticalDesignProfile,
  variationSeed?: number
): Promise<PalettePartial> {
  const snapshot = freezeSnapshot<DesignCouncilSnapshot>({
    businessName,
    brief: { businessName } as DesignCouncilSnapshot["brief"],
    rawBrief,
    verticalProfile,
    variationSeed,
  });

  if (llm.isAvailable) {
    try {
      const profileHint = verticalProfile
        ? `\nVertical profile: ${verticalProfile.profileId}\nPalette direction: ${verticalProfile.paletteHints}`
        : "";
      const seedHint = variationSeed !== undefined ? `\nVariation seed: ${variationSeed} — shift accent hue within profile family.` : "";
      const raw = await llm.chat(
        PALETTE_PROMPT,
        `Business: ${businessName}\nBrief: ${businessBrief}\nUser: ${rawBrief ?? businessBrief}${profileHint}${seedHint}`,
        { jsonMode: true, temperature: variationSeed !== undefined ? 0.72 : 0.65 }
      );
      const parsed = validateAgentOutput(PALETTE_CONTRACT, JSON.parse(raw));
      return applySeedIfNeeded(parsed, variationSeed, verticalProfile?.profileId);
    } catch (err) {
      recordFallback("palette");
      pipelineLog(
        `[pipeline] Palette agent failed: ${err instanceof Error ? err.message : String(err)} — using default palette`
      );
      if (!allowMocks()) {
        return mockPalette(businessName, businessBrief, verticalProfile, variationSeed);
      }
    }
  } else {
    if (!allowMocks()) requireLlm("palette agent");
  }

  return mockPalette(businessName, businessBrief, verticalProfile, variationSeed);
}

function applySeedIfNeeded(
  palette: PalettePartial,
  seed: number | undefined,
  profileId?: VerticalProfileId
): PalettePartial {
  if (seed === undefined || !profileId) return palette;
  return applySeedToPalette(palette, seed, profileId);
}

function mockPalette(
  businessName: string,
  businessBrief: string,
  verticalProfile?: VerticalDesignProfile,
  variationSeed?: number
): PalettePartial {
  if (verticalProfile) {
    const base = mockPaletteForProfile(verticalProfile, businessName);
    return applySeedIfNeeded(base, variationSeed, verticalProfile.profileId);
  }
  const vertical = slugifyIndustry(businessBrief);
  const editorial = /fashion|editorial|luxury|bridal/i.test(businessBrief);
  return {
    vertical,
    mood: editorial ? "editorial luxe refined" : GENERIC_THEME.mood,
    gradientMood: editorial ? "vivid" : GENERIC_THEME.gradientMood,
    accentRole: editorial ? "editorial" : GENERIC_THEME.accentRole,
    colors: editorial
      ? {
          bg: "#fafafa",
          surface: "#ffffff",
          text: "#111111",
          muted: "#666666",
          accent: "#c45c26",
          accentSoft: "#fff7ed",
          gradientFrom: "#c45c26",
          gradientTo: "#e85d04",
        }
      : {
          bg: GENERIC_THEME.colors.bg,
          surface: GENERIC_THEME.colors.surface,
          text: GENERIC_THEME.colors.text,
          muted: GENERIC_THEME.colors.muted,
          accent: GENERIC_THEME.colors.accent,
          accentSoft: GENERIC_THEME.colors.accentSoft,
          gradientFrom: GENERIC_THEME.colors.gradientFrom,
          gradientTo: GENERIC_THEME.colors.gradientTo,
        },
  };
}
