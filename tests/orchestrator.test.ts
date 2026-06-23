import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSite } from "../src/orchestrator/orchestrator.js";

vi.mock("../src/qa/code-qa.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/qa/code-qa.js")>();
  return {
    ...actual,
    runCodeQA: vi.fn(async () => ({ passed: true, issues: [] })),
    screenshotPage: vi.fn(async () => "fakebase64"),
    screenshotPageDual: vi.fn(async () => ({ desktop: "fakebase64", mobile: "fakebase64" })),
    extractBlockManifest: vi.fn(async () => []),
    closeQABrowser: vi.fn(async () => {}),
  };
});

describe("Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates all 4 pages in parallel", async () => {
    const onPreviewReady = vi.fn();
    const result = await generateSite({
      businessName: "Test Salon",
      businessBrief: "Luxury hair salon in Austin",
      enableVisionPolish: false,
      onPreviewReady,
    });

    expect(result.site.pages.length).toBeGreaterThanOrEqual(4);
    expect(result.site.expandedBrief.services.length).toBeGreaterThan(3);
    expect(Object.keys(result.htmlPages)).toEqual(
      expect.arrayContaining(["home", "about", "services", "contact"])
    );
    expect(onPreviewReady).toHaveBeenCalled();
    expect(result.timingMs).toBeGreaterThan(0);
  });

  it("each page html contains nav, images, and animations", async () => {
    const result = await generateSite({
      businessName: "Apex Capital",
      businessBrief: "Wealth management and fiduciary retirement planning for families",
      enableVisionPolish: false,
    });

    expect(result.site.theme.vertical.length).toBeGreaterThan(0);

    for (const [slug, html] of Object.entries(result.htmlPages)) {
      if (slug === "index") continue;
      expect(html).toContain("Apex Capital");
      expect(html).toContain("site-nav");
      expect(html).toMatch(/https:\/\//);
      expect(html).toContain("reveal");
    }
  });

  it("QA results recorded per page", async () => {
    const result = await generateSite({
      businessName: "Glow Salon",
      businessBrief: "Hair salon",
      enableVisionPolish: false,
    });

    expect(Object.keys(result.qaResults).length).toBeGreaterThanOrEqual(4);
    for (const qa of Object.values(result.qaResults)) {
      expect(qa.passed).toBe(true);
    }
  });
});
