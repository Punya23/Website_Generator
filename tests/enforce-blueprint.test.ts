import { describe, it, expect } from "vitest";
import { enforceBlueprintWithPool } from "../src/design/enforce-blueprint.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { mockPlan } from "./helpers/mock-site.js";

describe("enforceBlueprintWithPool", () => {
  const brief = {
    businessName: "Noir Salon",
    tagline: "Refined",
    elevatorPitch: "Luxury salon",
    expandedBrief: "Luxury hair salon downtown",
    targetAudience: "Professionals",
    services: ["Cut", "Color"],
    differentiators: ["Craft"],
    tone: "refined",
    primaryCta: "Book",
  };

  it("uses pool templateIds even when LLM suggests different templates", () => {
    const sitePlan = mockPlan(brief);
    const home = sitePlan.pages.find((p) => p.slug === "home")!;
    const ctx = initSiteContext("Salon", brief, sitePlan, {
      vertical: "salon",
      mood: "luxury",
      fontHeading: "Cormorant",
      fontBody: "Inter",
      colors: {
        bg: "#0a0a0a",
        surface: "#141414",
        text: "#f5f5f5",
        muted: "#a3a3a3",
        accent: "#d4a574",
        accentSoft: "#2a2218",
        gradientFrom: "#d4a574",
        gradientTo: "#c9a962",
        navBg: "rgba(255,255,255,0.08)",
        navText: "#f5f5f5",
        navMuted: "#a3a3a3",
        navActiveBg: "#d4a574",
        navActiveText: "#0a0a0a",
      },
    });
    ctx.verticalProfile = {
      profileId: "luxury-dark",
      pageTone: "dark",
      heroBias: "hero_spotlight",
      blueprintFamily: "luxury-dark",
      grainOverlay: true,
      industryFamily: "salon",
    };
    ctx.variationSeed = 42;

    const llmBp = {
      slug: "home",
      rhythm: "mixed",
      sections: [
        { id: "x1", templateId: "cta_band", intent: "LLM intent one" },
        { id: "x2", templateId: "faq_accordion", intent: "LLM intent two" },
        { id: "x3", templateId: "hero_video", intent: "LLM intent three" },
      ],
    };

    const enforced = enforceBlueprintWithPool(home, ctx, llmBp);
    expect(enforced.sections[0]?.templateId).toMatch(/^hero_/);
    expect(enforced.sections.some((s) => s.templateId === "cta_band")).toBe(true);
    expect(enforced.sections.some((s) => s.templateId === "faq_accordion")).toBe(false);
    expect(enforced.sections[0]?.intent).toBe("LLM intent one");
  });
});
