/** Nav/Surface Agent — page tone, nav treatment, and nav color tokens only. */
import type { NavSurfacePartial } from "../types.js";
import type { VerticalDesignProfile } from "../design/vertical-profiles.js";
import { mockNavForProfile } from "../design/vertical-profiles.js";
import { NavSurfacePartialSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm, handleLlmFailure } from "../util/llm-required.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { GENERIC_THEME } from "./theme-agent.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { validateAgentOutput, type AgentContract } from "./contracts/index.js";

const NAV_SURFACE_CONTRACT: AgentContract<NavSurfacePartial> = {
  name: "NavSurfaceAgent",
  role: "Output page tone, nav treatment, and nav colors only.",
  outputSchema: NavSurfacePartialSchema,
  forbiddenFields: ["fontHeading", "fontBody", "gradientFrom", "gradientTo", "accent", "motionPreset"],
};

const NAV_SURFACE_PROMPT = `You are a navigation and surface treatment specialist for distinctive brand websites.

OUTPUT (your only job): nav/surface JSON.
FORBIDDEN: fonts, accent/gradient colors (except nav-specific tokens), motion, templates.

Rules:
- pageTone: light | dark | warm | cool — match the brand, not a template
- navTreatment: glass-dark | glass-light | solid | minimal
  - Prefer solid or minimal unless the brief explicitly calls for glass/translucent chrome
  - Do NOT default to glass — choose what fits THIS business
- navBg should be opaque for solid/minimal (hex colors), translucent only for glass
- surfaces: describe how cards/panels feel for this brand

Output valid JSON only.

Output JSON:
{
  "pageTone": "light",
  "navTreatment": "solid",
  "surfaces": {
    "default": "none",
    "elevated": "subtle borders only",
    "none": "typography-first sections"
  },
  "colors": {
    "navBg": "#ffffff",
    "navText": "#111111",
    "navMuted": "#666666",
    "navActiveBg": "#c45c26",
    "navActiveText": "#ffffff"
  }
}`;

function navSurfaceUserPrompt(
  businessName: string,
  businessBrief: string,
  pageToneHint: string | undefined,
  verticalProfile: VerticalDesignProfile | undefined,
  variationSeed: number | undefined,
  parseError?: string
): string {
  const profileHint = verticalProfile
    ? `\nVertical profile: ${verticalProfile.profileId}, preferred pageTone: ${verticalProfile.pageTone}, nav: ${verticalProfile.navTreatment}`
    : "";
  const seedHint = variationSeed !== undefined ? `\nVariation seed: ${variationSeed}` : "";
  const retryBlock = parseError
    ? `\nPRIOR RESPONSE WAS INVALID JSON (${parseError}). Return ONLY strict JSON matching the schema.`
    : "";
  return `Business: ${businessName}\nBrief: ${businessBrief}\nPage tone hint: ${pageToneHint ?? verticalProfile?.pageTone ?? "derive from brand"}${profileHint}${seedHint}${retryBlock}`;
}

export async function generateNavSurface(
  businessName: string,
  businessBrief: string,
  pageToneHint?: string,
  verticalProfile?: VerticalDesignProfile,
  variationSeed?: number
): Promise<NavSurfacePartial> {
  if (llm.isAvailable) {
    try {
      const temperature = variationSeed !== undefined ? 0.6 : 0.55;
      return await chatJsonWithRetry(
        "nav surface agent",
        NAV_SURFACE_PROMPT,
        (parseError) =>
          navSurfaceUserPrompt(
            businessName,
            businessBrief,
            pageToneHint,
            verticalProfile,
            variationSeed,
            parseError
          ),
        { tokenRole: "design", initialTemperature: temperature },
        (raw) => validateAgentOutput(NAV_SURFACE_CONTRACT, parseLlmJson(raw))
      );
    } catch (err) {
      pipelineLog(
        `[pipeline] Nav surface agent failed: ${err instanceof Error ? err.message : String(err)} — using default nav`
      );
      if (!allowMocks()) handleLlmFailure("nav surface agent", err);
      recordFallback("nav_surface");
    }
  } else {
    if (!allowMocks()) requireLlm("nav surface agent");
  }

  return mockNavSurface(businessBrief, verticalProfile);
}

function mockNavSurface(businessBrief: string, verticalProfile?: VerticalDesignProfile): NavSurfacePartial {
  if (verticalProfile) return mockNavForProfile(verticalProfile);
  const editorial = /fashion|editorial|luxury|bridal|architecture|studio/i.test(businessBrief);
  return {
    pageTone: editorial ? "light" : GENERIC_THEME.pageTone,
    navTreatment: editorial ? "minimal" : "solid",
    surfaces: editorial
      ? { default: "none", elevated: "pricing panels only", none: "typography-first sections" }
      : GENERIC_THEME.surfaces,
    colors: editorial
      ? {
          navBg: "#ffffff",
          navText: "#111111",
          navMuted: "#666666",
          navActiveBg: "#c45c26",
          navActiveText: "#ffffff",
        }
      : {
          navBg: GENERIC_THEME.colors.navBg,
          navText: GENERIC_THEME.colors.navText,
          navMuted: GENERIC_THEME.colors.navMuted,
          navActiveBg: GENERIC_THEME.colors.navActiveBg,
          navActiveText: GENERIC_THEME.colors.navActiveText,
        },
  };
}
