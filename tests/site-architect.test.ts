import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { architectSiteBlueprints } from "../src/agents/site-architect-agent.js";
import type { SiteContext } from "../src/types.js";
import { getTemplate } from "../src/section-templates/registry.js";

function minimalCtx(): SiteContext {
  return {
    businessName: "Test Gym",
    expandedBrief: {
      businessName: "Test Gym",
      tagline: "Stronger every day",
      elevatorPitch: "Boutique fitness studio",
      expandedBrief: "Boutique fitness studio with personal training",
      targetAudience: "fitness enthusiasts",
      services: ["Personal training", "Group classes"],
      differentiators: ["Expert coaches"],
      tone: "energetic",
      primaryCta: "Book a class",
    },
    sitePlan: {
      businessName: "Test Gym",
      pages: [
        { slug: "home", title: "Home", goal: "Convert visitors", navLabel: "Home" },
        { slug: "about", title: "About", goal: "Build trust", navLabel: "About" },
      ],
      motionStyle: "staggered",
      compositionStrategy: "mixed",
      visualArchetype: "fitness",
    },
    designSystem: {
      vertical: "fitness",
      mood: "energetic",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fff",
        surface: "#f5f5f5",
        text: "#111",
        muted: "#666",
        accent: "#e11",
        accentSoft: "#fee",
        gradientFrom: "#e11",
        gradientTo: "#a00",
        navBg: "#111",
      },
    },
    verticalProfile: undefined,
    variationSeed: 42,
  } as SiteContext;
}

describe("site architect", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.PIPELINE_QUALITY = "0";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("falls back to pool blueprints when not in quality mode", async () => {
    const pages = minimalCtx().sitePlan.pages;
    const blueprints = await architectSiteBlueprints(minimalCtx(), pages);
    expect(blueprints).toHaveLength(2);
    expect(blueprints[0]!.slug).toBe("home");
    expect(blueprints[0]!.sections[0]!.templateId.startsWith("hero_")).toBe(true);
    for (const section of blueprints.flatMap((b) => b.sections)) {
      expect(getTemplate(section.templateId)).toBeDefined();
    }
  });
});
