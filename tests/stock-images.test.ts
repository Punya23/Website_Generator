import { describe, it, expect } from "vitest";
import { enrichContentWithImages } from "../src/media/enrich-content.js";
import { stockImageUrl } from "../src/media/stock-images.js";
import { PRESETS } from "../src/agents/theme-agent.js";

describe("Stock images", () => {
  it("returns unsplash URLs for salon queries", () => {
    const url = stockImageUrl("hair salon balayage", "test-seed", "salon");
    expect(url).toContain("images.unsplash.com");
    expect(url).toContain("w=1200");
  });

  it("enriches image blocks with src", () => {
    const blocks = enrichContentWithImages(
      [{ id: "img1", type: "image", alt: "Salon", imageQuery: "hair salon" }],
      "home",
      "Glow Salon",
      "Luxury hair salon Austin",
      PRESETS.salon
    );
    expect(blocks[0]?.src).toContain("images.unsplash.com");
  });

  it("adds hero image to home headline", () => {
    const blocks = enrichContentWithImages(
      [{ id: "h", type: "headline", text: "Welcome", subtext: "Best cuts" }],
      "home",
      "Glow Salon",
      "Luxury hair salon",
      PRESETS.salon
    );
    const headline = blocks.find((b) => b.type === "headline");
    expect(headline?.heroImage).toContain("images.unsplash.com");
  });

  it("adds gallery to services page", () => {
    const blocks = enrichContentWithImages(
      [{ id: "f1", type: "feature", title: "Cuts", description: "Great cuts" }],
      "services",
      "Glow Salon",
      "Hair salon",
      PRESETS.salon
    );
    expect(blocks.some((b) => b.type === "gallery")).toBe(true);
  });
});
