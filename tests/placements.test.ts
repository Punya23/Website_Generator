import { describe, it, expect } from "vitest";
import path from "node:path";
import * as cheerio from "cheerio";
import { extractRealEstateTemplate } from "../src/templates/placements/extract.js";
import { applyPlacements } from "../src/templates/placements/fill.js";
import type { ImagePlacement, PagePlacements, TextPlacement } from "../src/templates/placements/schema.js";

const REAL_ESTATE_DIR = path.resolve(process.cwd(), "real-estate");
const TEMPLATES = ["real-estate-agency", "luxury-real-estate", "commercial-real-estate", "property-management"];

function textPlacement(overrides: Partial<TextPlacement>): TextPlacement {
  return {
    id: "t.1",
    kind: "text",
    page: "test.html",
    selector: "#t1",
    tag: "p",
    role: "sectionBody",
    fillSource: "llm",
    original: "Original placeholder copy that is reasonably long.",
    constraints: { minChars: 5, maxChars: 40, minWords: 1, maxWords: 10, maxLines: 2 },
    ...overrides,
  };
}

function imagePlacement(overrides: Partial<ImagePlacement>): ImagePlacement {
  return {
    id: "i.1",
    kind: "image",
    page: "test.html",
    selector: "#i1",
    domKind: "img",
    role: "propertyPhoto",
    fillSource: "data",
    original: "https://example.com/original.jpg",
    constraints: { aspectRatio: "4:3", minWidthPx: 400, minHeightPx: 300 },
    subject: "a test photo",
    ...overrides,
  };
}

function page(text: TextPlacement[] = [], images: ImagePlacement[] = []): PagePlacements {
  return { page: "test.html", text, images };
}

// ---------------------------------------------------------------------------
// Extraction — every selector in real-estate-map.ts must resolve on every real template.
// ---------------------------------------------------------------------------

