import { describe, it, expect } from "vitest";
import { ensureReadableTheme, contrast } from "../src/theme/contrast.js";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";

describe("theme contrast", () => {
  it("ensures text readable on surface", () => {
    const theme = ensureReadableTheme({ ...GENERIC_THEME });
    expect(contrast(theme.colors.text, theme.colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.colors.muted, theme.colors.surface)).toBeGreaterThanOrEqual(3);
  });

  it("preserves AI-chosen palette", () => {
    const theme = ensureReadableTheme({
      ...GENERIC_THEME,
      colors: {
        ...GENERIC_THEME.colors,
        bg: "#1a0f2e",
        surface: "#2d1b4e",
        accent: "#ff6b9d",
      },
    });
    expect(theme.colors.bg).toBe("#1a0f2e");
    expect(theme.colors.surface).toBe("#2d1b4e");
    expect(theme.colors.accent).toBe("#ff6b9d");
  });

  it("nudges illegible text on light surfaces", () => {
    const theme = ensureReadableTheme({
      ...GENERIC_THEME,
      colors: {
        ...GENERIC_THEME.colors,
        bg: "#f8fafc",
        surface: "#ffffff",
        text: "#cbd5e1",
        muted: "#94a3b8",
      },
    });
    expect(contrast(theme.colors.text, theme.colors.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
