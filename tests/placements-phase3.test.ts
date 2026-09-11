/**
 * Phase 3 (docs/PLACEMENTS_ORCHESTRATION_PLAN.md): media hardening + resolveData fixtures.
 * Three independent pieces, tested against real placements data where it matters:
 *  - `demoListingsResolver` — a `resolveData` backed by `fixtures/demo-listings.json`.
 *  - `checkBrandLeak` — scans generated HTML for another template's fictional brand name.
 *  - `resolveImageQueries` (now exported from `fill-real-estate-template.ts`) — proven reusable on
 *    corpus-shaped ids, not just real-estate ones, satisfying this phase's own "Done when: one mocked
 *    integration test covers query→URL" bar.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { demoListingsResolver, _resetDemoListingsCache } from "../src/templates/placements/demo-data.js";
import { checkBrandLeak, KNOWN_DEMO_BRAND_NAMES } from "../src/templates/placements/brand-leak.js";
import { resolveImageQueries, resolveLocale } from "../src/templates/placements/fill-real-estate-template.js";
import { applyPlacements } from "../src/templates/placements/fill.js";
import { PlacementsFileSchema, type PagePlacements, type TextPlacement } from "../src/templates/placements/schema.js";
import type { FlatPromptField } from "../src/templates/placements/llm-view.js";

const US_LOCALE = resolveLocale("A boutique brokerage in Alameda, CA.");
const INDIA_LOCALE = resolveLocale("A brokerage in Wakad, Pune, Maharashtra.");

async function loadRealEstatePlacements(templateId: string) {
  const raw = JSON.parse(
    await fs.readFile(path.resolve("real-estate", templateId, "placements.json"), "utf8")
  );
  return PlacementsFileSchema.parse(raw);
}

function findText(pages: Record<string, PagePlacements>, page: string, id: string): TextPlacement {
  const found = pages[page]?.text.find((t) => t.id === id);
  if (!found) throw new Error(`fixture drift: ${page}#${id} no longer exists — update this test`);
  return found;
}

describe("demoListingsResolver", () => {
  it("answers price/badge/location/title/beds/baths/sqft for a property-card grid placement, using the id's own index", async () => {
    _resetDemoListingsCache();
    const file = await loadRealEstatePlacements("real-estate-agency");
    const resolve = demoListingsResolver(US_LOCALE);

    const price0 = findText(file.pages, "index.html", "home.featured.0.price");
    const price1 = findText(file.pages, "index.html", "home.featured.1.price");
    const beds0 = findText(file.pages, "index.html", "home.featured.0.beds");

    const value0 = await resolve(price0);
    const value1 = await resolve(price1);
    const bedsValue = await resolve(beds0);

    expect(value0).toMatch(/^\$/); // US locale -> dollar-formatted price
    expect(value1).toMatch(/^\$/);
    expect(value0).not.toBe(value1); // different card index -> different listing
    expect(bedsValue).toMatch(/Beds$/); // same shape as the template's own original ("4 Beds")
  });

  it("switches to the India fixture set when the brief resolves to an India locale", async () => {
    _resetDemoListingsCache();
    const file = await loadRealEstatePlacements("real-estate-agency");
    const resolve = demoListingsResolver(INDIA_LOCALE);

    const price0 = findText(file.pages, "index.html", "home.featured.0.price");
    const location0 = findText(file.pages, "index.html", "home.featured.0.location");

    expect(await resolve(price0)).toMatch(/₹/);
    expect(await resolve(location0)).toMatch(/Pune/);
  });

  it("cycles listings via modulo so a grid larger than the fixture set doesn't crash or repeat every card identically", async () => {
    _resetDemoListingsCache();
    const file = await loadRealEstatePlacements("real-estate-agency");
    const resolve = demoListingsResolver(US_LOCALE);
    const listingsPage = file.pages["listings.html"]!;
    const priceIds = listingsPage.text.filter((t) => t.role === "propertyPrice");
    expect(priceIds.length).toBeGreaterThan(6); // more cards than fixture entries (6) on this page

    const values = await Promise.all(priceIds.map((p) => resolve(p)));
    expect(values.every((v) => typeof v === "string" && v.length > 0)).toBe(true);
    // The 7th card (index 6) wraps back to fixture entry 0 — same price as the 1st card.
    expect(values[6]).toBe(values[0]);
  });

  it("answers property-detail's single-listing roles from the first fixture entry", async () => {
    _resetDemoListingsCache();
    const file = await loadRealEstatePlacements("real-estate-agency");
    const resolve = demoListingsResolver(US_LOCALE);
    const detailPrice = findText(file.pages, "property-detail.html", "property.price");
    const detailBadge = findText(file.pages, "property-detail.html", "property.badge");
    expect(await resolve(detailPrice)).toMatch(/^\$/);
    expect(await resolve(detailBadge)).toBeTruthy();
  });

  it("returns null for any role/placement it doesn't own, leaving illustrativeFill as the fallback", async () => {
    _resetDemoListingsCache();
    const file = await loadRealEstatePlacements("real-estate-agency");
    const resolve = demoListingsResolver(US_LOCALE);
    const agentName = findText(file.pages, "agent-detail.html", "agentDetail.name");
    expect(agentName.fillSource).toBe("data"); // confirms this IS a data placement resolveData sees
    expect(await resolve(agentName)).toBeNull();
  });

  it("end-to-end: applyPlacements writes real fixture values into the real template HTML", async () => {
    _resetDemoListingsCache();
    const file = await loadRealEstatePlacements("real-estate-agency");
    const pageSet = file.pages["index.html"]!;
    const chrome = file.pages.chrome!;
    const merged: PagePlacements = {
      page: "index.html",
      text: [...chrome.text, ...pageSet.text],
      images: [...chrome.images, ...pageSet.images],
    };
    const html = await fs.readFile(path.resolve("real-estate/real-estate-agency/index.html"), "utf8");
    const result = await applyPlacements(html, merged, {
      brief: { businessName: "Bay Breeze Realty" },
      resolveData: demoListingsResolver(US_LOCALE),
      placeholderPhone: "+1 (000) 000-0000",
    });
    const $ = cheerio.load(result.html);
    const firstPrice = $(".property-card").eq(0).find(".property-card__price").text();
    expect(firstPrice).toBe("$685,000"); // fixtures/demo-listings.json's us[0].price
    expect(result.clamped.length).toBe(0); // fixture values fit every field's own constraints
  });
});

describe("checkBrandLeak", () => {
  it("flags every other template's known fictional brand appearing in output", () => {
    const html = `<footer>Powered by Prestige Realty. All rights reserved.</footer>`;
    const leaks = checkBrandLeak(html, "Bay Breeze Realty");
    expect(leaks.some((l) => l.brand === "Prestige Realty")).toBe(true);
  });

  it("counts repeated leaks", () => {
    const html = `<p>Prestige Realty helped us. Prestige Realty is the best.</p>`;
    const leaks = checkBrandLeak(html, "Bay Breeze Realty");
    expect(leaks.find((l) => l.brand === "Prestige Realty")?.count).toBe(2);
  });

  it("does not flag a real business that happens to share a demo brand's name", () => {
    const html = `<footer>© Prestige Realty</footer>`;
    const leaks = checkBrandLeak(html, "Prestige Realty");
    expect(leaks).toEqual([]);
  });

  it("is case-sensitive, so ordinary words like 'prestige' never false-positive", () => {
    const html = `<p>Our prestige comes from decades of trust.</p>`;
    expect(checkBrandLeak(html, "Bay Breeze Realty")).toEqual([]);
  });

  it("returns empty for clean output naming only the real business", () => {
    const html = `<footer>© Bay Breeze Realty. All rights reserved.</footer>`;
    expect(checkBrandLeak(html, "Bay Breeze Realty")).toEqual([]);
  });

  it("covers all four templates' brand names", () => {
    for (const name of ["Prestige Realty", "Aurelia Estates", "Cornerstone Commercial Realty", "Harborview Property Management"]) {
      expect(KNOWN_DEMO_BRAND_NAMES).toContain(name);
    }
  });

  it("a template's own unmodified HTML never flags itself as a leak against its own business name", async () => {
    // Doesn't exercise a live LLM call (that's tests/placements.test.ts / manual generate-real-site.ts
    // runs) — just proves the check is correct against real shipped HTML, not synthetic strings.
    const html = await fs.readFile(path.resolve("real-estate/real-estate-agency/index.html"), "utf8");
    const leaks = checkBrandLeak(html, "Prestige Realty"); // this template's OWN business, not a leak
    expect(leaks).toEqual([]);
  });
});

describe("resolveImageQueries (exported for Phase 2B's corpus fill helper to reuse)", () => {
  it("resolves a query string to a real URL for a corpus-shaped id — nothing here is real-estate-specific", async () => {
    const copyFields: Record<string, FlatPromptField> = {
      "tpl_abc123:sec_004_hero.photo.0": {
        type: "image",
        current: "",
        aspectRatio: "16:9",
        minWidthPx: 1200,
        minHeightPx: 675,
        subject: "a wide shot of a modern office lobby",
      },
      "tpl_abc123:sec_004_hero.tagline": { type: "text", current: "", minChars: 4, maxChars: 60 },
    };
    const copyValues: Record<string, string> = {
      "tpl_abc123:sec_004_hero.photo.0": "modern office lobby wide shot",
      "tpl_abc123:sec_004_hero.tagline": "Built for the way you work",
    };

    await resolveImageQueries(copyValues, copyFields, { businessName: "Acme Coworking" });

    expect(copyValues["tpl_abc123:sec_004_hero.tagline"]).toBe("Built for the way you work"); // untouched
    expect(copyValues["tpl_abc123:sec_004_hero.photo.0"]).toMatch(/^https?:\/\//); // query -> real URL
  });

  it("is stable across calls for the same business+id seed (doesn't reshuffle on every fill)", async () => {
    const field: Record<string, FlatPromptField> = {
      "tpl_x:sec_1.photo.0": { type: "image", current: "", aspectRatio: "1:1", minWidthPx: 400, minHeightPx: 400 },
    };
    const first: Record<string, string> = { "tpl_x:sec_1.photo.0": "a cozy coffee shop interior" };
    const second: Record<string, string> = { "tpl_x:sec_1.photo.0": "a cozy coffee shop interior" };
    await resolveImageQueries(first, field, { businessName: "Same Co" });
    await resolveImageQueries(second, field, { businessName: "Same Co" });
    expect(first["tpl_x:sec_1.photo.0"]).toBe(second["tpl_x:sec_1.photo.0"]);
  });
});
