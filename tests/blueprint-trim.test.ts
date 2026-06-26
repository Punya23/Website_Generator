import { describe, it, expect } from "vitest";
import { trimBlueprint } from "../src/design/blueprint-trim.js";
import type { PageBlueprint, SiteContext } from "../src/types.js";

function mockCtx(overrides: Partial<SiteContext> = {}): SiteContext {
  return {
    businessName: "Moonrise Bakery",
    businessBrief: "Artisan bakery with fresh bread and pastry",
    expandedBrief: {
      businessName: "Moonrise Bakery",
      tagline: "Fresh daily",
      elevatorPitch: "Artisan breads and pastries",
      expandedBrief: "Local bakery serving sourdough, croissants, and seasonal pastries.",
      targetAudience: "Neighborhood food lovers",
      services: ["Sourdough", "Pastries", "Coffee"],
      differentiators: ["Organic flour", "Early hours", "Seasonal menu"],
      tone: "warm artisan",
      primaryCta: "Order now",
    },
    sitePlan: {
      pages: [
        { slug: "gallery", title: "Gallery", goal: "Show our work", minBlocks: 8, contentFocus: ["photos"] },
      ],
      compositionStrategy: "editorial",
      avoidPatterns: [],
      visualArchetype: "editorial-light",
      industryFamily: "bakery",
      motionStyle: "stagger",
    },
    designSystem: {
      vertical: "bakery",
      mood: "warm",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fafafa",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#c45",
        accentSoft: "#fee",
        gradientFrom: "#c45",
        gradientTo: "#e85",
        navBg: "#111",
      },
    },
    verticalProfile: {
      profileId: "editorial-light",
      pageTone: "light",
      heroBias: "hero_editorial",
      blueprintFamily: "editorial",
      grainOverlay: true,
      industryFamily: "bakery",
      copyHints: "warm",
      imageHints: "bakery",
      ctaPatterns: ["Order"],
      proofPatterns: ["reviews"],
    },
    variationSeed: 42,
    ...overrides,
  } as SiteContext;
}

describe("blueprint trim bakery gallery", () => {
  it("keeps gallery sections when menu intent (bakery) and leaves >=2 sections", () => {
    const bp: PageBlueprint = {
      slug: "gallery",
      rhythm: "editorial-contained-band",
      sections: [
        { id: "g0", templateId: "horizontal_gallery", intent: "Visual essay" },
        { id: "g1", templateId: "gallery_masonry", intent: "Selected work" },
        { id: "g2", templateId: "portfolio_carousel", intent: "Recent" },
        { id: "g3", templateId: "cta_band", intent: "Visit" },
      ],
    };

    const trimmed = trimBlueprint(bp, mockCtx());
    expect(trimmed.sections.length).toBeGreaterThanOrEqual(2);
    const galleryTemplates = trimmed.sections.filter((s) =>
      /gallery|portfolio_carousel|horizontal_gallery/.test(s.templateId)
    );
    expect(galleryTemplates.length).toBeGreaterThanOrEqual(1);
  });

  it("injects sections when trim would leave only one", () => {
    const bp: PageBlueprint = {
      slug: "pricing",
      rhythm: "mixed",
      sections: [{ id: "p0", templateId: "cta_band", intent: "Contact" }],
    };

    const trimmed = trimBlueprint(bp, mockCtx());
    expect(trimmed.sections.length).toBeGreaterThanOrEqual(2);
  });
});
