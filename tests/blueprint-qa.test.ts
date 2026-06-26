import { describe, it, expect } from "vitest";
import { runBlueprintQA } from "../src/qa/blueprint-qa.js";
import type { PageBlueprint, SiteContext } from "../src/types.js";

describe("runBlueprintQA", () => {
  const ctx = {
    verticalProfile: { profileId: "clinical-light" },
  } as SiteContext;

  it("fails when home lacks hero opener", () => {
    const blueprints: PageBlueprint[] = [
      {
        slug: "home",
        rhythm: "mixed",
        sections: [
          { id: "h1", templateId: "intro_statement", intent: "Open" },
          { id: "h2", templateId: "cta_band", intent: "Close" },
        ],
      },
    ];
    const qa = runBlueprintQA(blueprints, ctx);
    expect(qa.passed).toBe(false);
    expect(qa.issues.some((i) => i.code === "HOME_MISSING_HERO")).toBe(true);
  });

  it("passes valid pool-shaped home blueprint", () => {
    const blueprints: PageBlueprint[] = [
      {
        slug: "home",
        rhythm: "mixed",
        sections: [
          { id: "h1", templateId: "hero_split_cinematic", intent: "Hero" },
          { id: "h2", templateId: "stats_animated", intent: "Proof" },
          { id: "h3", templateId: "cta_band", intent: "Close" },
        ],
      },
    ];
    const qa = runBlueprintQA(blueprints, ctx);
    expect(qa.passed).toBe(true);
  });
});
