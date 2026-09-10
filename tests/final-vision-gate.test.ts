import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agents/vision-agent.js", () => ({
  runVisionQa: vi.fn(),
}));

import { runVisionQa } from "../src/agents/vision-agent.js";
import { isStrictlyBetter, judgeFinalScreenshots } from "../src/orchestrator/final-vision-gate.js";
import type { SiteTheme } from "../src/types.js";

const THEME = { vertical: "bakery", mood: "warm" } as unknown as SiteTheme;

describe("judgeFinalScreenshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when every page's vision judge reports no hard issues", async () => {
    vi.mocked(runVisionQa).mockResolvedValue({ status: "complete", issues: [], appliedFixes: [] });
    const verdict = await judgeFinalScreenshots({ home: "shot-home", about: "shot-about" }, THEME);
    expect(verdict.passed).toBe(true);
    expect(verdict.hardIssueCount).toBe(0);
    expect(verdict.perPage.home!.passed).toBe(true);
    expect(verdict.perPage.about!.passed).toBe(true);
  });

  it("fails when any page has a hard vision issue, and counts hard issues across all pages", async () => {
    vi.mocked(runVisionQa).mockImplementation(async (_shot, slug) => {
      if (slug === "home") {
        return {
          status: "complete",
          issues: [
            { severity: "hard", code: "VISUAL_GENERIC_TEMPLATE", message: "looks generic" },
            { severity: "soft", code: "VISUAL_SPACING", message: "minor gap" },
          ],
          appliedFixes: [],
        };
      }
      return { status: "complete", issues: [], appliedFixes: [] };
    });
    const verdict = await judgeFinalScreenshots({ home: "shot-home", about: "shot-about" }, THEME);
    expect(verdict.passed).toBe(false);
    expect(verdict.hardIssueCount).toBe(1);
    expect(verdict.perPage.home!.passed).toBe(false);
    expect(verdict.perPage.about!.passed).toBe(true);
  });

  it("a soft-only issue does not fail the page", async () => {
    vi.mocked(runVisionQa).mockResolvedValue({
      status: "complete",
      issues: [{ severity: "soft", code: "VISUAL_SPACING", message: "minor gap" }],
      appliedFixes: [],
    });
    const verdict = await judgeFinalScreenshots({ home: "shot-home" }, THEME);
    expect(verdict.passed).toBe(true);
    expect(verdict.hardIssueCount).toBe(0);
  });

  it("passes trivially on an empty screenshot map — an unavailable screenshot pass never blocks a generation", async () => {
    const verdict = await judgeFinalScreenshots({}, THEME);
    expect(verdict.passed).toBe(true);
    expect(verdict.hardIssueCount).toBe(0);
    expect(runVisionQa).not.toHaveBeenCalled();
  });

  it("judges every page independently — one page's issues don't leak into another's", async () => {
    vi.mocked(runVisionQa).mockImplementation(async (_shot, slug) => ({
      status: "complete",
      issues: slug === "contact" ? [{ severity: "hard", code: "VISUAL_CHROME", message: "broken footer" }] : [],
      appliedFixes: [],
    }));
    const verdict = await judgeFinalScreenshots({ home: "a", about: "b", contact: "c" }, THEME);
    expect(verdict.perPage.home!.issues).toEqual([]);
    expect(verdict.perPage.about!.issues).toEqual([]);
    expect(verdict.perPage.contact!.issues).toHaveLength(1);
  });
});

describe("isStrictlyBetter", () => {
  it("is true when the candidate has fewer hard issues than the incumbent", () => {
    const incumbent = { passed: false, hardIssueCount: 3, perPage: {} };
    const candidate = { passed: false, hardIssueCount: 1, perPage: {} };
    expect(isStrictlyBetter(candidate, incumbent)).toBe(true);
  });

  it("is false on a tie — a redo that doesn't strictly improve keeps the original", () => {
    const incumbent = { passed: false, hardIssueCount: 2, perPage: {} };
    const candidate = { passed: false, hardIssueCount: 2, perPage: {} };
    expect(isStrictlyBetter(candidate, incumbent)).toBe(false);
  });

  it("is false when the candidate is worse", () => {
    const incumbent = { passed: false, hardIssueCount: 1, perPage: {} };
    const candidate = { passed: false, hardIssueCount: 4, perPage: {} };
    expect(isStrictlyBetter(candidate, incumbent)).toBe(false);
  });
});
