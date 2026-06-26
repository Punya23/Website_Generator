import type { SiteContext, SiteTheme } from "../types.js";
import type { VerticalDesignProfile, VerticalProfileId } from "../design/vertical-profiles.js";
import {
  mockNavForProfile,
  mockPaletteForProfile,
} from "../design/vertical-profiles.js";
import { syncPageToneWithBg } from "../agents/merge-design.js";
import { ensureReadableTheme, luminance, runDesignTokenQA } from "./contrast.js";

export interface ProfileCoherenceInput {
  profileId: VerticalProfileId;
  pageTone: VerticalDesignProfile["pageTone"];
  navTreatment: VerticalDesignProfile["navTreatment"];
  motionPreset: VerticalDesignProfile["motionPreset"];
}

export function profileCoherenceFromContext(
  ctx: SiteContext
): ProfileCoherenceInput | undefined {
  if (!ctx.verticalProfile) return undefined;
  return {
    profileId: ctx.verticalProfile.profileId,
    pageTone: ctx.verticalProfile.pageTone,
    navTreatment: ctx.designSystem.navTreatment ?? "solid",
    motionPreset: ctx.designSystem.motionPreset ?? "fade-up",
  };
}

function stubProfile(profile: ProfileCoherenceInput): VerticalDesignProfile {
  return {
    profileId: profile.profileId,
    pageTone: profile.pageTone,
    navTreatment: profile.navTreatment,
    motionPreset: profile.motionPreset,
    heroBias: "",
    blueprintFamily: profile.profileId,
    grainOverlay: false,
    paletteHints: "",
    typographyHints: "",
    industryFamily: "",
    copyHints: "",
    imageHints: "",
    ctaPatterns: [],
    proofPatterns: [],
  };
}

/** Soft coherence: preserve LLM hue shifts; only reset luminance when profile tone drifts. */
export function enforceProfileCoherence(
  theme: SiteTheme,
  profile: ProfileCoherenceInput,
  businessName = ""
): SiteTheme {
  const palette = mockPaletteForProfile(stubProfile(profile), businessName);
  const nav = mockNavForProfile(stubProfile(profile));

  const out: SiteTheme = {
    ...theme,
    colors: { ...theme.colors },
    motionPreset: profile.motionPreset,
    navTreatment: profile.navTreatment,
  };

  const bgLum = luminance(out.colors.bg);
  const wantsDark = profile.profileId === "luxury-dark" || profile.pageTone === "dark";
  const wantsLight =
    profile.profileId === "clinical-light" ||
    profile.profileId === "corporate-light" ||
    profile.profileId === "editorial-light" ||
    profile.profileId === "warm-consumer";

  if (wantsDark && bgLum > 0.45) {
    out.colors.bg = palette.colors.bg;
    out.colors.surface = palette.colors.surface;
    out.colors.text = palette.colors.text;
    out.colors.muted = palette.colors.muted;
    out.pageTone = "dark";
  }

  if (wantsLight && bgLum < 0.45) {
    out.colors.bg = palette.colors.bg;
    out.colors.surface = palette.colors.surface;
    out.colors.text = palette.colors.text;
    out.colors.muted = palette.colors.muted;
    out.pageTone = profile.pageTone === "dark" ? "light" : profile.pageTone;
  }

  out.pageTone = syncPageToneWithBg(out.pageTone ?? profile.pageTone, out.colors.bg);
  out.colors.navBg = nav.colors.navBg;
  out.colors.navText = nav.colors.navText;
  out.colors.navMuted = nav.colors.navMuted;
  out.colors.navActiveBg = out.colors.accent || nav.colors.navActiveBg;
  out.colors.navActiveText = nav.colors.navActiveText;

  if (profile.profileId === "luxury-dark" || profile.profileId === "editorial-light") {
    out.gradientMood = out.gradientMood ?? "vivid";
  } else if (profile.profileId === "corporate-light" || profile.profileId === "clinical-light") {
    out.gradientMood = out.gradientMood === "vivid" ? "subtle" : out.gradientMood ?? "subtle";
  }

  const qa = runDesignTokenQA(out);
  if (!qa.passed) {
    return ensureReadableTheme({
      ...out,
      colors: {
        ...out.colors,
        accent: palette.colors.accent,
        accentSoft: palette.colors.accentSoft,
        gradientFrom: palette.colors.gradientFrom,
        gradientTo: palette.colors.gradientTo,
      },
    });
  }

  return ensureReadableTheme(out);
}
