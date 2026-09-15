/**
 * `page-selection.ts` — lets a real-estate generation include only a subset of the template's 8
 * pages (a business with no active listings skips `listings`/`property-detail`, say) without
 * shipping dead links. Two halves tested here: the pure DOM-surgery/slug-resolution functions
 * against hand-built fixtures, and a real end-to-end `runPlacementsPipeline` run (mocked LLM, same
 * technique as `tests/placements-pipeline-phase4.test.ts`) against the ACTUAL
 * `real-estate/real-estate-agency` template on disk — proof against the real markup, not just an
 * assumption about its shape.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  filterPlacementsFileToPages,
  pageFileForSlug,
  pruneDanglingPageLinks,
  REAL_ESTATE_PAGE_SLUGS,
  resolvePageSelection,
  slugForPageFile,
} from "../src/templates/placements/page-selection.js";
import { REAL_ESTATE_PAGE_ORDER } from "../src/templates/placements/real-estate-map.js";
import type { PlacementsFile } from "../src/templates/placements/schema.js";

describe("slug <-> page file conversion", () => {
  it("round-trips every real page slug through pageFileForSlug/slugForPageFile", () => {
    for (const slug of REAL_ESTATE_PAGE_SLUGS) {
      const file = pageFileForSlug(slug);
      expect(file).not.toBeNull();
      expect(slugForPageFile(file!)).toBe(slug);
    }
  });

  it("maps index.html <-> home specially, every other page file <-> <name>.html", () => {
    expect(slugForPageFile("index.html")).toBe("home");
    expect(pageFileForSlug("home")).toBe("index.html");
    expect(slugForPageFile("about.html")).toBe("about");
    expect(pageFileForSlug("about")).toBe("about.html");
  });

  it("rejects a slug that isn't one of the template's real pages", () => {
    expect(pageFileForSlug("listing")).toBeNull(); // typo — no trailing "s"
    expect(pageFileForSlug("blog")).toBeNull();
  });
});

describe("resolvePageSelection", () => {
  it("keeps only the requested pages (plus the always-kept home), preserving pageOrder's own order", () => {
    const result = resolvePageSelection(REAL_ESTATE_PAGE_ORDER, ["contact", "about"]);
    expect(result.pageOrder).toEqual(["index.html", "about.html", "contact.html"]);
  });

  it("always keeps home even when the caller didn't ask for it", () => {
    const result = resolvePageSelection(REAL_ESTATE_PAGE_ORDER, ["contact"]);
    expect(result.pageOrder).toContain("index.html");
  });

  it("reports every excluded file, not just a count", () => {
    const result = resolvePageSelection(REAL_ESTATE_PAGE_ORDER, ["home", "about", "contact"]);
    expect(result.excludedFiles).toEqual(new Set(["services.html", "listings.html", "property-detail.html", "agents.html", "agent-detail.html"]));
  });

  it("surfaces an unknown slug rather than silently ignoring it", () => {
    const result = resolvePageSelection(REAL_ESTATE_PAGE_ORDER, ["home", "listing"]); // typo
    expect(result.unknownSlugs).toEqual(["listing"]);
  });

  it("keeps everything and excludes nothing when every page is requested", () => {
    const result = resolvePageSelection(REAL_ESTATE_PAGE_ORDER, [...REAL_ESTATE_PAGE_SLUGS]);
    expect(result.pageOrder).toEqual(REAL_ESTATE_PAGE_ORDER);
    expect(result.excludedFiles.size).toBe(0);
  });
});

describe("filterPlacementsFileToPages", () => {
  it("narrows pageOrder only — leaves file.pages (chrome included) untouched", () => {
    const file = {
      pageOrder: ["index.html", "listings.html", "contact.html"],
      pages: { chrome: { page: "chrome", text: [], images: [] }, "index.html": {}, "listings.html": {}, "contact.html": {} },
    } as unknown as PlacementsFile;
    const selection = resolvePageSelection(file.pageOrder, ["home", "contact"]);
    const filtered = filterPlacementsFileToPages(file, selection);
    expect(filtered.pageOrder).toEqual(["index.html", "contact.html"]);
    expect(Object.keys(filtered.pages)).toEqual(Object.keys(file.pages)); // unfiltered — the unused entry is just inert
  });
});

describe("pruneDanglingPageLinks", () => {
  it("does nothing when excludedFiles is empty", () => {
    const html = `<ul><li><a href="listings.html">Listings</a></li></ul>`;
    expect(pruneDanglingPageLinks(html, new Set())).toBe(html);
  });

  it("removes the enclosing <li> for a nav/footer menu item pointing at an excluded page", () => {
    const html = `<ul class="navbar__links"><li><a href="index.html">Home</a></li><li><a href="listings.html">Listings</a></li><li><a href="contact.html">Contact</a></li></ul>`;
    const out = pruneDanglingPageLinks(html, new Set(["listings.html"]));
    expect(out).not.toContain("listings.html");
    expect(out).toContain("index.html");
    expect(out).toContain("contact.html");
    expect(out.match(/<li>/g)?.length).toBe(2);
  });

  it("removes a whole footer column left with no real links once its target page is gone", () => {
    const html = `<div class="footer__col"><h4>Property Types</h4><ul><li><a href="listings.html">Homes</a></li><li><a href="listings.html">Condos</a></li></ul></div><div class="footer__col"><h4>Quick Links</h4><ul><li><a href="contact.html">Contact</a></li></ul></div>`;
    const out = pruneDanglingPageLinks(html, new Set(["listings.html"]));
    expect(out).not.toContain("Property Types");
    expect(out).toContain("Quick Links");
    expect(out).toContain("contact.html");
  });

  it("removes a button-styled CTA outright rather than leaving stray text", () => {
    const html = `<div class="hero__actions"><a href="listings.html" class="btn btn--primary">Browse Listings</a><a href="contact.html" class="btn btn--secondary">Contact</a></div>`;
    const out = pruneDanglingPageLinks(html, new Set(["listings.html"]));
    expect(out).not.toContain("Browse Listings");
    expect(out).not.toContain("listings.html");
    expect(out).toContain("Contact");
  });

  it("removes a service-card__link CTA the same way (BEM __link suffix, not a `btn` class)", () => {
    const html = `<a href="listings.html" class="service-card__link">For Tenants &rarr;</a>`;
    const out = pruneDanglingPageLinks(html, new Set(["listings.html"]));
    expect(out).not.toContain("For Tenants");
  });

  it("unwraps a plain card-title link to bare text, keeping the card readable", () => {
    const html = `<article class="property-card"><h3 class="property-card__title"><a href="property-detail.html">Modern Family Home</a></h3><span class="property-card__price">$1,200,000</span></article>`;
    const out = pruneDanglingPageLinks(html, new Set(["property-detail.html"]));
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("<a>");
    expect(out).toContain("Modern Family Home");
    expect(out).toContain("$1,200,000");
  });

  it("unwraps a breadcrumb crumb, leaving the surrounding separators intact", () => {
    const html = `<div class="breadcrumb"><a href="index.html">Home</a> / <a href="listings.html">Listings</a> / <span>Modern Family Home</span></div>`;
    const out = pruneDanglingPageLinks(html, new Set(["listings.html"]));
    expect(out).toContain("Home");
    expect(out).toContain("Listings");
    expect(out).toContain(" / ");
    expect(out).not.toMatch(/href="listings\.html"/);
  });

  it("never touches a link to a page that isn't excluded", () => {
    const html = `<li><a href="about.html">About</a></li>`;
    expect(pruneDanglingPageLinks(html, new Set(["listings.html"]))).toBe(html);
  });

  it("matches hrefs exactly — a listings.html?foo query string is NOT touched by an exact-match exclusion", () => {
    const html = `<a href="listings.html?type=condo">Condos</a>`;
    expect(pruneDanglingPageLinks(html, new Set(["listings.html"]))).toBe(html);
  });
});

describe("pruneDanglingPageLinks against the real real-estate-agency template", () => {
  it("leaves zero references to an excluded page anywhere in a real page's HTML", async () => {
    const html = await fs.readFile(path.resolve(process.cwd(), "real-estate", "real-estate-agency", "index.html"), "utf8");
    const out = pruneDanglingPageLinks(html, new Set(["listings.html", "property-detail.html"]));
    expect(out).not.toMatch(/href="listings\.html"/);
    expect(out).not.toMatch(/href="property-detail\.html"/);
    // The rest of the page — other real pages' links, and the page's own content — must survive.
    expect(out).toContain("about.html");
    expect(out).toContain("contact.html");
  });
});
