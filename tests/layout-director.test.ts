import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  coerceLayoutVariant,
  sanitizeLlmLayoutPlan,
} from "../src/agents/layout-director-agent.js";
import { runLayoutQA } from "../src/qa/layout-qa.js";
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
      compositionStrategy: "editorial rhythm",
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
    rhythm: "bleed-editorial-band",
    sections: [
      { id: "home_hero", templateId: "hero_editorial", intent: "Hero" },
      { id: "home_intro", templateId: "intro_statement", intent: "Intro" },
      { id: "home_cta", templateId: "cta_band", intent: "CTA" },
    ],
  },
];

describe("layout director agent", () => {
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

  it("coerces invalid layout variant aliases", () => {
    expect(coerceLayoutVariant("full_bleed_left", "default")).toBe("full-bleed-left");
    expect(coerceLayoutVariant("centered", "default")).toBe("centered-stack");
    expect(coerceLayoutVariant("not-a-real-variant", "band-wide")).toBe("band-wide");
  });

  it("sanitizes malformed LLM layout output", () => {
    const ctx = mockCtx();
    const plan = sanitizeLlmLayoutPlan(
      {
        layoutPlan: {
          sections: {
            home_hero: { variant: "full_bleed_left", density: "airy" },
            home_intro: { variant: "centered", density: "normal" },
            home_cta: { variant: "band", density: "compact" },
          },
        },
      },
      ctx,
      blueprints
    );

    expect(plan.sections.home_hero?.variant).toBe("full-bleed-left");
    expect(plan.sections.home_intro?.variant).toBe("centered-stack");
    expect(plan.sections.home_cta?.variant).toBe("band-wide");
    expect(runLayoutQA(plan, blueprints).passed).toBe(true);
  });

  it("produces layout plan that passes QA in mock mode", async () => {
    vi.resetModules();
    const { directLayoutPlan } = await import("../src/agents/layout-director-agent.js");
    const plan = await directLayoutPlan(mockCtx(), blueprints);
    expect(plan.sections.home_hero?.variant).toBeTruthy();
    expect(["full-bleed-left", "split-offset", "default"]).toContain(plan.sections.home_hero?.variant);

    const qa = runLayoutQA(plan, blueprints);
    expect(qa.passed).toBe(true);
  });
});
