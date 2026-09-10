import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { getSkin } from "../src/skins/catalog.js";
import { renderSkinPreview, sampleBriefFor } from "../src/admin/preview-skin.js";

const OUT = path.resolve("output", "_test-admin-preview");

describe("admin skin preview", () => {
  afterEach(async () => {
    await fs.rm(OUT, { recursive: true, force: true });
  });

  it("mock-fills a real catalog skin and builds it into a real static export", async () => {
    const skin = getSkin("hospitality-restaurant");
    expect(skin).toBeDefined();

    const result = await renderSkinPreview(skin!, OUT, { basePath: "/admin-preview" });

    expect(result.buildError).toBeUndefined();
    expect(result.buildSucceeded).toBe(true);
    expect(result.businessName).toBe("Marigold & Co.");

    // Every page in the skin was assembled with its own templates, in order.
    expect(result.sectionsByPage.home).toEqual([
      "hero_editorial",
      "menu_board",
      "gallery_masonry",
      "testimonial_carousel",
      "cta_band",
    ]);
    expect(result.sectionsByPage.contact).toEqual(["contact_split", "quote_calculator"]);

    const index = await fs.readFile(path.join(result.outPath!, "index.html"), "utf8");
    expect(index).toContain("Marigold");
    // basePath must be baked into the static export's asset links.
    expect(index).toContain("/admin-preview/_next/");
  }, 120_000);

  it("picks a distinct, deterministic sample brief per visual family", () => {
    const luxury = getSkin("local-service-salon");
    const clinical = getSkin("local-service-clinic");
    expect(luxury?.visualFamily).toBe("luxury-dark");
    expect(clinical?.visualFamily).toBe("clinical-light");

    expect(sampleBriefFor(luxury!).businessName).toBe("Lumière Studio");
    expect(sampleBriefFor(clinical!).businessName).toBe("Northgate Health Partners");
    // Deterministic — approving/reviewing the same recipe twice previews the same sample business.
    expect(sampleBriefFor(luxury!).businessName).toBe(sampleBriefFor(luxury!).businessName);
  });
});
