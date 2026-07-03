import { describe, it, expect } from "vitest";
import { applyLayoutFixes } from "../src/agents/layout-fix-agent.js";
import { routeVisionIssues } from "../src/qa/vision-router.js";
import { mergeFixPlans } from "../src/orchestrator/react-vision-retry.js";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";
import type { SiteContext, SiteLayoutPlan } from "../src/types.js";

describe("react vision retry layout fixes", () => {
  it("applyLayoutFixes patches layoutPlan from vision routing", () => {
    const ctx: SiteContext = {
      businessName: "Test",
      businessBrief: "Brief",
      expandedBrief: {
        businessName: "Test",
        tagline: "T",
        elevatorPitch: "P",
        expandedBrief: "B",
        targetAudience: "A",
        services: ["A", "B", "C"],
        differentiators: ["X", "Y", "Z"],
        tone: "calm",
        primaryCta: "Go",
      },
      sitePlan: {
        pages: [],
        compositionStrategy: "editorial",
        avoidPatterns: [],
      },
      designSystem: GENERIC_THEME,
      pages: {},
      mediaRegistry: [],
      cmsCollections: [],
      qaHistory: [],
      layoutPlan: {
        sections: {
          home_hero: { variant: "default", density: "airy" },
        },
      } satisfies SiteLayoutPlan,
    };

    const plan = routeVisionIssues(
      [
        {
          severity: "hard",
          code: "VISUAL_SPACING",
          message: "Cramped hero spacing",
          sectionId: "home_hero",
          suggestion: "split offset layout",
        },
      ],
      "home"
    );

    applyLayoutFixes(ctx, plan.sections);
    expect(ctx.layoutPlan?.sections.home_hero?.variant).toBe("split-offset");
  });

  it("mergeFixPlans unions booleans and concatenates sections across pages", () => {
    const homePlan = routeVisionIssues(
      [{ severity: "hard", code: "VISUAL_MOTION_MONOTONY", message: "static", sectionId: "home_hero" }],
      "home"
    );
    const aboutPlan = routeVisionIssues(
      [
        { severity: "hard", code: "VISUAL_CHROME", message: "footer broken" },
        { severity: "hard", code: "VISUAL_COPY_WEAK", message: "weak", sectionId: "about_intro" },
      ],
      "about"
    );

    const merged = mergeFixPlans([homePlan, aboutPlan]);
    expect(merged.motion).toBe(true);
    expect(merged.chrome).toBe(true);
    expect(merged.design).toBe(false);
    expect(merged.sections).toHaveLength(1);
    expect(merged.sections[0]?.pageSlug).toBe("about");
  });
});
