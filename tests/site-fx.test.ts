import { describe, it, expect } from "vitest";
import { resolveSiteFxTreatment } from "../src/design/site-fx.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { mockPlan } from "./helpers/mock-site.js";

function ctxWithSeed(seed: number) {
  const brief = {
    businessName: "Studio North",
    tagline: "Design",
    elevatorPitch: "Creative studio",
    expandedBrief: "Brand studio",
    targetAudience: "Founders",
    services: ["Brand"],
    differentiators: ["Craft"],
    tone: "Crisp",
    primaryCta: "Start a project",
  };
  const ctx = initSiteContext("Studio", brief, mockPlan(brief), {
    vertical: "agency",
    mood: "editorial",
    fontHeading: "Inter",
    fontBody: "Inter",
    colors: {
      bg: "#fff",
      surface: "#fafafa",
      text: "#111",
      muted: "#666",
      accent: "#111",
      accentSoft: "#eee",
      gradientFrom: "#111",
      gradientTo: "#444",
      navBg: "#fff",
    },
  });
  ctx.variationSeed = seed;
  return ctx;
}

describe("site FX treatment", () => {
  it("defaults clean/editorial more often than spotlight from seed alone", () => {
    const counts = { clean: 0, editorial: 0, spotlight: 0, glass: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      counts[resolveSiteFxTreatment(ctxWithSeed(seed))]++;
    }
    expect(counts.clean + counts.editorial).toBeGreaterThan(counts.spotlight + counts.glass);
  });

  it("honors look archetype keywords for clean vs spotlight", () => {
    expect(
      resolveSiteFxTreatment(ctxWithSeed(1), {
        layoutArchetype: "clean solid-surface product",
        toneKeywords: ["minimal", "crisp"],
        preferredTemplateIds: [],
      })
    ).toBe("clean");

    expect(
      resolveSiteFxTreatment(ctxWithSeed(1), {
        layoutArchetype: "cursor spotlight mesh luxury",
        toneKeywords: ["premium"],
        preferredTemplateIds: [],
      })
    ).toBe("spotlight");
  });
});
