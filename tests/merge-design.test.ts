import { describe, it, expect } from "vitest";
import { mergeDesignSystem } from "../src/agents/merge-design.js";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";

describe("mergeDesignSystem", () => {
  it("merges palette, typography, and nav surface into SiteTheme", () => {
    const brief = {
      businessName: "Test",
      tagline: "Tag",
      elevatorPitch: "Pitch",
      expandedBrief: "Brief",
      targetAudience: "All",
      services: ["A", "B", "C"],
      differentiators: ["X", "Y", "Z"],
      tone: "calm",
      primaryCta: "Go",
    };

    const theme = mergeDesignSystem({
      palette: {
        vertical: "fashion",
        mood: "editorial luxe",
        gradientMood: "vivid",
        accentRole: "editorial",
        colors: {
          // Explicit dark bg (independent of GENERIC_THEME, which is a light default) so this
          // exercises syncPageToneWithBg's dark-luminance branch regardless of that default.
          bg: "#0a0a0a",
          surface: "#141414",
          text: "#fafafa",
          muted: GENERIC_THEME.colors.muted,
          accent: GENERIC_THEME.colors.accent,
          accentSoft: GENERIC_THEME.colors.accentSoft,
          gradientFrom: GENERIC_THEME.colors.gradientFrom,
          gradientTo: GENERIC_THEME.colors.gradientTo,
        },
      },
      typography: {
        fontHeading: "Playfair Display",
        fontBody: "Inter",
        sectionGapMode: "airy",
      },
      navSurface: {
        pageTone: "light",
        navTreatment: "glass-dark",
        colors: {
          navBg: "rgba(12,14,20,0.78)",
          navText: "#f8fafc",
        },
      },
      brief,
      motionStyle: "staggered",
    });

    expect(theme.fontHeading).toBe("Playfair Display");
    expect(theme.pageTone).toBe("dark");
    expect(theme.colors.navBg).toContain("rgba");
    expect(theme.colors.accent).toBe(GENERIC_THEME.colors.accent);
  });
});
