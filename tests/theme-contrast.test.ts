import { describe, it, expect } from "vitest";
import { normalizeTheme } from "../src/theme/contrast.js";
import { contrast } from "../src/theme/contrast.js";
import { PRESETS } from "../src/agents/theme-agent.js";

describe("theme contrast", () => {
  it("ensures text readable on surface for fitness preset", () => {
    const theme = normalizeTheme({ ...PRESETS.fitness });
    expect(contrast(theme.colors.text, theme.colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.colors.muted, theme.colors.surface)).toBeGreaterThanOrEqual(3);
  });

  it("separates surface from bg", () => {
    const theme = normalizeTheme({ ...PRESETS.fitness });
    expect(contrast(theme.colors.bg, theme.colors.surface)).toBeGreaterThan(1.2);
  });

  it("keeps salon preset readable", () => {
    const theme = normalizeTheme({ ...PRESETS.salon });
    expect(contrast(theme.colors.text, theme.colors.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
