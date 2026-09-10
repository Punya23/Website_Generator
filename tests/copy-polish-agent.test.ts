import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: true,
    chat: vi.fn(),
    getSectionModel: vi.fn(() => "test-model"),
  },
}));

import { llm } from "../src/llm/client.js";
import { polishComposedCopy } from "../src/agents/copy-polish-agent.js";
import { resetFallbackTracker, totalFallbacks } from "../src/util/fallback-tracker.js";
import type { ExpandedBrief } from "../src/types.js";

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

function pageHtml(runs: Array<{ id: string; text: string }>): string {
  const body = runs.map((r) => `<p data-wg-edit="${r.id}">${r.text}</p>`).join("");
  return `<!doctype html><html><body>${body}</body></html>`;
}

describe("polishComposedCopy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFallbackTracker();
    delete process.env.PIPELINE_QUALITY;
    delete process.env.ALLOW_MOCKS;
    (llm as unknown as { isAvailable: boolean }).isAvailable = true;
  });
  afterEach(() => {
    delete process.env.PIPELINE_QUALITY;
    delete process.env.ALLOW_MOCKS;
  });

  it("applies accepted edits, keyed by the page's own data-wg-edit ids, into overrides", async () => {
    const htmlPages = {
      home: pageHtml([{ id: "tpl_x:sec_hero#0", text: "We are a friendly neighborhood bakery." }]),
    };
    vi.mocked(llm.chat).mockResolvedValue(
      JSON.stringify({ edits: [{ id: "tpl_x:sec_hero#0", text: "Cedar & Co bakes sourdough fresh, every morning." }] })
    );
    const result = await polishComposedCopy(BRIEF, htmlPages);
    expect(result.skipped).toBe(false);
    expect(result.overrides["tpl_x:sec_hero#0"]).toBe("Cedar & Co bakes sourdough fresh, every morning.");
  });

  it("ignores an edit for an id the page never actually offered", async () => {
    const htmlPages = { home: pageHtml([{ id: "tpl_x:sec_hero#0", text: "We are a friendly neighborhood bakery." }]) };
    vi.mocked(llm.chat).mockResolvedValue(
      JSON.stringify({ edits: [{ id: "tpl_x:sec_footer#9", text: "Made-up id that was never offered as input." }] })
    );
    const result = await polishComposedCopy(BRIEF, htmlPages);
    expect(result.overrides).toEqual({});
  });

  it("rejects an edit whose \"text\" is itself raw JSON instead of copy", async () => {
    const original = "Fresh bread daily, baked with wild yeast.";
    const htmlPages = { home: pageHtml([{ id: "tpl_x:sec_hero#0", text: original }]) };
    const rawJsonText = '{"id":"tpl_x:sec_hero#0","text":"Fresh bread daily."}';
    vi.mocked(llm.chat).mockResolvedValue(
      JSON.stringify({ edits: [{ id: "tpl_x:sec_hero#0", text: rawJsonText }] })
    );
    const result = await polishComposedCopy(BRIEF, htmlPages);
    expect(result.overrides).toEqual({});
  });

  it("rejects an implausibly expanded replacement (> 3x original length)", async () => {
    const original = "Fresh bread daily.";
    const htmlPages = { home: pageHtml([{ id: "tpl_x:sec_hero#0", text: original }]) };
    const tooLong = "x".repeat(original.length * 4);
    vi.mocked(llm.chat).mockResolvedValue(JSON.stringify({ edits: [{ id: "tpl_x:sec_hero#0", text: tooLong }] }));
    const result = await polishComposedCopy(BRIEF, htmlPages);
    expect(result.overrides).toEqual({});
  });

  it("skips runs shorter than the minimum length — never sends single-word labels to the LLM", async () => {
    const htmlPages = { home: pageHtml([{ id: "tpl_x:sec_nav#0", text: "FAQ" }]) };
    const result = await polishComposedCopy(BRIEF, htmlPages);
    expect(llm.chat).not.toHaveBeenCalled();
    expect(result.overrides).toEqual({});
  });

  it("throws when no provider is configured and mocks are not allowed (strict quality mode)", async () => {
    (llm as unknown as { isAvailable: boolean }).isAvailable = false;
    process.env.PIPELINE_QUALITY = "1";
    await expect(polishComposedCopy(BRIEF, { home: pageHtml([]) })).rejects.toThrow(/LLM required/);
  });

  it("returns skipped:true, no overrides, when no provider is configured and mocks are allowed", async () => {
    (llm as unknown as { isAvailable: boolean }).isAvailable = false;
    process.env.ALLOW_MOCKS = "1";
    const result = await polishComposedCopy(BRIEF, {
      home: pageHtml([{ id: "tpl_x:sec_hero#0", text: "A perfectly fine sentence of copy." }]),
    });
    expect(result.skipped).toBe(true);
    expect(result.overrides).toEqual({});
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("degrades to unpolished copy for a page whose LLM call fails, outside strict mode, and records the fallback", async () => {
    vi.mocked(llm.chat).mockRejectedValue(new Error("network down"));
    const htmlPages = { home: pageHtml([{ id: "tpl_x:sec_hero#0", text: "A perfectly fine sentence of copy." }]) };
    const result = await polishComposedCopy(BRIEF, htmlPages);
    expect(result.overrides).toEqual({});
    expect(totalFallbacks()).toBe(1);
  });

  it("rethrows in strict quality mode instead of degrading a failed page", async () => {
    process.env.PIPELINE_QUALITY = "1";
    vi.mocked(llm.chat).mockRejectedValue(new Error("network down"));
    const htmlPages = { home: pageHtml([{ id: "tpl_x:sec_hero#0", text: "A perfectly fine sentence of copy." }]) };
    await expect(polishComposedCopy(BRIEF, htmlPages)).rejects.toThrow(/LLM failed for "copy polish \(home\)"/);
  });

  it("still polishes other pages when one page's LLM call fails, outside strict mode", async () => {
    const htmlPages = {
      broken: pageHtml([{ id: "tpl_x:sec_a#0", text: "A perfectly fine sentence of copy." }]),
      home: pageHtml([{ id: "tpl_x:sec_b#0", text: "Another perfectly fine sentence of copy." }]),
    };
    vi.mocked(llm.chat).mockImplementation(async (_system: string, user: string) => {
      if (user.includes("sec_a")) throw new Error("network down");
      return JSON.stringify({ edits: [{ id: "tpl_x:sec_b#0", text: "A much better sentence of copy indeed." }] });
    });
    const result = await polishComposedCopy(BRIEF, htmlPages);
    expect(result.overrides["tpl_x:sec_b#0"]).toBe("A much better sentence of copy indeed.");
    expect(result.overrides["tpl_x:sec_a#0"]).toBeUndefined();
  });
});
