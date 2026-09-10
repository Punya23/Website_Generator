/**
 * Asset path namespacing. Every template ships `assets/img/logo.png`, so composing sections from
 * several templates onto one site collides unless each template's files get their own prefix.
 * References are rewritten once at ingest to `/_tpl-assets/<templateId>/<path-from-template-root>`
 * and the copy list is recorded so output writing can materialize exactly the files that are used.
 */
import path from "node:path";
import * as cheerio from "cheerio";
import type { AssetManifestEntry } from "../types.js";

export const ASSET_OUTPUT_ROOT = "_tpl-assets";

// data-original/data-lazy-src/data-lazy/data-echo: the other common lazy-load attribute names real
// scraped templates use instead of (or alongside) `data-src` — without rewriting these too, an
// image parked in one of them keeps pointing at the template's own source tree, 404s once that
// tree isn't shipped, and paints as a broken/empty image on the generated site.
const HTML_URL_ATTRS = [
  "src",
  "poster",
  "data-src",
  "data-bg",
  "data-background",
  "data-original",
  "data-lazy-src",
  "data-lazy",
  "data-echo",
];

export class AssetCollector {
  private readonly entries = new Map<string, AssetManifestEntry>();

  constructor(private readonly templateId: string) {}

  /** @param ref  raw reference as written in the source file
   *  @param fromDirRel  directory of the referencing file, relative to the template root */
  resolve(ref: string, fromDirRel: string): string | null {
    const clean = ref.trim().replace(/^["']|["']$/g, "");
    if (!clean) return null;
    if (/^(https?:)?\/\//i.test(clean)) return null;
    if (/^(data|mailto|tel|javascript|#):/i.test(clean) || clean.startsWith("#")) return null;

    const [rawPath] = clean.split(/[?#]/);
    if (!rawPath) return null;
    const normalized = rawPath.replace(/^\.\//, "");
    const cachedRel = path
      .normalize(path.join(fromDirRel, normalized))
      .split(path.sep)
      .join("/");
    // A reference that climbs out of the template root is dropped rather than followed.
    if (cachedRel.startsWith("..")) return null;

    const outputRelPath = `${ASSET_OUTPUT_ROOT}/${this.templateId}/${cachedRel}`;
    this.entries.set(cachedRel, { cachedRelPath: cachedRel, outputRelPath });
    // Relative, not root-relative: generated sites are flat (index.html, about.html, …) and this
    // keeps them working from file://, a subdirectory, or a bucket prefix.
    return outputRelPath;
  }

  manifest(): AssetManifestEntry[] {
    return [...this.entries.values()].sort((a, b) => a.cachedRelPath.localeCompare(b.cachedRelPath));
  }
}

/** Rewrite every local asset reference inside one section's markup. */
export function rewriteHtmlAssets(html: string, collector: AssetCollector, fromDirRel: string): string {
  const $ = cheerio.load(html, null, false);

  for (const attr of HTML_URL_ATTRS) {
    $(`[${attr}]`).each((_, node) => {
      const value = $(node).attr(attr);
      if (!value) return;
      const next = collector.resolve(value, fromDirRel);
      if (next) $(node).attr(attr, next);
    });
  }

  // <img srcset="a.jpg 1x, b.jpg 2x">
  $("[srcset]").each((_, node) => {
    const value = $(node).attr("srcset");
    if (!value) return;
    const rewritten = value
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        const [url, ...rest] = trimmed.split(/\s+/);
        if (!url) return trimmed;
        const next = collector.resolve(url, fromDirRel);
        return [next ?? url, ...rest].join(" ");
      })
      .join(", ");
    $(node).attr("srcset", rewritten);
  });

  // Anchors pointing at other pages of the same template become in-site links; assets stay assets.
  $("[style]").each((_, node) => {
    const value = $(node).attr("style");
    if (!value || !/url\(/i.test(value)) return;
    $(node).attr("style", rewriteCssUrls(value, collector, fromDirRel));
  });

  return $.html();
}

/** Rewrite `url(...)` references inside a stylesheet or inline style attribute. */
export function rewriteCssUrls(css: string, collector: AssetCollector, fromDirRel: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote: string, ref: string) => {
    const next = collector.resolve(ref, fromDirRel);
    return next ? `url(${quote}${next}${quote})` : match;
  });
}
