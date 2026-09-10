import { describe, expect, it } from "vitest";
import {
  depthRelativePrefix,
  rewritePathsForStorage,
} from "../src/hosting/rewrite-static-paths.js";

describe("rewritePathsForStorage", () => {
  it("rewrites assets and nav on index.html", () => {
    const html =
      '<link href="/preview/_next/static/css/app.css"/><a href="/preview/about/">About</a><a href="/preview/">Home</a>';
    const out = rewritePathsForStorage(html, "/preview", "index.html");
    expect(out).toContain('href="_next/static/css/app.css"');
    expect(out).toContain('href="about/"');
    expect(out).toContain('href="./"');
  });

  it("uses parent-relative paths from nested pages", () => {
    const html = '<link href="/preview/_next/static/css/app.css"/><a href="/preview/contact/">Contact</a>';
    const out = rewritePathsForStorage(html, "/preview", "about/index.html");
    expect(out).toContain('href="../_next/static/css/app.css"');
    expect(out).toContain('href="../contact/"');
  });

  it("rewrites to absolute edge function URLs when assetBase set", () => {
    const base = "https://abc.supabase.co/functions/v1/serve-site/moonrise-bakery/";
    const html =
      '<link href="/preview/_next/static/css/app.css"/><a href="/preview/about/">About</a>';
    const out = rewritePathsForStorage(html, "/preview", "index.html", { assetBase: base });
    expect(out).toContain(
      'href="https://abc.supabase.co/functions/v1/serve-site/moonrise-bakery/_next/static/css/app.css"'
    );
    expect(out).toContain(
      'href="https://abc.supabase.co/functions/v1/serve-site/moonrise-bakery/about/"'
    );
  });

  it("rewrites unprefixed inner-page CTA hrefs (not just /contact)", () => {
    // Defense-in-depth: section CTAs now render through next/link and are basePath-prefixed
    // at build time, so this path shouldn't be hit in practice — but if some href ever slips
    // through unprefixed, /about and /services must be caught the same way /contact is.
    const html =
      '<a href="/about">Learn more</a><a href="/services">Our work</a><a href="/contact">Book now</a>';
    const out = rewritePathsForStorage(html, "/preview", "index.html");
    expect(out).toContain('href="about/"');
    expect(out).toContain('href="services/"');
    expect(out).toContain('href="contact/"');
  });

  it("depthRelativePrefix counts directories", () => {
    expect(depthRelativePrefix("index.html")).toBe("");
    expect(depthRelativePrefix("about/index.html")).toBe("../");
  });
});

describe("storageContentType", () => {
  it("uses plain text/html for Supabase", async () => {
    const { storageContentType } = await import("../src/hosting/storage-publisher.js");
    expect(storageContentType("index.html")).toBe("text/html");
    expect(storageContentType("app.css")).toBe("text/css");
  });
});
