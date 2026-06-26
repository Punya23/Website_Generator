import { describe, it, expect } from "vitest";
import { routeVisionIssues, visionFixPlanHasWork } from "../src/qa/vision-router.js";

describe("vision router", () => {
  it("routes nav contrast to design domain", () => {
    const plan = routeVisionIssues(
      [
        {
          severity: "hard",
          code: "VISUAL_NAV_CONTRAST",
          message: "Navigation links unreadable on glass nav",
        },
      ],
      "home"
    );
    expect(plan.design).toBe(true);
    expect(visionFixPlanHasWork(plan)).toBe(true);
  });

  it("routes motion monotony to motion domain", () => {
    const plan = routeVisionIssues(
      [
        {
          severity: "hard",
          code: "VISUAL_MOTION_MONOTONY",
          message: "Page feels static with no animation",
        },
      ],
      "home"
    );
    expect(plan.motion).toBe(true);
  });

  it("routes copy issues to section copy domain", () => {
    const plan = routeVisionIssues(
      [
        {
          severity: "hard",
          code: "VISUAL_COPY_WEAK",
          message: "Weak headline copy",
          sectionId: "home_hero",
        },
      ],
      "home"
    );
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]?.domain).toBe("copy");
    expect(plan.sections[0]?.sectionId).toBe("home_hero");
  });

  it("routes spacing to layout domain with sectionId", () => {
    const plan = routeVisionIssues(
      [
        {
          severity: "hard",
          code: "VISUAL_SPACING",
          message: "Cramped gap in feature section",
          sectionId: "home_features",
          suggestion: "use more airy spacing",
        },
      ],
      "home"
    );
    expect(plan.sections[0]?.domain).toBe("layout");
  });

  it("ignores soft issues", () => {
    const plan = routeVisionIssues(
      [{ severity: "soft", code: "VISUAL_MINOR", message: "minor nit" }],
      "home"
    );
    expect(visionFixPlanHasWork(plan)).toBe(false);
  });
});
