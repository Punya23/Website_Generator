import { describe, it, expect } from "vitest";
import {
  ensureReadableTheme,
  contrast,
  effectiveNavBg,
  resolveEffectiveColor,
  runDesignTokenQA,
} from "../src/theme/contrast.js";
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

  it("blends rgba nav over page background", () => {
    const effective = effectiveNavBg("rgba(255,255,255,0.9)", "#fafafa");
    expect(effective).toMatch(/^#[0-9a-f]{6}$/i);
    expect(resolveEffectiveColor("rgba(255,255,255,0.9)", "#fafafa")).toBe(effective);
  });

  it("fixes white glass nav text on light page", () => {
    const theme = ensureReadableTheme({
      ...GENERIC_THEME,
      pageTone: "light",
      navTreatment: "glass-light",
      colors: {
        ...GENERIC_THEME.colors,
        bg: "#fafafa",
        surface: "#ffffff",
        text: "#111111",
        muted: "#666666",
        navBg: "rgba(255,255,255,0.9)",
        navText: "#e2e8f0",
        navMuted: "#cbd5e1",
      },
    });
    const navEffective = effectiveNavBg(theme.colors.navBg, theme.colors.bg);
    expect(contrast(theme.colors.navText!, navEffective)).toBeGreaterThanOrEqual(4.5);
  });

  it("flags glass-light on light page in design QA", () => {
    const qa = runDesignTokenQA({
      ...GENERIC_THEME,
      pageTone: "light",
      navTreatment: "glass-light",
      colors: { ...GENERIC_THEME.colors, bg: "#fafafa" },
    });
    expect(qa.issues.some((i) => i.code === "GLASS_LIGHT_ON_LIGHT")).toBe(true);
  });
});
