/** Design Director — coordinates Design Council specialists (backward-compatible entry). */
import type { ExpandedBrief, SitePlan, SiteTheme } from "../types.js";
import type { VerticalDesignProfile } from "../design/vertical-profiles.js";
import { generatePalette } from "./palette-agent.js";
import { generateTypography } from "./typography-agent.js";
import { generateNavSurface } from "./nav-surface-agent.js";
import { mergeDesignSystem } from "./merge-design.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { ensureReadableTheme } from "../theme/contrast.js";
import { GENERIC_THEME, slugifyIndustry } from "./theme-agent.js";
import { pipelineLog } from "../util/pipeline-log.js";

export async function generateDesignSystem(
  businessName: string,
  businessBrief: string,
  rawBrief?: string,
  expanded?: ExpandedBrief,
  options?: { sitePlan?: SitePlan; verticalProfile?: VerticalDesignProfile; variationSeed?: number }
): Promise<SiteTheme> {
  requireLlm("design system");

  const briefStub: ExpandedBrief =
    expanded ?? {
      businessName,
      tagline: businessName,
      elevatorPitch: businessBrief,
      expandedBrief: businessBrief,
      targetAudience: "customers",
      services: ["Service A", "Service B", "Service C"],
      differentiators: ["Quality", "Trust", "Results"],
      tone: "professional",
      primaryCta: "Get started",
    };

  const profile = options?.verticalProfile;
  const variationSeed = options?.variationSeed;

  try {
    const [palette, typography, navSurface] = await Promise.all([
      generatePalette(businessName, businessBrief, rawBrief, profile, variationSeed),
      generateTypography(
        businessName,
        businessBrief,
        profile?.typographyHints ?? paletteMoodHint(businessBrief),
        profile,
        variationSeed
      ),
      generateNavSurface(businessName, businessBrief, profile?.pageTone, profile, variationSeed),
    ]);

    return mergeDesignSystem({
      palette,
      typography,
      navSurface,
      brief: briefStub,
      motionStyle: options?.sitePlan?.motionStyle ?? briefStub.tone,
      verticalProfile: profile,
    });
  } catch (err) {
    pipelineLog(
      `[pipeline] Design system merge failed: ${err instanceof Error ? err.message : String(err)} — using profile theme`
    );
    if (profile) {
      const { mockPaletteForProfile, mockNavForProfile, mockTypographyForProfile } = await import(
        "../design/vertical-profiles.js"
      );
      const { applySeedToPalette, pickTypographyFromSeed } = await import("../design/seed-design.js");
      let palette = mockPaletteForProfile(profile, businessName);
      let typography = mockTypographyForProfile(profile);
      if (variationSeed !== undefined) {
        palette = applySeedToPalette(palette, variationSeed, profile.profileId) as typeof palette;
        const fonts = pickTypographyFromSeed(variationSeed, profile.profileId);
        typography = {
          ...typography,
          fontHeading: fonts.fontHeading,
          fontBody: fonts.fontBody,
          typography: {
            ...typography.typography,
            display: fonts.fontHeading,
            heading: fonts.fontHeading,
            body: fonts.fontBody,
            label: fonts.fontBody,
          },
        };
      }
      return mergeDesignSystem({
        palette,
        typography,
        navSurface: mockNavForProfile(profile),
        brief: briefStub,
        verticalProfile: profile,
      });
    }
    if (!allowMocks()) {
      return ensureReadableTheme({
        ...GENERIC_THEME,
        vertical: slugifyIndustry(businessBrief),
      });
    }
    return ensureReadableTheme({ ...GENERIC_THEME, vertical: slugifyIndustry(businessBrief) });
  }
}

function paletteMoodHint(brief: string): string {
  const lower = brief.toLowerCase();
  if (lower.includes("fashion") || lower.includes("editorial")) return "editorial airy";
  if (lower.includes("dental") || lower.includes("medical")) return "trustworthy calm";
  if (lower.includes("salon") || lower.includes("spa")) return "luxury intimate";
  return "refined modern";
}

/** @deprecated alias */
export const generateTheme = generateDesignSystem;
