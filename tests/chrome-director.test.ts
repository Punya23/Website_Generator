import { describe, it, expect } from "vitest";
import { directChromeSpec } from "../src/agents/chrome-director-agent.js";
import { runChromeQA } from "../src/qa/chrome-qa.js";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";
import type { PageBlueprint, SiteContext } from "../src/types.js";

function mockCtx(): SiteContext {
  return {
    businessName: "Dstyle",
    businessBrief: "Fashion boutique",
    expandedBrief: {
      businessName: "Dstyle",
      tagline: "Curated fashion",
      elevatorPitch: "Premium fashion",
      expandedBrief: "Fashion boutique",
      targetAudience: "style seekers",
      services: ["Styling", "Retail", "Consulting"],
      differentiators: ["Quality", "Taste", "Service"],
      tone: "editorial",
      primaryCta: "Shop now",
    },
    sitePlan: {
      pages: [
        { slug: "home", title: "Home", goal: "Convert", minBlocks: 8, layoutHint: "editorial", contentFocus: [] },
        { slug: "about", title: "About", goal: "Trust", minBlocks: 6, layoutHint: "story", contentFocus: [] },
        { slug: "services", title: "Services", goal: "Sell", minBlocks: 8, layoutHint: "showcase", contentFocus: [] },
        { slug: "contact", title: "Contact", goal: "Lead", minBlocks: 4, layoutHint: "form", contentFocus: [] },
      ],
      compositionStrategy: "editorial",
      avoidPatterns: [],
      visualArchetype: "editorial fashion",
    },
    designSystem: { ...GENERIC_THEME, accentRole: "editorial" },
    pages: {},
    mediaRegistry: [],
    cmsCollections: [],
    qaHistory: [],
  };
}

const blueprints: PageBlueprint[] = [
  {
    slug: "home",
    rhythm: "bleed-editorial",
    sections: [{ id: "home_hero", templateId: "hero_editorial", intent: "Hero" }],
  },
];

describe("chrome director agent", () => {
  it("produces chrome spec that passes QA in mock mode", async () => {
    const spec = await directChromeSpec(mockCtx(), blueprints);
    expect(spec.footer.ctaLabel).toBeTruthy();
    expect(spec.footer.layout).toBe("two-column");
    expect(spec.nav.compactOnScroll).toBe(false);

    const qa = runChromeQA(spec);
    expect(qa.passed).toBe(true);
  });
});
