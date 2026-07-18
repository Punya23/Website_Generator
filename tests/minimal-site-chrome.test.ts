import { describe, it, expect } from "vitest";
import { minimalChromeSpec, minimalMotionPlan } from "../src/agents/minimal-site-chrome.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { mockPlan } from "./helpers/mock-site.js";
import type { PageBlueprint } from "../src/types.js";

function ctxForSeed(seed: number, businessName = "Acme") {
  const brief = {
    businessName,
    tagline: "Tag",
    elevatorPitch: "Pitch",
    expandedBrief: "Brief",
    targetAudience: "All",
    services: ["A", "B", "C"],
    differentiators: ["X", "Y", "Z"],
    tone: "calm",
    primaryCta: "Go",
  };
  const sitePlan = mockPlan(brief);
  const ctx = initSiteContext(businessName, brief, sitePlan, {
    vertical: "test",
    mood: "calm",
    fontHeading: "Inter",
    fontBody: "Inter",
    colors: {
      bg: "#fff",
      surface: "#fff",
      text: "#111",
      muted: "#666",
      accent: "#000",
      accentSoft: "#eee",
      gradientFrom: "#000",
      gradientTo: "#111",
      navBg: "#fff",
    },
  });
  ctx.variationSeed = seed;
  return ctx;
}

const BLUEPRINTS: PageBlueprint[] = [
  { slug: "home", rhythm: "mixed", sections: [{ id: "home_s0", templateId: "hero_editorial", intent: "hero" }] },
  { slug: "contact", rhythm: "mixed", sections: [{ id: "contact_s0", templateId: "contact_split", intent: "contact" }] },
];

describe("minimalChromeSpec", () => {
  it("does not hardcode footer layout to the same value across seeds", () => {
    const layouts = new Set(
      Array.from({ length: 12 }, (_, i) => minimalChromeSpec(ctxForSeed(i), BLUEPRINTS).footer.layout)
    );
    expect(layouts.size).toBeGreaterThan(1);
  });

  it("varies footer surface across seeds", () => {
    const surfaces = new Set(
      Array.from({ length: 12 }, (_, i) => minimalChromeSpec(ctxForSeed(i), BLUEPRINTS).footer.surface)
    );
    expect(surfaces.size).toBeGreaterThan(1);
  });

  it("is deterministic for the same seed", () => {
    const a = minimalChromeSpec(ctxForSeed(7), BLUEPRINTS);
    const b = minimalChromeSpec(ctxForSeed(7), BLUEPRINTS);
    expect(a.footer.layout).toBe(b.footer.layout);
  });

  it("keeps motion-plan nav shadowOnScroll enabled", () => {
    const ctx = ctxForSeed(1);
    const chrome = minimalChromeSpec(ctx, BLUEPRINTS);
    const plan = minimalMotionPlan(ctx, BLUEPRINTS, chrome);
    expect(plan.chrome.nav.shadowOnScroll).toBe(true);
  });
});
