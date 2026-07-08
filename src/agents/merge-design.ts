import type {
  ExpandedBrief,
  NavSurfacePartial,
  PalettePartial,
  SiteTheme,
  TypographyPartial,
} from "../types.js";
import { SiteThemeSchema } from "../types.js";
import { resolveMotionPreset } from "../motion/presets.js";
import { ensureReadableTheme, luminance } from "../theme/contrast.js";

import type { VerticalDesignProfile } from "../design/vertical-profiles.js";

export interface DesignCouncilInput {
  palette: PalettePartial;
  typography: TypographyPartial;
  navSurface: NavSurfacePartial;
  brief: ExpandedBrief;
  motionStyle?: string;
  verticalProfile?: VerticalDesignProfile;
}

/** Align pageTone with background luminance. */
export function syncPageToneWithBg(
  pageTone: SiteTheme["pageTone"],
  bg: string
): SiteTheme["pageTone"] {
  const dark = luminance(bg) < 0.45;
  if (dark) return "dark";
  if (pageTone === "dark") return "light";
  return pageTone ?? "light";
}

export function mergeDesignSystem(input: DesignCouncilInput): SiteTheme {
  const { palette, typography, navSurface, brief, motionStyle, verticalProfile } = input;

  const pageTone = syncPageToneWithBg(
    navSurface.pageTone ?? verticalProfile?.pageTone,
    palette.colors.bg
  );

  const merged = SiteThemeSchema.parse({
    vertical: palette.vertical,
    mood: palette.mood,
    fontHeading: typography.fontHeading,
    fontBody: typography.fontBody,
    motionStyle: motionStyle ?? "soft staggered reveals",
    motionPreset: verticalProfile?.motionPreset ?? resolveMotionPreset(motionStyle, brief.tone),
    pageTone,
    navTreatment: navSurface.navTreatment ?? verticalProfile?.navTreatment,
    navShape: navSurface.navShape ?? verticalProfile?.navShape,
    gradientMood: palette.gradientMood,
    accentRole: palette.accentRole,
    sectionGapMode: typography.sectionGapMode,
    typography: typography.typography,
    surfaces: navSurface.surfaces,
    layout: typography.layout,
    radiusScale: typography.radiusScale,
    shadowDepth: typography.shadowDepth,
    colors: {
      ...palette.colors,
      navBg: navSurface.colors.navBg,
      navText: navSurface.colors.navText,
      navMuted: navSurface.colors.navMuted,
      navActiveBg: navSurface.colors.navActiveBg,
      navActiveText: navSurface.colors.navActiveText,
    },
  });

  return ensureReadableTheme(merged);
}
