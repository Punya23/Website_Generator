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

- navShape: full-width | floating-capsule | floating-panel | split-inline
  This is the physical shape of the nav bar. Pick deliberately — it is one of the first
  things a visitor notices, and it should feel considered for THIS brand, not default.
  - full-width: classic edge-to-edge bar flush with the top of the viewport, straight
    bottom border, logo left / links right. Reads formal, institutional, dependable —
    good for clinics, law/finance, enterprise SaaS, corporate services.
  - floating-capsule: the whole nav (logo + links together) sits inset from the browser
    edges as one continuous rounded pill, floating with visible page background around
    it. Reads modern, app-like, confident — good for boutique/premium/nightlife/tech
    brands that want to feel current.
  - floating-panel: like floating-capsule but a softer-cornered rounded rectangle instead
    of a full pill, roomier internal padding. Reads warm, considered, editorial-adjacent —
    good for hospitality, wellness, food, community brands.
  - split-inline: the logo renders as its OWN small floating pill on the left, and the nav
    links render as a SEPARATE floating pill on the right, with a visible gap of page
    background between them. Reads distinctive, asymmetric, design-forward — good for
    creative studios, fashion, architecture, agencies, portfolio-driven brands.
  Vary this choice with the brand's personality and energy — do not fall back to
  full-width by default. Most current, well-designed brand sites lean toward one of the
  floating or split shapes; reserve full-width for genuinely formal/institutional brands.

Output valid JSON only.

Output JSON:
{
  "pageTone": "light",
  "navTreatment": "solid",
  "navShape": "floating-capsule",
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
    ? `\nVertical profile: ${verticalProfile.profileId}, preferred pageTone: ${verticalProfile.pageTone}, nav treatment: ${verticalProfile.navTreatment}, nav shape starting point: ${verticalProfile.navShape} (override navShape if a different shape reads better for this specific brief)`
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
    navShape: editorial ? "split-inline" : "floating-capsule",
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
