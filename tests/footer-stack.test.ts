import { describe, it, expect } from "vitest";
import { composePageSections } from "../src/agents/page-composer-agent.js";
import { trimBlueprint } from "../src/design/blueprint-trim.js";
import type { PageBlueprint, SectionInstance, SiteContext } from "../src/types.js";

function mockCtx(): SiteContext {
  return {
    businessName: "Linea Studio",
    businessBrief: "Architecture studio",
    expandedBrief: {
      businessName: "Linea Studio",
      tagline: "Modern architecture",
      elevatorPitch: "Residential architecture",
      expandedBrief: "Design-led studio",
      targetAudience: "Homeowners",
      services: ["Design", "Renovation"],
      differentiators: ["Light", "Craft"],
      tone: "Refined",
      primaryCta: "Book consultation",
    },
    sitePlan: {
      pages: [{ slug: "home", title: "Home", goal: "Convert", minBlocks: 6, contentFocus: [] }],
      compositionStrategy: "editorial",
      avoidPatterns: [],
      visualArchetype: "editorial-light",
      industryFamily: "architecture",
      motionStyle: "stagger",
    },
    designSystem: {
      vertical: "architecture",
      mood: "editorial",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fafafa",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#c9a96e",
        accentSoft: "#f5f0e8",
        gradientFrom: "#c9a96e",
        gradientTo: "#8b7355",
        navBg: "#fff",
      },
    },
    verticalProfile: {
      profileId: "editorial-light",
      pageTone: "light",
      heroBias: "hero_spotlight",
      blueprintFamily: "editorial-light",
      grainOverlay: true,
      industryFamily: "architecture",
      copyHints: "refined",
      imageHints: "architecture",
      ctaPatterns: ["Book consultation"],
      proofPatterns: ["portfolio"],
    },
    variationSeed: 42,
  } as SiteContext;
}

describe("footer stack", () => {
  it("composePageSections does not inject extra sections", () => {
    const blueprint: PageBlueprint = {
      slug: "home",
      rhythm: "mixed",
      sections: [
        { id: "home_hero", templateId: "hero_spotlight", intent: "Hero" },
        { id: "home_features", templateId: "feature_bento", intent: "Features" },
        { id: "home_close", templateId: "footer_cta", intent: "Close" },
      ],
    };
    const instances: SectionInstance[] = blueprint.sections.map((s) => ({
      id: s.id,
      templateId: s.templateId,
      intent: s.intent,
      props: { headline: "Linea Studio" },
    }));

    const composed = composePageSections(blueprint, instances);
    expect(composed).toHaveLength(3);
    expect(composed.map((s) => s.templateId)).toEqual([
      "hero_spotlight",
      "feature_bento",
      "footer_cta",
    ]);
    expect(composed.some((s) => s.templateId === "cta_band")).toBe(false);
    expect(composed.some((s) => s.templateId === "newsletter_band")).toBe(false);
  });

  it("trimBlueprint keeps at most one conversion closer", () => {
    const bp: PageBlueprint = {
      slug: "home",
      rhythm: "mixed",
      sections: [
        { id: "h0", templateId: "hero_spotlight", intent: "Hero" },
        { id: "h1", templateId: "feature_bento", intent: "Work" },
        { id: "h2", templateId: "footer_cta", intent: "Close" },
        { id: "h3", templateId: "cta_band", intent: "Also close" },
        { id: "h4", templateId: "newsletter_band", intent: "Newsletter" },
      ],
    };

    const trimmed = trimBlueprint(bp, mockCtx());
    const closers = trimmed.sections.filter((s) =>
      ["cta_band", "footer_cta", "newsletter_band"].includes(s.templateId)
    );
    expect(closers.length).toBeLessThanOrEqual(1);
  });
});
