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
