/** Typography Agent — fonts, type scale, and layout rhythm only. */
import type { TypographyPartial } from "../types.js";
import type { VerticalDesignProfile, VerticalProfileId } from "../design/vertical-profiles.js";
import { mockTypographyForProfile } from "../design/vertical-profiles.js";
import { pickTypographyFromSeed } from "../design/seed-design.js";
import { TypographyPartialSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { GENERIC_THEME } from "./theme-agent.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { validateAgentOutput, type AgentContract } from "./contracts/index.js";

const TYPOGRAPHY_CONTRACT: AgentContract<TypographyPartial> = {
  name: "TypographyAgent",
  role: "Output typography and layout spacing only.",
  outputSchema: TypographyPartialSchema,
  forbiddenFields: ["colors", "navBg", "navTreatment", "pageTone", "gradientFrom", "motionPreset"],
};

const TYPOGRAPHY_PROMPT = `You are a typography specialist for premium marketing websites.

OUTPUT (your only job): typography JSON with fonts and layout rhythm.
FORBIDDEN: colors, nav, motion, section templates.

Rules:
- fontHeading: distinctive display Google Font for headlines
- fontBody: readable body Google Font
- sectionGapMode: tight | normal | airy (fashion/editorial → airy; corporate → normal)
- layout: maxWidth, gridColumns, sectionGap, cardMinHeight

Output JSON:
{
  "fontHeading": "Google Font",
  "fontBody": "Google Font",
  "sectionGapMode": "tight|normal|airy",
  "typography": {
    "display": "Playfair Display",
    "heading": "Playfair Display",
    "body": "Inter",
    "label": "Inter",
    "mono": "IBM Plex Mono"
  },
  "layout": { "maxWidth": "1200px", "gridColumns": 3, "sectionGap": "5rem", "cardMinHeight": "auto" }
}`;

const TYPOGRAPHY_KEYS = ["display", "heading", "body", "label", "mono"] as const;

function coerceFontName(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const name = obj.family ?? obj.font ?? obj.name ?? obj.value;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return undefined;
}

export function normalizeTypographyPartial(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;

  const input = { ...(raw as Record<string, unknown>) };
  const typo = input.typography;
  if (typo && typeof typo === "object" && !Array.isArray(typo)) {
    const normalized: Record<string, string> = {};
    for (const key of TYPOGRAPHY_KEYS) {
      const coerced = coerceFontName((typo as Record<string, unknown>)[key]);
      if (coerced) normalized[key] = coerced;
    }
    input.typography = normalized;
  }

  return input;
}

export async function generateTypography(
  businessName: string,
  businessBrief: string,
  mood?: string,
  verticalProfile?: VerticalDesignProfile,
  variationSeed?: number
): Promise<TypographyPartial> {
  if (llm.isAvailable) {
    try {
      const profileHint = verticalProfile
        ? `\nTypography direction: ${verticalProfile.typographyHints}`
        : "";
      const seedHint =
        variationSeed !== undefined
          ? `\nVariation seed: ${variationSeed} — pick distinctive heading/body pairing within profile.`
          : "";
      const raw = await llm.chat(
        TYPOGRAPHY_PROMPT,
        `Business: ${businessName}\nBrief: ${businessBrief}\nMood: ${mood ?? "refined"}${profileHint}${seedHint}`,
        { jsonMode: true, temperature: variationSeed !== undefined ? 0.65 : 0.55 }
      );
      const parsed = validateAgentOutput(
        TYPOGRAPHY_CONTRACT,
        normalizeTypographyPartial(JSON.parse(raw))
      );
      return applyTypographySeed(parsed, verticalProfile?.profileId, variationSeed);
    } catch (err) {
      pipelineLog(
        `[pipeline] Typography agent failed: ${err instanceof Error ? err.message : String(err)} — using default typography`
      );
      if (!allowMocks()) return mockTypography(businessBrief, verticalProfile, variationSeed);
    }
  } else {
    if (!allowMocks()) requireLlm("typography agent");
  }

  return mockTypography(businessBrief, verticalProfile, variationSeed);
}

function applyTypographySeed(
  typo: TypographyPartial,
  profileId: VerticalProfileId | undefined,
  seed: number | undefined
): TypographyPartial {
  if (seed === undefined || !profileId) return typo;
  const picked = pickTypographyFromSeed(seed, profileId);
  return {
    ...typo,
    fontHeading: picked.fontHeading,
    fontBody: picked.fontBody,
    typography: {
      ...typo.typography,
      display: picked.fontHeading,
      heading: picked.fontHeading,
      body: picked.fontBody,
      label: picked.fontBody,
    },
  };
}

function mockTypography(
  businessBrief: string,
  verticalProfile?: VerticalDesignProfile,
  variationSeed?: number
): TypographyPartial {
  if (verticalProfile) {
    const base = mockTypographyForProfile(verticalProfile);
    return applyTypographySeed(base, verticalProfile.profileId, variationSeed);
  }
  const editorial = /fashion|editorial|luxury|bridal/i.test(businessBrief);
  return {
    fontHeading: editorial ? "Playfair Display" : GENERIC_THEME.fontHeading,
    fontBody: GENERIC_THEME.fontBody,
    sectionGapMode: editorial ? "airy" : "normal",
    layout: editorial
      ? { maxWidth: "1200px", gridColumns: 3, sectionGap: "5rem", cardMinHeight: "auto" }
      : GENERIC_THEME.layout,
    typography: editorial
      ? {
          display: "Playfair Display",
          heading: "Playfair Display",
          body: "Inter",
          label: "Inter",
          mono: "IBM Plex Mono",
        }
      : GENERIC_THEME.typography,
  };
}
