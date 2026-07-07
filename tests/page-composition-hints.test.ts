import { describe, it, expect } from "vitest";
import {
  buildSiteCompositionPlan,
  formatCompositionHintBlock,
} from "../src/agents/page-composition-hints.js";
import { componentManifestForPrompt } from "../src/agents/component-manifest.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { mockPlan } from "./helpers/mock-site.js";

function ctxForSeed(seed: number) {
  const brief = {
    businessName: "Linea Studio",
    tagline: "Architecture",
    elevatorPitch: "Residential architecture studio",
    expandedBrief: "Passive House design in Austin",
    targetAudience: "Homeowners",
    services: ["Design", "Renovation"],
    differentiators: ["Light"],
    tone: "Refined",
    primaryCta: "Book consultation",
  };
  const ctx = initSiteContext("Architecture", brief, mockPlan(brief), {
    vertical: "architecture",
    mood: "editorial",
    fontHeading: "Inter",
    fontBody: "Inter",
    colors: {
      bg: "#111",
      surface: "#1a1a1a",
      text: "#fff",
      muted: "#999",
      accent: "#c9a96e",
      accentSoft: "#2a2a2a",
      gradientFrom: "#c9a96e",
      gradientTo: "#8b7355",
      navBg: "#111",
    },
  });
  ctx.variationSeed = seed;
  return ctx;
}

describe("page composition hints", () => {
  it("assigns different heroes per page for the same site", () => {
    const ctx = ctxForSeed(42);
    const plan = buildSiteCompositionPlan(ctx);
    const heroes = new Set(Object.values(plan.pages).map((p) => p.heroComponent));
    expect(heroes.size).toBeGreaterThan(1);
  });

  it("allows FaqAccordion on at most one page", () => {
    const ctx = ctxForSeed(99);
    const plan = buildSiteCompositionPlan(ctx);
    const faqAllowed = Object.values(plan.pages).filter(
      (p) => !p.avoidComponents.includes("FaqAccordion")
    );
    expect(faqAllowed.length).toBe(1);
  });

  it("varies plan when seed changes", () => {
    const a = buildSiteCompositionPlan(ctxForSeed(1));
    const b = buildSiteCompositionPlan(ctxForSeed(99991));
    const aHeroes = Object.values(a.pages).map((p) => p.heroComponent).join(",");
    const bHeroes = Object.values(b.pages).map((p) => p.heroComponent).join(",");
    expect(aHeroes).not.toBe(bHeroes);
  });

  it("omits banned components and example props from page palette", () => {
    const text = componentManifestForPrompt("contact", {
      avoid: ["FaqAccordion", "NewsletterBand"],
    });
    expect(text).not.toContain("FaqAccordion");
    expect(text).not.toContain("Example props");
    expect(text).not.toContain("When:");
    expect(text).toContain("ContactSplit");
  });

  it("formats composition hint with required hero", () => {
    const ctx = ctxForSeed(7);
    const plan = buildSiteCompositionPlan(ctx);
    const block = formatCompositionHintBlock(plan, "home");
    expect(block).toContain("Required hero:");
    expect(block).toContain(plan.pages.home?.heroComponent ?? "");
    expect(block).toContain("Do NOT use:");
  });
});
