import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: true,
    chat: vi.fn(),
    getSectionModel: vi.fn(() => "test-model"),
  },
}));

import { llm } from "../src/llm/client.js";
import { repairFlaggedSections } from "../src/agents/section-repair-agent.js";
import { resetFallbackTracker, totalFallbacks } from "../src/util/fallback-tracker.js";
import type { ExpandedBrief, QAIssue } from "../src/types.js";

const BRIEF: ExpandedBrief = {
  businessName: "Cedar & Co",
  tagline: "Sourdough, done right",
  elevatorPitch: "A neighborhood bakery baking sourdough fresh every morning in Bristol.",
  expandedBrief: "Cedar & Co is a sourdough bakery in Bristol.",
  targetAudience: "Locals",
  services: ["Sourdough loaves", "Pastries", "Custom cakes"],
  differentiators: ["Wild yeast starter", "Baked fresh daily", "Locally sourced flour"],
  tone: "Warm",
  primaryCta: "Order online",
};

function sectionHtml(sectionId: string, runId: string, text: string): string {
  return `<!doctype html><html><body>
    <div data-tpl="tpl_x" data-role="hero" data-section="${sectionId}">
      <p data-wg-edit="${runId}">${text}</p>
    </div>
  </body></html>`;
}

describe("repairFlaggedSections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFallbackTracker();
    delete process.env.PIPELINE_QUALITY;
    (llm as unknown as { isAvailable: boolean }).isAvailable = true;
  });
  afterEach(() => {
    delete process.env.PIPELINE_QUALITY;
  });

  const issue: QAIssue = {
    severity: "hard",
    code: "RAW_JSON_LEAK",
    message: "leak",
    sectionId: "sec_hero",
  };

  it("targets a section flagged SLOT_SKIPPED — compose.ts's own signal, not a QA leak pattern", async () => {
    const html = sectionHtml("sec_hero", "tpl_x:sec_hero#0", "Generic vendor text nobody wrote for this business.");
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(
        JSON.stringify({ tool: "check_text", args: { text: "Fresh sourdough baked daily in Bristol." } })
      )
      .mockResolvedValueOnce(
        JSON.stringify({ finish: true, fixes: [{ id: "tpl_x:sec_hero#0", text: "Fresh sourdough baked daily in Bristol." }] })
      );
    const result = await repairFlaggedSections(BRIEF, "home", html, [
      { severity: "hard", code: "SLOT_SKIPPED", message: "1 copy slot left as template text", sectionId: "sec_hero" },
    ]);
    expect(result.attempted).toBe(1);
    expect(result.overrides["tpl_x:sec_hero#0"]).toBe("Fresh sourdough baked daily in Bristol.");
  });

  it("does nothing when no issue names a sectionId", async () => {
    const html = sectionHtml("sec_hero", "tpl_x:sec_hero#0", "broken text");
    const result = await repairFlaggedSections(BRIEF, "home", html, [{ ...issue, sectionId: undefined }]);
    expect(result.attempted).toBe(0);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("checks its proposed fix via the tool loop before submitting, and applies a fix that passes", async () => {
    const html = sectionHtml("sec_hero", "tpl_x:sec_hero#0", '{"headline":"broken"}');
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(
        JSON.stringify({ tool: "check_text", args: { text: "Fresh sourdough baked daily in Bristol." } })
      )
      .mockResolvedValueOnce(
        JSON.stringify({ finish: true, fixes: [{ id: "tpl_x:sec_hero#0", text: "Fresh sourdough baked daily in Bristol." }] })
      );

    const result = await repairFlaggedSections(BRIEF, "home", html, [issue]);
    expect(result.attempted).toBe(1);
    expect(result.overrides["tpl_x:sec_hero#0"]).toBe("Fresh sourdough baked daily in Bristol.");
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it("rejects a submitted fix that is still JSON-shaped even if the agent skipped check_text", async () => {
    const html = sectionHtml("sec_hero", "tpl_x:sec_hero#0", '{"headline":"broken"}');
    vi.mocked(llm.chat).mockResolvedValueOnce(
      JSON.stringify({ finish: true, fixes: [{ id: "tpl_x:sec_hero#0", text: '{"headline":"still broken"}' }] })
    );
    const result = await repairFlaggedSections(BRIEF, "home", html, [issue]);
    expect(result.overrides).toEqual({});
  });

  it("ignores a fix for a run id that was never one of the flagged section's own runs", async () => {
    const html = sectionHtml("sec_hero", "tpl_x:sec_hero#0", "broken");
    vi.mocked(llm.chat).mockResolvedValueOnce(
      JSON.stringify({ finish: true, fixes: [{ id: "tpl_x:other_section#0", text: "Not offered." }] })
    );
    const result = await repairFlaggedSections(BRIEF, "home", html, [issue]);
    expect(result.overrides).toEqual({});
  });

  it("degrades to no overrides, outside strict mode, when the tool loop fails entirely", async () => {
    const html = sectionHtml("sec_hero", "tpl_x:sec_hero#0", "broken");
    vi.mocked(llm.chat).mockRejectedValue(new Error("network down"));
    const result = await repairFlaggedSections(BRIEF, "home", html, [issue]);
    expect(result.overrides).toEqual({});
    expect(totalFallbacks()).toBe(1);
  });

  it("rethrows in strict quality mode instead of degrading", async () => {
    process.env.PIPELINE_QUALITY = "1";
    const html = sectionHtml("sec_hero", "tpl_x:sec_hero#0", "broken");
    vi.mocked(llm.chat).mockRejectedValue(new Error("network down"));
    await expect(repairFlaggedSections(BRIEF, "home", html, [issue])).rejects.toThrow(/network down/);
  });
});
