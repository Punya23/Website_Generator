import { describe, it, expect } from "vitest";
import { validateAndMergeBlueprint } from "../src/design/enforce-blueprint.js";
import { getTemplate } from "../src/section-templates/registry.js";
import type { PageBlueprint, PagePlan, SiteContext } from "../src/types.js";

function mockCtx(overrides: Partial<SiteContext> = {}): SiteContext {
  return {
    businessName: "Test Co",
    rawBrief: "A gym",
    expandedBrief: {
      businessName: "Test Co",
      tagline: "Move",
      elevatorPitch: "Gym",
      expandedBrief: "Fitness gym",
      targetAudience: "Athletes",
      services: ["Training"],
      differentiators: ["Quality"],
      tone: "energetic",
      primaryCta: "Join",
    },
    sitePlan: {
      pages: [{ slug: "home", title: "Home", goal: "Convert", navLabel: "Home" }],
      avoidPatterns: [],
      motionStyle: "dynamic",
      compositionStrategy: "immersive",
      visualArchetype: "editorial",
      industryFamily: "fitness",
    },
    designSystem: {
      vertical: "fitness",
      mood: "bold energy",
      fontHeading: "Inter",
      fontBody: "Inter",
      motionStyle: "dynamic",
      colors: {
        bg: "#000",
        surface: "#111",
        text: "#fff",
        muted: "#aaa",
        accent: "#f00",
        accentSoft: "#300",
        gradientFrom: "#000",
        gradientTo: "#111",
        navBg: "#000",
        navText: "#fff",
        navMuted: "#888",
        navActiveBg: "#222",
        navActiveText: "#fff",
      },
    },
    pages: {},
    reactPages: {},
    mediaRegistry: { usedUrls: [], assignments: {} },
    variationSeed: 42,
    verticalProfile: {
      profileId: "warm-consumer",
      pageTone: "dark",
      heroBias: "spotlight",
      blueprintFamily: "warm",
      grainOverlay: true,
      industryFamily: "fitness",
      copyHints: "bold",
      imageHints: "athletic",
      ctaPatterns: ["Join"],
      proofPatterns: ["stats"],
    },
    ...overrides,
  } as SiteContext;
}

const homePage: PagePlan = {
  slug: "home",
  title: "Home",
  goal: "Convert visitors",
  navLabel: "Home",
};

describe("validateAndMergeBlueprint", () => {
  it("keeps valid LLM templateIds", () => {
    const llmBp: PageBlueprint = {
      slug: "home",
      rhythm: "mixed",
      sections: [
        { id: "home_s0", templateId: "hero_spotlight", intent: "Open strong" },
        { id: "home_s1", templateId: "scroll_showcase", intent: "Show work" },
        { id: "home_s2", templateId: "cta_band", intent: "Close" },
      ],
    };
    const result = validateAndMergeBlueprint(homePage, mockCtx(), llmBp);
    expect(result.sections[0]!.templateId).toBe("hero_spotlight");
    expect(result.sections[1]!.templateId).toBe("scroll_showcase");
  });

  it("repairs unknown templateIds from pool", () => {
    const llmBp: PageBlueprint = {
      slug: "home",
      rhythm: "mixed",
      sections: [
        { id: "home_s0", templateId: "not_a_real_template", intent: "Hero" },
        { id: "home_s1", templateId: "intro_statement", intent: "Story" },
        { id: "home_s2", templateId: "cta_band", intent: "Close" },
      ],
    };
    const result = validateAndMergeBlueprint(homePage, mockCtx(), llmBp);
    expect(result.sections[0]!.templateId).toMatch(/^hero_/);
    expect(getTemplate(result.sections[0]!.templateId)).toBeDefined();
  });
});
