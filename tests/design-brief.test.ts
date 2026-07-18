import { describe, it, expect } from "vitest";
import { generateFontLayout } from "../src/react-codegen/font-codegen.js";
import { applyDesignBriefToTheme, type SiteLookProfile } from "../src/agents/site-look-agent.js";
import type { SiteTheme } from "../src/types.js";

function baseTheme(overrides: Partial<SiteTheme> = {}): SiteTheme {
  return {
    vertical: "test",
    mood: "test",
    fontHeading: "Outfit",
    fontBody: "Inter",
    colors: {
      bg: "#fff",
      surface: "#fff",
      text: "#111",
      muted: "#666",
      accent: "#111",
      accentSoft: "#eee",
      gradientFrom: "#111",
      gradientTo: "#333",
      navBg: "#fff",
    },
    ...overrides,
  } as SiteTheme;
}

function profile(overrides: Partial<SiteLookProfile>): SiteLookProfile {
  return {
    layoutArchetype: "",
    toneKeywords: [],
    preferredTemplateIds: [],
    aestheticDirection: "",
    typeScale: "balanced",
    spacingDensity: "comfortable",
    motionIntensity: "standard",
    ...overrides,
  };
}

function h1(theme: SiteTheme): string {
  return generateFontLayout(theme).typeScaleCss.match(/--text-h1: ([^;]+);/)?.[1] ?? "";
}

describe("design brief threading", () => {
  it("typeScaleRatio drives a distinct, larger scale for dramatic than compact", () => {
    const dramatic = h1(baseTheme({ typeScaleRatio: "dramatic" }));
    const balanced = h1(baseTheme({ typeScaleRatio: "balanced" }));
    const compact = h1(baseTheme({ typeScaleRatio: "compact" }));
    expect(dramatic).not.toBe(balanced);
    expect(balanced).not.toBe(compact);
    // Dramatic tops out larger than compact (5.75rem vs 3.5rem).
    expect(dramatic).toContain("5.75rem");
    expect(compact).toContain("3.5rem");
  });

  it("explicit typeScaleRatio wins over sectionGapMode inference", () => {
    // Airy gap would infer 'dramatic', but an explicit 'compact' ratio must override it.
    const theme = baseTheme({ sectionGapMode: "airy", typeScaleRatio: "compact" });
    expect(h1(theme)).toContain("3.5rem");
  });

  it("applyDesignBriefToTheme commits type scale, motion, and non-default spacing", () => {
    const theme = baseTheme({ sectionGapMode: "normal" });
    applyDesignBriefToTheme(theme, profile({ typeScale: "dramatic", motionIntensity: "expressive", spacingDensity: "spacious" }));
    expect(theme.typeScaleRatio).toBe("dramatic");
    expect(theme.motionIntensity).toBe("expressive");
    expect(theme.sectionGapMode).toBe("airy"); // spacious → airy
  });

  it("comfortable spacing leaves the design system's sectionGapMode untouched", () => {
    const theme = baseTheme({ sectionGapMode: "tight" });
    applyDesignBriefToTheme(theme, profile({ spacingDensity: "comfortable" }));
    expect(theme.sectionGapMode).toBe("tight");
  });
});
