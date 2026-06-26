/** Nav/Surface Agent — page tone, nav treatment, and nav color tokens only. */
import type { NavSurfacePartial } from "../types.js";
import type { VerticalDesignProfile } from "../design/vertical-profiles.js";
import { mockNavForProfile } from "../design/vertical-profiles.js";
import { NavSurfacePartialSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { GENERIC_THEME } from "./theme-agent.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { validateAgentOutput, type AgentContract } from "./contracts/index.js";

const NAV_SURFACE_CONTRACT: AgentContract<NavSurfacePartial> = {
  name: "NavSurfaceAgent",
  role: "Output page tone, nav treatment, and nav colors only.",
  outputSchema: NavSurfacePartialSchema,
  forbiddenFields: ["fontHeading", "fontBody", "gradientFrom", "gradientTo", "accent", "motionPreset"],
};

const NAV_SURFACE_PROMPT = `You are a navigation and surface treatment specialist.

OUTPUT (your only job): nav/surface JSON.
FORBIDDEN: fonts, accent/gradient colors (except nav-specific tokens), motion, templates.

Rules:
- pageTone: light | dark | warm | cool
- navTreatment: glass-dark | glass-light | solid | minimal
  - Light page + editorial → glass-dark with rgba(10,12,18,0.72) navBg + light navText
  - Dark page → glass-light or solid
- Glass nav: navBg alpha 0.6–0.85
- surfaces: default, elevated, none descriptions

Output JSON:
{
  "pageTone": "light|dark|warm|cool",
  "navTreatment": "glass-dark|glass-light|solid|minimal",
  "surfaces": { "default", "elevated", "none" },
  "colors": { "navBg", "navText", "navMuted", "navActiveBg", "navActiveText" }
}`;

export async function generateNavSurface(
  businessName: string,
  businessBrief: string,
  pageToneHint?: string,
  verticalProfile?: VerticalDesignProfile,
  variationSeed?: number
): Promise<NavSurfacePartial> {
  if (llm.isAvailable) {
    try {
      const profileHint = verticalProfile
        ? `\nVertical profile: ${verticalProfile.profileId}, preferred pageTone: ${verticalProfile.pageTone}, nav: ${verticalProfile.navTreatment}`
        : "";
      const seedHint = variationSeed !== undefined ? `\nVariation seed: ${variationSeed}` : "";
      const raw = await llm.chat(
        NAV_SURFACE_PROMPT,
        `Business: ${businessName}\nBrief: ${businessBrief}\nPage tone hint: ${pageToneHint ?? verticalProfile?.pageTone ?? "derive from brand"}${profileHint}${seedHint}`,
        { jsonMode: true, temperature: variationSeed !== undefined ? 0.6 : 0.55 }
      );
      return validateAgentOutput(NAV_SURFACE_CONTRACT, JSON.parse(raw));
    } catch (err) {
      pipelineLog(
        `[pipeline] Nav surface agent failed: ${err instanceof Error ? err.message : String(err)} — using default nav`
      );
      if (!allowMocks()) return mockNavSurface(businessBrief, verticalProfile);
    }
  } else {
    if (!allowMocks()) requireLlm("nav surface agent");
  }

  return mockNavSurface(businessBrief, verticalProfile);
}

function mockNavSurface(businessBrief: string, verticalProfile?: VerticalDesignProfile): NavSurfacePartial {
  if (verticalProfile) return mockNavForProfile(verticalProfile);
  const editorial = /fashion|editorial|luxury|bridal/i.test(businessBrief);
  return {
    pageTone: editorial ? "light" : GENERIC_THEME.pageTone,
    navTreatment: editorial ? "glass-dark" : GENERIC_THEME.navTreatment,
    surfaces: editorial
      ? { default: "none", elevated: "pricing panels only", none: "typography-first sections" }
      : GENERIC_THEME.surfaces,
    colors: editorial
      ? {
          navBg: "rgba(10,12,18,0.72)",
          navText: "#f5f5f5",
          navMuted: "#a3a3a3",
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