describe("extractRealEstateTemplate", () => {
  for (const templateId of TEMPLATES) {
    it(`resolves every placement on ${templateId} with no ambiguous/missing selectors`, async () => {
      const file = await extractRealEstateTemplate(path.join(REAL_ESTATE_DIR, templateId), templateId);
      const textCount = Object.values(file.pages).reduce((n, p) => n + p.text.length, 0);
      const imageCount = Object.values(file.pages).reduce((n, p) => n + p.images.length, 0);
      // A real regression here (a selector starting to match 0 or 2+ elements) throws inside
      // extractRealEstateTemplate itself — reaching this point at all is most of the assertion;
      // the counts guard a selector that still resolves to exactly one element, just the WRONG one.
      expect(textCount).toBeGreaterThan(300);
      expect(imageCount).toBeGreaterThan(30);
    });
  }

  it("carries each template's own copy, not a shared/cached default", async () => {
    const agency = await extractRealEstateTemplate(path.join(REAL_ESTATE_DIR, "real-estate-agency"), "real-estate-agency");
    const luxury = await extractRealEstateTemplate(path.join(REAL_ESTATE_DIR, "luxury-real-estate"), "luxury-real-estate");
    const heroAgency = agency.pages["index.html"]?.text.find((t) => t.id === "home.hero.title");
    const heroLuxury = luxury.pages["index.html"]?.text.find((t) => t.id === "home.hero.title");
    expect(heroAgency?.original).not.toEqual(heroLuxury?.original);
    expect(heroAgency?.original).toContain("home");
    expect(heroLuxury?.original.toLowerCase()).toContain("exceptional");
  });

  it("keeps fabricated-person and factual-claim roles off the LLM path", async () => {
    const file = await extractRealEstateTemplate(path.join(REAL_ESTATE_DIR, "real-estate-agency"), "real-estate-agency");
    const testimonial = file.pages["index.html"]?.text.find((t) => t.role === "testimonialQuote");
    const price = file.pages["listings.html"]?.text.find((t) => t.id === "listings.card.0.price");
    expect(testimonial?.fillSource).toBe("data");
    expect(price?.fillSource).toBe("data");
  });

  it("strips the FAQ accordion's decorative icon glyph out of the reference text", async () => {
    const file = await extractRealEstateTemplate(path.join(REAL_ESTATE_DIR, "real-estate-agency"), "real-estate-agency");
    const question = file.pages["services.html"]?.text.find((t) => t.id === "services.faq.0.question");
    expect(question?.original.endsWith("+")).toBe(false);
    expect(question?.preserveChildren).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fill.ts — constraint enforcement is the safety net "never pass HTML to the LLM" depends on.
// ---------------------------------------------------------------------------

describe("applyPlacements: text", () => {
  it("never touches a fixed placement, even if a caller supplies a value for it", async () => {
    const html = `<p id="t1">Search</p>`;
    const p = page([textPlacement({ fillSource: "fixed", original: "Search" })]);
    const result = await applyPlacements(html, p, { brief: {}, llmValues: { "t.1": "Something else entirely" } });
    expect(result.html).toContain("Search");
    expect(result.html).not.toContain("Something else entirely");
    expect(result.rejectedFixed).toEqual(["t.1"]);
    expect(result.appliedText).toBe(0);
  });

  it("applies an llm value that fits inside its constraints", async () => {
    const html = `<p id="t1">Original placeholder copy that is reasonably long.</p>`;
    const p = page([textPlacement({})]);
    const result = await applyPlacements(html, p, { brief: {}, llmValues: { "t.1": "A concise replacement." } });
    expect(result.html).toContain("A concise replacement.");
    expect(result.appliedText).toBe(1);
    expect(result.clamped).toHaveLength(0);
  });

  it("truncates an over-length value at a word boundary instead of shipping it whole", async () => {
    const html = `<h1 id="t1">Original</h1>`;
    const p = page([textPlacement({ constraints: { minChars: 1, maxChars: 20, minWords: 1, maxWords: 5, maxLines: 1 } })]);
    const tooLong = "This headline is way too long for the box it was designed for";
    const result = await applyPlacements(html, p, { brief: {}, llmValues: { "t.1": tooLong } });
    const $ = cheerio.load(result.html);
    const written = $("#t1").text();
    expect(written.length).toBeLessThanOrEqual(20);
    expect(written.endsWith("…")).toBe(true);
    expect(tooLong.startsWith(written.replace("…", ""))).toBe(true); // cut at a real word boundary
    expect(result.clamped.some((c) => c.id === "t.1")).toBe(true);
  });

  it("rejects a suspiciously short value and keeps the template's original copy", async () => {
    const html = `<p id="t1">Original placeholder copy that is reasonably long.</p>`;
    const p = page([textPlacement({})]); // minChars: 5
    const result = await applyPlacements(html, p, { brief: {}, llmValues: { "t.1": "Hi" } });
    expect(result.html).toContain("Original placeholder copy that is reasonably long.");
    expect(result.appliedText).toBe(0);
    expect(result.clamped.some((c) => c.id === "t.1" && c.reason.includes("rejected"))).toBe(true);
  });

  it("resolves a brief-sourced placement from the brief object, not llmValues", async () => {
    const html = `<span id="t1">demo@example.com</span>`;
    const p = page([textPlacement({ fillSource: "brief", briefField: "email", constraints: { minChars: 1, maxChars: 60, minWords: 1, maxWords: 5, maxLines: 1 } })]);
    const result = await applyPlacements(html, p, { brief: { email: "hello@realbusiness.com" }, llmValues: { "t.1": "ignored@example.com" } });
    expect(result.html).toContain("hello@realbusiness.com");
    expect(result.html).not.toContain("ignored@example.com");
  });

  it("leaves a data placement untouched when no resolver is supplied", async () => {
    const html = `<span id="t1">$2,450,000</span>`;
    const p = page([textPlacement({ fillSource: "data", original: "$2,450,000" })]);
    const result = await applyPlacements(html, p, { brief: {} });
    expect(result.html).toContain("$2,450,000");
    expect(result.appliedText).toBe(0);
  });

  it("composes the footer copyright line from the business name and current year", async () => {
    const html = `<span id="t1">© 2019 Some Template Author. All rights reserved.</span>`;
    const p = page([textPlacement({ fillSource: "brief", briefField: "businessName", compose: "footerCopyright" })]);
    const result = await applyPlacements(html, p, { brief: { businessName: "Real Business LLC" } });
    expect(result.html).toContain(`© ${new Date().getFullYear()} Real Business LLC. All rights reserved.`);
  });

  it("preserves the two legal links when composing the footer license line", async () => {
    const html = `<span id="t1">DRE #01923847 · <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms</a></span>`;
    const p = page([
      textPlacement({ fillSource: "brief", briefField: "licenseNumber", compose: "footerLicense", preserveChildren: true }),
    ]);
    const result = await applyPlacements(html, p, { brief: { licenseNumber: "DRE #99999999" } });
    expect(result.html).toContain("DRE #99999999");
    expect(result.html).toContain('<a href="/privacy">Privacy Policy</a>');
    expect(result.html).toContain('<a href="/terms">Terms</a>');
  });

  it("composes a phone-and-email pair with a line break between them", async () => {
    const html = `<p id="t1">(415) 555-0182<br>hello@demo.com</p>`;
    const p = page([textPlacement({ fillSource: "brief", compose: "phoneAndEmail" })]);
    const result = await applyPlacements(html, p, { brief: { phone: "(212) 555-0100", email: "info@realbusiness.com" } });
    expect(result.html).toContain("(212) 555-0100<br>info@realbusiness.com");
  });
});

describe("applyPlacements: images", () => {
  it("rewrites an <img> src and drops any stale srcset", async () => {
    const html = `<img id="i1" src="https://example.com/old.jpg" srcset="https://example.com/old@2x.jpg 2x">`;
    const p = page([], [imagePlacement({})]);
    const result = await applyPlacements(html, p, {
      brief: {},
      resolveData: async () => "https://cdn.example.com/new.jpg",
    });
    expect(result.html).toContain('src="https://cdn.example.com/new.jpg"');
    expect(result.html).not.toContain("srcset");
    expect(result.appliedImages).toBe(1);
  });

  it("rewrites a CSS background-image url() in place, keeping the rest of the style", async () => {
    const html = `<section id="i1" style="min-height:640px;background-image:url('https://example.com/old.jpg');background-size:cover;"></section>`;
    const p = page([], [imagePlacement({ domKind: "background" })]);
    const result = await applyPlacements(html, p, {
      brief: {},
      resolveData: async () => "https://cdn.example.com/new.jpg",
    });
    expect(result.html).toContain("url(https://cdn.example.com/new.jpg)");
    expect(result.html).toContain("min-height:640px");
    expect(result.html).toContain("background-size:cover");
  });

  it("never touches a fixed image placement", async () => {
    const html = `<img id="i1" src="https://example.com/original.jpg">`;
    const p = page([], [imagePlacement({ fillSource: "fixed" })]);
    const result = await applyPlacements(html, p, { brief: {}, resolveData: async () => "https://cdn.example.com/new.jpg" });
    expect(result.html).toContain("https://example.com/original.jpg");
    expect(result.appliedImages).toBe(0);
  });
});
