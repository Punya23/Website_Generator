import { describe, it, expect } from "vitest";
import { repairBlueprints } from "../src/design/blueprint-repair.js";
import type { PageBlueprint, SiteContext } from "../src/types.js";

function ctx(): SiteContext {
  return {
    businessName: "Studio",
    businessBrief: "Editorial brand",
    expandedBrief: {
      businessName: "Studio",
      tagline: "Craft",
      elevatorPitch: "Pitch",
      expandedBrief: "Editorial fashion studio",
      targetAudience: "Clients",
      services: ["Design", "Strategy", "Brand"],
      differentiators: ["A", "B", "C"],
      tone: "editorial",
      primaryCta: "Start",
    },
    sitePlan: {
      pages: [
        { slug: "home", title: "Home", goal: "Impress", minBlocks: 10, contentFocus: [] },
        { slug: "gallery", title: "Gallery", goal: "Show work", minBlocks: 8, contentFocus: [] },
      ],
      compositionStrategy: "editorial",
      avoidPatterns: [],
      visualArchetype: "editorial-light",
      industryFamily: "fashion",
      motionStyle: "stagger",
    },
    designSystem: {
      vertical: "fashion",
      mood: "editorial",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fafafa",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#111",
        accentSoft: "#eee",
        gradientFrom: "#111",
        gradientTo: "#333",
        navBg: "#111",
      },
    },
    verticalProfile: {
      profileId: "editorial-light",
      pageTone: "light",
      heroBias: "hero_editorial",
      blueprintFamily: "editorial",
      grainOverlay: true,
      industryFamily: "fashion",
      copyHints: "editorial",
      imageHints: "fashion",
      ctaPatterns: ["Start"],
      proofPatterns: ["press"],
    },
    variationSeed: 1,
  } as SiteContext;
}

describe("repairBlueprints", () => {
  it("injects premium section on home when missing", () => {
    const blueprints: PageBlueprint[] = [
      {
        slug: "home",
        rhythm: "mixed",
        sections: [
          { id: "h0", templateId: "hero_editorial", intent: "Hero" },
          { id: "h1", templateId: "intro_statement", intent: "Intro" },
          { id: "h2", templateId: "cta_band", intent: "CTA" },
        ],
      },
    ];
    const repaired = repairBlueprints(blueprints, ctx());
    const hasPremium = repaired[0]!.sections.some((s) =>
      ["hero_spotlight", "scroll_showcase", "horizontal_gallery"].includes(s.templateId)
    );
    expect(hasPremium).toBe(true);
  });

  it("ensures gallery page has at least 2 sections", () => {
    const blueprints: PageBlueprint[] = [
      {
        slug: "gallery",
        rhythm: "mixed",
        sections: [{ id: "g0", templateId: "cta_band", intent: "CTA" }],
      },
    ];
    const repaired = repairBlueprints(blueprints, ctx());
    expect(repaired[0]!.sections.length).toBeGreaterThanOrEqual(2);
  });
});
