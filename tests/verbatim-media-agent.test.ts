import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: true,
    chat: vi.fn(),
    getSectionModel: vi.fn(() => "test-model"),
  },
}));

import { llm } from "../src/llm/client.js";
import { curateVerbatimPhotoQueries } from "../src/agents/verbatim-media-agent.js";
import { resetFallbackTracker, totalFallbacks } from "../src/util/fallback-tracker.js";
import type { ExpandedBrief } from "../src/types.js";
import type { PhotoSlot } from "../src/templates/types.js";

const BRIEF: ExpandedBrief = {
  businessName: "Cedar & Co",
  tagline: "Sourdough, done right",
  elevatorPitch: "A neighborhood bakery baking sourdough fresh every morning.",
  expandedBrief: "Cedar & Co is a sourdough bakery in Bristol.",
  targetAudience: "Locals",
  services: ["Sourdough loaves", "Pastries"],
  differentiators: ["Wild yeast starter"],
  tone: "Warm",
  primaryCta: "Order online",
};

function photoSlots(count: number): PhotoSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    selector: `.photo-${i}`,
    width: 800,
    height: 600,
    kind: "img" as const,
  }));
}

describe("curateVerbatimPhotoQueries", () => {
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

  it("returns an empty array without calling the LLM when the section has no photo slots", async () => {
    const queries = await curateVerbatimPhotoQueries(BRIEF, "hero", [], "bakery");
    expect(queries).toEqual([]);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("returns one distinct, business-grounded query per photo slot from the LLM, in order", async () => {
    vi.mocked(llm.chat).mockResolvedValue(
      JSON.stringify({ queries: ["sourdough loaf close-up", "bakery storefront morning light"] })
    );
    const queries = await curateVerbatimPhotoQueries(BRIEF, "hero", photoSlots(2), "bakery");
    expect(queries).toEqual(["sourdough loaf close-up", "bakery storefront morning light"]);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it("pads a short LLM response with the deterministic fallback query, index-aligned", async () => {
    vi.mocked(llm.chat).mockResolvedValue(JSON.stringify({ queries: ["sourdough loaf close-up"] }));
    const queries = await curateVerbatimPhotoQueries(BRIEF, "hero", photoSlots(2), "bakery");
    expect(queries[0]).toBe("sourdough loaf close-up");
    expect(queries[1]).toBe("bakery hero");
  });

  it("falls back to the deterministic query when no provider is configured and mocks are allowed", async () => {
    (llm as unknown as { isAvailable: boolean }).isAvailable = false;
    process.env.ALLOW_MOCKS = "1";
    const queries = await curateVerbatimPhotoQueries(BRIEF, "gallery", photoSlots(2), "bakery");
    expect(queries).toEqual(["bakery gallery", "bakery gallery"]);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("throws when no provider is configured and mocks are not allowed (strict quality mode)", async () => {
    (llm as unknown as { isAvailable: boolean }).isAvailable = false;
    process.env.PIPELINE_QUALITY = "1"; // strict mode disallows the NODE_ENV=test mock fallback too
    await expect(curateVerbatimPhotoQueries(BRIEF, "hero", photoSlots(1), "bakery")).rejects.toThrow(
      /LLM required/
    );
  });

  it("degrades to the deterministic fallback and records it when the LLM call fails outside strict mode", async () => {
    vi.mocked(llm.chat).mockRejectedValue(new Error("network down"));
    const queries = await curateVerbatimPhotoQueries(BRIEF, "hero", photoSlots(1), "bakery");
    expect(queries).toEqual(["bakery hero"]);
    expect(totalFallbacks()).toBe(1);
  });

  it("rethrows in strict quality mode instead of degrading to a fallback query", async () => {
    process.env.PIPELINE_QUALITY = "1";
    vi.mocked(llm.chat).mockRejectedValue(new Error("network down"));
    await expect(curateVerbatimPhotoQueries(BRIEF, "hero", photoSlots(1), "bakery")).rejects.toThrow(
      /LLM failed for "verbatim media curation \(hero\)"/
    );
  });
});
