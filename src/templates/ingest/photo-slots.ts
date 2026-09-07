/**
 * Content-photo detection: which images in a section are real photography (hero banners,
 * gallery/portfolio shots, team photos) versus decorative vendor art (shapes, icons, background
 * textures) that must stay exactly as the template shipped it.
 *
 * Two independent signals, both required: real pixel dimensions (read from the actual file, not
 * guessed) above a floor that decorative art rarely reaches, and a path that doesn't name itself
 * as decorative. Neither signal alone is reliable — a decorative blob graphic can be large
 * (confirmed in this repo's own bundle: a 1196x1196 "shapes/r-1.png"), and a real photo can be
 * served small — but the combination catches the common cases without a model in the loop.
 *
 * Two markup shapes carry photography: `<img src>`, and a `style="background-image:url(...)"`
 * inline style on an arbitrary element — full-bleed hero/feature photos are very often the latter
 * (confirmed live: 35 of 84 sections in this repo's Arup sample use inline background-image).
 */
import path from "node:path";
import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";
import { imageSizeFromFile } from "image-size/fromFile";
import { templateProbeRemoteImages } from "../config.js";
import type { PhotoSlot } from "../types.js";

const MIN_PHOTO_DIMENSION = 200;

/** Real scraped templates very often ship lazy-loaded `<img>`s: `src` holds a 1x1 placeholder gif
 *  or a `data:` URI, and the real image lives in one of these attributes until a lazy-load script
 *  (never shipped into this pipeline's static output) swaps it in on scroll. Left alone, `src`
 *  stays a placeholder forever on the generated site — an "empty image" that was never actually
 *  missing, just parked in the wrong attribute. Checked in this order; first non-blank wins. */
export const LAZY_SRC_ATTRS = ["data-src", "data-original", "data-lazy-src", "data-lazy", "data-echo"] as const;

function isBlankOrPlaceholderSrc(src: string): boolean {
  if (!src.trim()) return true;
  if (src.startsWith("data:")) return true;
  return false;
}

/** The `src` this `<img>` will actually paint once lazy-loading (which never runs here) is
 *  accounted for: a real `src` if present, otherwise the first lazy-load attribute that carries
 *  one. Exported so `copy-slots.ts` can strip the same attributes it read here once it writes the
 *  resolved photo's real `src`, so nothing re-clobbers it. */
export function effectiveImgSrc($: cheerio.CheerioAPI, node: DomElement): string {
  const el = $(node);
  const src = el.attr("src") ?? "";
  if (!isBlankOrPlaceholderSrc(src)) return src;
  for (const attr of LAZY_SRC_ATTRS) {
    const value = el.attr(attr);
    if (value && value.trim()) return value.trim();
  }
  return src;
}

const DECORATIVE_PATH_RE =
  /\b(shapes?|icons?|patterns?|badges?|arrows?|blobs?|dots?|lines?|bg|backgrounds?|overlays?|textures?|deco(rations?)?|dividers?|separators?|logos?|favicons?|sprites?|noise|grains?|sh)\b/i;

