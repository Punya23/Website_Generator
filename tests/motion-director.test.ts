import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";
import { runMotionQA } from "../src/qa/motion-qa.js";
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
        {
          slug: "home",
          title: "Home",
          goal: "Convert",
          minBlocks: 8,
          layoutHint: "editorial",
          contentFocus: ["fashion"],
        },
        { slug: "about", title: "About", goal: "Trust", minBlocks: 6, layoutHint: "story", contentFocus: [] },
        { slug: "services", title: "Services", goal: "Sell", minBlocks: 8, layoutHint: "showcase", contentFocus: [] },
        { slug: "contact", title: "Contact", goal: "Lead", minBlocks: 4, layoutHint: "form", contentFocus: [] },
      ],
      compositionStrategy: "editorial rhythm",
      avoidPatterns: ["generic cards"],
      motionStyle: "staggered reveals",
    },
    designSystem: GENERIC_THEME,
    pages: {},
    mediaRegistry: [],
    cmsCollections: [],
    qaHistory: [],
  };
}

const blueprints: PageBlueprint[] = [
  {
    slug: "home",
    rhythm: "bleed-editorial-band",
    sections: [
      { id: "home_hero", templateId: "hero_editorial", intent: "Hero" },
      { id: "home_intro", templateId: "intro_statement", intent: "Intro" },
      { id: "home_stats", templateId: "stats_marquee", intent: "Proof" },
      { id: "home_cta", templateId: "cta_band", intent: "CTA" },
    ],
  },
];

describe("motion director agent", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.LLM_PROVIDER;
  });

  afterEach(() => {
    process.env = env;
  });

  it("produces motion plan that passes QA in mock mode", async () => {
    vi.resetModules();
    const { directMotionPlan } = await import("../src/agents/motion-director-agent.js");
    const plan = await directMotionPlan(mockCtx(), blueprints);
    expect(plan.globalPreset).toBeTruthy();
    expect(plan.sections.home_hero?.parallax).toBe(true);
    expect(plan.chrome.footer.entrance).toBe("stagger");

    const qa = runMotionQA(plan, blueprints);
    expect(qa.passed).toBe(true);
  });
});
