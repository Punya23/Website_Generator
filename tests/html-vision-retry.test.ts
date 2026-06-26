import { describe, it, expect, vi } from "vitest";
import { applyHtmlVisionRetry } from "../src/orchestrator/html-vision-retry.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { mockPlan } from "./helpers/mock-site.js";

vi.mock("../src/agents/design-refine-agent.js", () => ({
  refineDesignSystem: vi.fn(async (_name: string, _industry: string, ds: unknown) => ({
    ...(ds as object),
    mood: "refined",
  })),
}));

describe("html-vision-retry", () => {
  it("refines design tokens on nav contrast vision issues", async () => {
    const brief = {
      businessName: "Acme",
      tagline: "Tag",
      elevatorPitch: "Pitch",
      expandedBrief: "Brief",
      targetAudience: "All",
      services: ["A"],
      differentiators: ["B"],
      tone: "Pro",
      primaryCta: "Start",
    };
    const ctx = initSiteContext("Tech", brief, mockPlan(brief), {
      vertical: "tech",
      mood: "clean",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fff",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#06c",
        accentSoft: "#eef",
        gradientFrom: "#06c",
        gradientTo: "#09f",
        navBg: "#fff",
        navText: "#111",
        navMuted: "#666",
        navActiveBg: "#06c",
        navActiveText: "#fff",
      },
    });

    const applied = await applyHtmlVisionRetry(
      ctx,
      [
        {
          severity: "hard",
          code: "VISUAL_NAV_CONTRAST",
          message: "Nav text unreadable on hero",
        },
      ],
      "home"
    );

    expect(applied).toBe(true);
    expect(ctx.designSystem.mood).toBe("refined");
  });

  it("skips when no design-domain vision issues", async () => {
    const brief = {
      businessName: "Acme",
      tagline: "Tag",
      elevatorPitch: "Pitch",
      expandedBrief: "Brief",
      targetAudience: "All",
      services: ["A"],
      differentiators: ["B"],
      tone: "Pro",
      primaryCta: "Start",
    };
    const ctx = initSiteContext("Tech", brief, mockPlan(brief), {
      vertical: "tech",
      mood: "clean",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fff",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#06c",
        accentSoft: "#eef",
        gradientFrom: "#06c",
        gradientTo: "#09f",
        navBg: "#fff",
        navText: "#111",
        navMuted: "#666",
        navActiveBg: "#06c",
        navActiveText: "#fff",
      },
    });

    const applied = await applyHtmlVisionRetry(
      ctx,
      [{ severity: "soft", code: "MINOR", message: "tiny spacing nit" }],
      "home"
    );
    expect(applied).toBe(false);
  });
});