const INLINE_BG_URL_RE = /background-image\s*:\s*url\(\s*(['"]?)([^'")]+)\1\s*\)/i;

export interface DetectPhotoSlotsOptions {
  /** Absolute directory the section's rewritten asset paths resolve against — the template's
   *  extracted root (same base `asset-manifest.ts` computed `cachedRelPath` relative to). */
  rootDir: string;
  templateId: string;
  /** Selectors already claimed by text/logo slot detection — an image logo must not also become
   *  a "content photo" candidate. */
  claimedSelectors: Set<string>;
}

function assetOutputPrefix(templateId: string): string {
  return `_tpl-assets/${templateId}/`;
}

function firstMatchSelector($: cheerio.CheerioAPI, node: DomElement, root: cheerio.Cheerio<never>): string | null {
  const id = $(node).attr("id");
  if (id) return `#${id.replace(/([^\w-])/g, "\\$1")}`;
  const parts: string[] = [];
  let current: DomElement | null = node;
  for (let depth = 0; current && depth < 4; depth++) {
    const tag = (current as { tagName?: string }).tagName?.toLowerCase() ?? "*";
    const parent: cheerio.Cheerio<DomElement> = $(current).parent();
    const position = parent.children(tag).toArray().indexOf(current);
    parts.unshift(position >= 0 ? `${tag}:nth-of-type(${position + 1})` : tag);
    if (parent.length === 0 || parent.is(root as unknown as string)) break;
    current = parent.get(0) ?? null;
  }
  return parts.join(" > ") || null;
}

/** Cap on bytes fetched to measure an externally-hotlinked image — enough for any real photo's
 *  header without risking a slow ingest run on a template that hotlinks something enormous. */
const REMOTE_PROBE_MAX_BYTES = 8 * 1024 * 1024;
const REMOTE_PROBE_TIMEOUT_MS = 8_000;

/** Real pixel dimensions for an image this template hotlinks from a third-party URL instead of
 *  shipping in its own zip (confirmed live: `http://placehold.it`-style placeholder services,
 *  ~4.6% of this repo's ready-ingested corpus). `applyPhotoSlots` (`copy-slots.ts`) replaces a
 *  photo slot's `src`/`background-image` outright regardless of what the original value was, so
 *  the ORIGINAL bytes never need to be localized (`asset-manifest.ts` stays untouched) — the only
 *  thing missing without this is real dimensions to run the same size-floor / decorative-path gate
 *  every local image already goes through. Never throws: a fetch that fails, times out, or is not
 *  actually an image just means this reference is treated as un-classifiable, same as before. */
async function measureRemote(src: string): Promise<{ width: number; height: number } | null> {
  if (!templateProbeRemoteImages()) return null;
  if (DECORATIVE_PATH_RE.test(src)) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_PROBE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(src, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok || !response.body) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.startsWith("image/")) return null;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
      if (total >= REMOTE_PROBE_MAX_BYTES) break;
    }
    await reader.cancel().catch(() => undefined);
    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)), total);
    const { imageSize } = await import("image-size");
    const dims = imageSize(buffer);
    if (!dims.width || !dims.height) return null;
    if (dims.width < MIN_PHOTO_DIMENSION || dims.height < MIN_PHOTO_DIMENSION) return null;
    return { width: dims.width, height: dims.height };
  } catch {
    return null;
  }
}

async function measure(rootDir: string, prefix: string, src: string): Promise<{ width: number; height: number } | null> {
  if (!src.startsWith(prefix)) {
    return /^https?:\/\//i.test(src) ? measureRemote(src) : null;
  }
  const cachedRelPath = src.slice(prefix.length);
  if (DECORATIVE_PATH_RE.test(cachedRelPath)) return null;
  const absolutePath = path.join(rootDir, ...cachedRelPath.split("/"));
  try {
    const dims = await imageSizeFromFile(absolutePath);
    if (!dims.width || !dims.height) return null;
    if (dims.width < MIN_PHOTO_DIMENSION || dims.height < MIN_PHOTO_DIMENSION) return null;
    return { width: dims.width, height: dims.height };
  } catch {
    return null; // unreadable/corrupt image file — leave it verbatim rather than guess
  }
}

export async function detectPhotoSlots(html: string, options: DetectPhotoSlotsOptions): Promise<PhotoSlot[]> {
  const $ = cheerio.load(html, null, false);
  const root = $.root() as unknown as cheerio.Cheerio<never>;
  const prefix = assetOutputPrefix(options.templateId);
  const slots: PhotoSlot[] = [];

  for (const node of $("img").toArray()) {
    const el = $(node);
    const selector = firstMatchSelector($, node, root);
    if (!selector || options.claimedSelectors.has(selector)) continue;
    const dims = await measure(options.rootDir, prefix, effectiveImgSrc($, node));
    if (!dims) continue;
    slots.push({ selector, kind: "img", ...dims, ...(el.attr("alt") ? { alt: el.attr("alt") } : {}) });
  }

  for (const node of $("[style*='background-image']").toArray()) {
    const el = $(node);
    const selector = firstMatchSelector($, node, root);
    if (!selector || options.claimedSelectors.has(selector)) continue;
    const match = INLINE_BG_URL_RE.exec(el.attr("style") ?? "");
    if (!match) continue;
    const dims = await measure(options.rootDir, prefix, match[2]!);
    if (!dims) continue;
    slots.push({ selector, kind: "background", ...dims });
  }

  return slots;
}
