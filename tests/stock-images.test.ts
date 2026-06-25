import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { enrichContentWithImages, enrichSectionImages } from "../src/media/enrich-content.js";
import { MediaRegistry } from "../src/media/media-registry.js";
import { stockImageUrlSync } from "../src/media/stock-images.js";
import { activeImageProviders } from "../src/media/image-providers.js";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";

describe("Stock images", () => {
  it("returns https URLs for any query", () => {
    const url = stockImageUrlSync("law firm office", "test-seed");
    expect(url).toMatch(/^https:\/\//);
  });

  it("enriches image blocks with src", async () => {
    const blocks = await enrichContentWithImages(
      [{ id: "img1", type: "image", alt: "Office", imageQuery: "modern office" }],
      "home",
      "Acme Co",
      "Professional services firm",
      GENERIC_THEME
    );
    expect(blocks[0]?.src).toMatch(/^https:\/\//);
  });

  it("adds hero image to hero section headline", async () => {
    const registry = new MediaRegistry();
    const blocks = await enrichSectionImages(
      [{ id: "h", type: "headline", text: "Welcome", subtext: "We deliver" }],
      "home",
      "Acme Co",
      "Business services",
      GENERIC_THEME,
      registry,
      "home_hero"
    );
    const headline = blocks.find((b) => b.type === "headline");
    expect(headline?.heroImage).toMatch(/^https:\/\//);
  });

  it("enriches gallery blocks in a section without injecting extras", async () => {
    const registry = new MediaRegistry();
    const blocks = await enrichSectionImages(
      [{ id: "g1", type: "gallery", caption: "Work", imageQuery: "salon interior" }],
      "services",
      "Acme Co",
      "Business",
      GENERIC_THEME,
      registry,
      "services_main"
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("gallery");
    expect(blocks[0]?.src).toMatch(/^https:\/\//);
    expect(registry.usedUrls.size).toBe(1);
  });

  describe("activeImageProviders", () => {
    const env = process.env;

    beforeEach(() => {
      delete process.env.PEXELS_API_KEY;
      delete process.env.PIXABAY_API_KEY;
    });

    afterEach(() => {
      process.env = env;
    });

    it("prioritizes pexels when key is set", () => {
      process.env.PEXELS_API_KEY = "test";
      expect(activeImageProviders()).toEqual(["pexels", "openverse", "picsum"]);
    });

    it("omits pixabay when no key", () => {
      expect(activeImageProviders()).toEqual(["openverse", "picsum"]);
    });
  });
});
