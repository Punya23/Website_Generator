import { describe, it, expect } from "vitest";
import { enforceProfileCoherence } from "../src/theme/profile-coherence.js";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";

describe("enforceProfileCoherence", () => {
  it("restores dark palette when luxury-dark theme was lightened", () => {
    const theme = {
      ...GENERIC_THEME,
      pageTone: "light" as const,
      colors: {
        ...GENERIC_THEME.colors,
        bg: "#fafafa",
        surface: "#ffffff",
        text: "#111111",
        muted: "#666666",
      },
    };

    const fixed = enforceProfileCoherence(theme, {
      profileId: "luxury-dark",
      pageTone: "dark",
      navTreatment: "glass-light",
      motionPreset: "parallax-hero",
    });

    expect(fixed.colors.bg).toBe("#0a0a0a");
    expect(fixed.pageTone).toBe("dark");
  });

  it("restores light palette when clinical theme was darkened", () => {
    const theme = {
      ...GENERIC_THEME,
      pageTone: "dark" as const,
      colors: {
        ...GENERIC_THEME.colors,
        bg: "#0a0a0a",
        surface: "#141414",
        text: "#fafafa",
        muted: "#a3a3a3",
      },
    };

    const fixed = enforceProfileCoherence(theme, {
      profileId: "clinical-light",
      pageTone: "light",
      navTreatment: "glass-dark",
      motionPreset: "fade-up",
    });

    expect(fixed.colors.bg).toBe("#f8fafc");
    expect(fixed.pageTone).toBe("light");
  });
});
