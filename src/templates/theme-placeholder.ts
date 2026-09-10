/**
 * `SiteContext.designSystem` is required by the context schema, but a verbatim site's look comes
 * entirely from each source template's own recolored stylesheet — nothing reads these tokens to
 * render. They exist so context persistence, QA and admin views keep working, and they mirror the
 * active target palette so anything that *does* sample them reports the right colors.
 */
import type { SiteTheme } from "../types.js";
import { templatePaletteId } from "./config.js";
import { getPalette } from "./palette.js";

function buildPlaceholderTheme(): SiteTheme {
  const palette = getPalette(templatePaletteId());
  const [deepest = "#050505", surface = "#0b0b0d"] = palette.backgroundRamp;
  return {
    vertical: "verbatim-template",
    mood: "vendored template, recolored",
    fontHeading: "inherit",
    fontBody: "inherit",
    pageTone: "dark",
    navTreatment: "solid",
    colors: {
      bg: deepest,
      surface,
      text: palette.textOnDark,
      muted: palette.mutedOnDark,
      accent: palette.textOnDark,
      accentSoft: palette.mutedOnDark,
      gradientFrom: deepest,
      gradientTo: surface,
      navBg: deepest,
      navText: palette.textOnDark,
      navMuted: palette.mutedOnDark,
    },
  };
}

export const VERBATIM_PLACEHOLDER_THEME: SiteTheme = buildPlaceholderTheme();
