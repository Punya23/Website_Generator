/**
 * Theme screenshot + feature extraction.
 *
 * One browser visit per template demo yields two things:
 *   1. an **internal-only** review thumbnail, and
 *   2. deterministic visual features (palette, nav shape, footer shape, density)
 *
 * The features replace what the ingest LLM was otherwise guessing — visual family, nav shape,
 * footer layout — which is the per-template LLM call, i.e. the cost driver at corpus scale.
 * Reading computed styles beats sampling pixels: it is exact, cheap, and survives a demo whose
 * hero is a photograph.
 *
 * LICENSING: a rendered demo page contains stock photos, logos, and sample copy that are usually
 * NOT covered by the repository's code license, even when that code is MIT. Thumbnails are review
 * artifacts only — served to the local admin, never bundled into a generated site, never shown in
 * a public gallery. Capture is gated on a verified permissive license and on robots.txt, and the
 * files live in a gitignored directory.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getSharedBrowser } from "../qa/code-qa.js";
import { pathAllowedByRobots } from "./extract-outline.js";
import { inspectIngestUrl } from "./policy.js";
import { fetchRobots, type FetchLike } from "./http-fetch.js";
import {
  ingestScreenshotConcurrency,
  ingestScreenshotMode,
  ingestScreenshotTimeoutMs,
  thumbsDir,
} from "./config.js";
import type { ThemeFeatures } from "./types.js";
import type { SkinVisualFamily } from "../skins/schema.js";

type NavShape = "full-width" | "floating-capsule" | "floating-panel" | "split-inline";
type FooterLayout = "two-column" | "centered" | "cta-heavy";

/** Raw measurements read out of the page — everything derived downstream is a pure function of
 *  this, so the derivation is unit-testable without a browser. */
export interface RawPageMetrics {
  viewportWidth: number;
  bodyBackground: string;
  bodyColor: string;
  headingFont: string;
  bodyFont: string;
  accentColors: string[];
  nav: {
    found: boolean;
    position: string;
    width: number;
    left: number;
    top: number;
    height: number;
    borderRadius: number;
    background: string;
    logoCenterRatio: number;
    linkGroups: number;
  };
  footer: {
    found: boolean;
    columns: number;
    ctaButtons: number;
    textAlign: string;
  };
  sectionPaddings: number[];
  headingCount: number;
  imageCount: number;
  documentHeight: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseCssColor(value: string | undefined): RgbColor | null {
  if (!value) return null;
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const parts = match[1]!.split(/[,/]/).map((part) => Number.parseFloat(part.trim()));
    const [r, g, b] = parts;
    if (r === undefined || g === undefined || b === undefined) return null;
    const a = parts[3] === undefined ? 1 : parts[3];
    return { r, g, b, a: Number.isFinite(a) ? a : 1 };
  }
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1]!;
    const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  return null;
}

/** Relative luminance, WCAG definition. */
export function luminance(color: RgbColor): number {
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** HSV saturation — 0 for any grey, 1 for a fully saturated hue. */
export function saturation(color: RgbColor): number {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return max === 0 ? 0 : (max - min) / max;
}

export function hue(color: RgbColor): number {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

export function toHex(color: RgbColor): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

const NAMED_SERIF_RE =
  /\b(georgia|garamond|playfair|times|cormorant|baskerville|lora|merriweather|spectral|source serif|dm serif|noto serif|pt serif|crimson|bodoni|didot|freight|tiempos|canela)\b/i;
const MONO_RE = /\b(mono|courier|consolas|menlo)\b/i;

/**
 * Whether a CSS font stack is serif. Families are compared one by one rather than regex-scanned
 * over the whole string: `"Inter, sans-serif"` contains the word `serif` at a word boundary, so a
 * naive test marks essentially every sans page as serif.
 */
export function isSerifStack(fontFamily: string | undefined): boolean {
  if (!fontFamily) return false;
  const families = fontFamily
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter(Boolean);
  if (families.some((family) => MONO_RE.test(family))) return false;
  return families.some(
    (family) => family === "serif" || family === "ui-serif" || NAMED_SERIF_RE.test(family)
  );
}

/** First non-neutral, sufficiently opaque colour wins — call sites collect candidates in DOM
 *  order from the elements most likely to carry the brand colour (buttons, then links). */
export function pickAccent(candidates: string[]): RgbColor | null {
  for (const raw of candidates) {
    const color = parseCssColor(raw);
    if (!color || color.a < 0.5) continue;
    if (saturation(color) < 0.25) continue;
    const l = luminance(color);
    if (l > 0.95 || l < 0.02) continue;
    return color;
  }
  return null;
}

export function deriveVisualFamily(metrics: RawPageMetrics): {
  visualFamily: SkinVisualFamily;
  confident: boolean;
} {
  const background = parseCssColor(metrics.bodyBackground);
  const accent = pickAccent(metrics.accentColors);
  const serifHeadings = isSerifStack(metrics.headingFont);

  if (!background) return { visualFamily: "editorial-light", confident: false };
  // A transparent body background tells us nothing about the page's ground colour.
  if (background.a < 0.5) return { visualFamily: "editorial-light", confident: false };

  if (luminance(background) < 0.18) {
    return { visualFamily: "luxury-dark", confident: true };
  }

  if (accent) {
    const accentHue = hue(accent);
    const warm = accentHue <= 60 || accentHue >= 330;
    if (saturation(accent) >= 0.55 && warm) {
      return { visualFamily: "warm-consumer", confident: true };
    }
    if (serifHeadings) return { visualFamily: "editorial-light", confident: true };
    return { visualFamily: "corporate-light", confident: true };
  }

  // Nothing on the page carried a saturated brand colour.
  if (serifHeadings) return { visualFamily: "editorial-light", confident: true };
  return { visualFamily: "clinical-light", confident: metrics.accentColors.length > 0 };
}

export function deriveNavShape(metrics: RawPageMetrics): { navShape: NavShape; confident: boolean } {
  const nav = metrics.nav;
  if (!nav.found || metrics.viewportWidth <= 0) return { navShape: "full-width", confident: false };

  const widthRatio = nav.width / metrics.viewportWidth;
  const floats = nav.position === "fixed" || nav.position === "sticky";
  const inset = nav.left > 8 && widthRatio < 0.97;

  if (floats && inset && nav.borderRadius >= 24) {
    // A tall rounded bar is a panel; a short one is a pill.
    return { navShape: nav.height > 88 ? "floating-panel" : "floating-capsule", confident: true };
  }
  if (floats && inset) return { navShape: "floating-panel", confident: true };
  // Logo sitting near the middle with link groups either side is the split treatment.
  if (nav.linkGroups >= 2 && nav.logoCenterRatio > 0.35 && nav.logoCenterRatio < 0.65) {
    return { navShape: "split-inline", confident: true };
  }
  return { navShape: "full-width", confident: true };
}

export function deriveFooterLayout(metrics: RawPageMetrics): {
  footerLayout: FooterLayout;
  confident: boolean;
} {
  const footer = metrics.footer;
  if (!footer.found) return { footerLayout: "two-column", confident: false };
  if (footer.ctaButtons >= 1 && footer.columns <= 2) {
    return { footerLayout: "cta-heavy", confident: true };
  }
  if (footer.columns >= 2) return { footerLayout: "two-column", confident: true };
  if (footer.textAlign === "center") return { footerLayout: "centered", confident: true };
  return { footerLayout: "centered", confident: true };
}

export function deriveDensity(metrics: RawPageMetrics): "airy" | "normal" | "compact" {
  const paddings = metrics.sectionPaddings.filter((value) => Number.isFinite(value) && value >= 0);
  if (paddings.length === 0) return "normal";
  const median = [...paddings].sort((a, b) => a - b)[Math.floor(paddings.length / 2)] ?? 0;
  if (median >= 96) return "airy";
  if (median <= 40) return "compact";
  return "normal";
}

/** Pure derivation: raw measurements in, stored feature record out. */
export function deriveThemeFeatures(
  metrics: RawPageMetrics,
  extras: { capturedAt: number; sourceUrl: string; thumbnailPath?: string }
): ThemeFeatures {
  const family = deriveVisualFamily(metrics);
  const nav = deriveNavShape(metrics);
  const footer = deriveFooterLayout(metrics);
  const rawBackground = parseCssColor(metrics.bodyBackground);
  // A transparent (or unparseable) background was not actually measured — treating it as the
  // page's ground colour is how a page whose background lives on <html> read as pure black, so
  // this must use the same guard deriveVisualFamily already applies rather than the raw parse.
  const background = rawBackground && rawBackground.a >= 0.5 ? rawBackground : null;
  const accent = pickAccent(metrics.accentColors);

  return {
    capturedAt: extras.capturedAt,
    sourceUrl: extras.sourceUrl,
    thumbnailPath: extras.thumbnailPath,
    visualFamily: family.visualFamily,
    navShape: nav.navShape,
    footerLayout: footer.footerLayout,
    density: deriveDensity(metrics),
    backgroundHex: background ? toHex(background) : undefined,
    accentHex: accent ? toHex(accent) : undefined,
    dark: background ? luminance(background) < 0.18 : false,
    serifHeadings: isSerifStack(metrics.headingFont),
    headingFont: metrics.headingFont.split(",")[0]?.replace(/["']/g, "").trim() || undefined,
    bodyFont: metrics.bodyFont.split(",")[0]?.replace(/["']/g, "").trim() || undefined,
    headingCount: metrics.headingCount,
    imageCount: metrics.imageCount,
    // "Conclusive" means every attribute the LLM would otherwise have guessed was measured.
    conclusive: family.confident && nav.confident && footer.confident,
  };
}

export function thumbnailNameFor(url: string): string {
  return `${createHash("sha1").update(url).digest("hex")}.jpg`;
}

/** Read a stored thumbnail. Rejects anything that is not a bare hash filename so an admin route
 *  cannot be walked out of the thumbnails directory. */
export async function readThumbnail(name: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{40}\.jpg$/.test(name)) return null;
  try {
    return await fs.readFile(path.join(thumbsDir(), name));
  } catch {
    return null;
  }
}

/**
 * Script evaluated inside the page, kept as a source string on purpose.
 *
 * `page.evaluate(fn)` serializes the function, and the TypeScript loader (esbuild via tsx) wraps
 * every named/inner function in its `__name` keep-names helper. That helper does not exist in the
 * page, so a passed-in function dies with `ReferenceError: __name is not defined` at runtime —
 * something no unit test catches, because the failure only exists after bundling. A plain string
 * is immune to whatever the loader does to this module. Everything derived from these numbers is
 * typed and unit-tested; this layer only reads them.
 */
const READ_METRICS_SOURCE = `(() => {
  var px = function (value) {
    var n = parseFloat(value);
    return isFinite(n) ? n : 0;
  };

  // getComputedStyle never down-converts a CSS Color 4 value (oklch/oklab/lch/color()) to rgb —
  // it serializes it back in its own color space, and parseCssColor on the Node side only knows
  // legacy rgb()/rgba()/hex. Painting the string into a 1x1 canvas and reading the pixel back
  // forces the browser itself to resolve it to sRGB, so this works for every syntax a browser can
  // paint, not just the ones a hand-written regex anticipated. A sentinel fill before each probe
  // detects the (rare) case where the browser rejected the value outright — canvas silently
  // ignores an invalid fillStyle assignment instead of throwing — and falls back to the raw
  // string so parseCssColor's existing null-return path still applies to it.
  var __colorCanvas = document.createElement("canvas");
  __colorCanvas.width = 1;
  __colorCanvas.height = 1;
  var __colorCtx = __colorCanvas.getContext("2d", { willReadFrequently: true });
  var toRgb = function (value) {
    if (!value || !__colorCtx) return value;
    try {
      __colorCtx.fillStyle = "rgba(1, 2, 3, 0.016)";
      __colorCtx.fillRect(0, 0, 1, 1);
      var before = __colorCtx.getImageData(0, 0, 1, 1).data;
      __colorCtx.fillStyle = value;
      __colorCtx.fillRect(0, 0, 1, 1);
      var after = __colorCtx.getImageData(0, 0, 1, 1).data;
      if (
        after[0] === before[0] &&
        after[1] === before[1] &&
        after[2] === before[2] &&
        after[3] === before[3]
      ) {
        return value;
      }
      return "rgba(" + after[0] + ", " + after[1] + ", " + after[2] + ", " + (after[3] / 255).toFixed(3) + ")";
    } catch (e) {
      return value;
    }
  };

  var isTransparent = function (value) {
    var m = String(value || "").match(/rgba?\\(([^)]+)\\)/i);
    if (!m) return value === "transparent" || !value;
    var parts = m[1].split(/[,/]/).map(function (part) {
      return parseFloat(part);
    });
    var a = parts.length > 3 ? parts[3] : 1;
    return isFinite(a) && a <= 0;
  };

  // A page's visible ground colour is very often painted on <html> or an outer wrapper while
  // <body> itself stays transparent — walking up until something opaque is found beats reading
  // body's own (transparent) background and calling it the page colour.
  var effectiveBackground = function (start) {
    var el = start;
    var last = "";
    while (el) {
      var bg = getComputedStyle(el).backgroundColor;
      last = bg;
      if (!isTransparent(bg)) return bg;
      el = el.parentElement;
    }
    return last;
  };

  var view = document.documentElement.clientWidth || window.innerWidth || 0;
  var body = document.body || document.documentElement;
  var bodyStyle = getComputedStyle(body);
  var heading = document.querySelector("h1, h2");
  var headingStyle = heading ? getComputedStyle(heading) : bodyStyle;

  var accentColors = [];
  var buttons = Array.prototype.slice.call(
    document.querySelectorAll(
      "a[class*=btn], a[class*=button], button, .btn, .button, [role=button], input[type=submit]"
    ),
    0,
    24
  );
  for (var i = 0; i < buttons.length; i++) {
    var buttonStyle = getComputedStyle(buttons[i]);
    accentColors.push(toRgb(buttonStyle.backgroundColor), toRgb(buttonStyle.borderColor), toRgb(buttonStyle.color));
  }
  var links = Array.prototype.slice.call(document.querySelectorAll("a"), 0, 30);
  for (var j = 0; j < links.length; j++) {
    accentColors.push(toRgb(getComputedStyle(links[j]).color));
  }

  // Prefer the widest VISIBLE candidate under each selector tier — an off-canvas mobile drawer
  // (display:none, or a zero-size clip) sits before the real desktop bar in DOM order under
  // "header nav" on most templates, and would otherwise be measured as a static full-width nav.
  var isVisible = function (el) {
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    var style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  };
  var navEl = null;
  var navSelectors = ["header nav", "nav", "header"];
  for (var ns = 0; ns < navSelectors.length && !navEl; ns++) {
    var navCandidates = Array.prototype.slice
      .call(document.querySelectorAll(navSelectors[ns]))
      .filter(isVisible);
    if (navCandidates.length > 0) {
      navCandidates.sort(function (a, b) {
        return b.getBoundingClientRect().width - a.getBoundingClientRect().width;
      });
      navEl = navCandidates[0];
    }
  }
  var nav = {
    found: false,
    position: "static",
    width: 0,
    left: 0,
    top: 0,
    height: 0,
    borderRadius: 0,
    background: "rgba(0, 0, 0, 0)",
    logoCenterRatio: 0,
    linkGroups: 0
  };
  if (navEl) {
    var navRect = navEl.getBoundingClientRect();
    var navStyle = getComputedStyle(navEl);
    var brand = navEl.querySelector("[class*=logo], [class*=brand], img, svg");
    var brandRect = brand ? brand.getBoundingClientRect() : null;
    var groups = 0;
    for (var k = 0; k < navEl.children.length; k++) {
      if (navEl.children[k].querySelectorAll("a").length >= 2) groups++;
    }
    nav = {
      found: true,
      position: navStyle.position,
      width: navRect.width,
      left: navRect.left,
      top: navRect.top,
      height: navRect.height,
      borderRadius: px(navStyle.borderTopLeftRadius),
      background: toRgb(navStyle.backgroundColor),
      logoCenterRatio: brandRect && view > 0 ? (brandRect.left + brandRect.width / 2) / view : 0,
      linkGroups: groups
    };
  }

  // Count columns in a candidate row (grid tracks, a row-flex's children, or same-top children).
  // Returns 0 when the container carries no such signal.
  var countColumns = function (el) {
    var style = getComputedStyle(el);
    var kids = Array.prototype.slice.call(el.children);
    if (style.display.indexOf("grid") >= 0) {
      var tracks = style.gridTemplateColumns.split(" ").filter(function (part) {
        return part.length > 0;
      });
      return tracks.length;
    }
    if (style.display.indexOf("flex") >= 0 && style.flexDirection.indexOf("row") === 0) {
      return kids.length;
    }
    if (kids.length > 1) {
      var tops = {};
      var distinct = 0;
      for (var t = 0; t < kids.length; t++) {
        var key = String(Math.round(kids[t].getBoundingClientRect().top / 8));
        if (!tops[key]) {
          tops[key] = true;
          distinct++;
        }
      }
      if (distinct === 1) return kids.length;
    }
    return 0;
  };

  var footerEl = document.querySelector("footer");
  var footer = { found: false, columns: 0, ctaButtons: 0, textAlign: "left" };
  if (footerEl) {
    var footerStyle = getComputedStyle(footerEl);
    // The grid/flex container is often the <footer> element itself (e.g. Tailwind's
    // "<footer class='grid grid-cols-4'>"), not one of its children — measure both and keep
    // whichever produced a real signal.
    var columns = countColumns(footerEl);
    for (var r = 0; r < footerEl.children.length; r++) {
      var rowColumns = countColumns(footerEl.children[r]);
      if (rowColumns > columns) columns = rowColumns;
    }
    footer = {
      found: true,
      columns: columns,
      ctaButtons: footerEl.querySelectorAll("a[class*=btn], a[class*=button], button, .btn, .button").length,
      textAlign: footerStyle.textAlign
    };
  }

  var sectionPaddings = [];
  var sections = Array.prototype.slice.call(document.querySelectorAll("section, main > div"), 0, 20);
  for (var sIdx = 0; sIdx < sections.length; sIdx++) {
    var sectionStyle = getComputedStyle(sections[sIdx]);
    sectionPaddings.push((px(sectionStyle.paddingTop) + px(sectionStyle.paddingBottom)) / 2);
  }

  return {
    viewportWidth: view,
    bodyBackground: toRgb(effectiveBackground(body)),
    bodyColor: bodyStyle.color,
    headingFont: headingStyle.fontFamily,
    bodyFont: bodyStyle.fontFamily,
    accentColors: accentColors,
    nav: nav,
    footer: footer,
    sectionPaddings: sectionPaddings,
    headingCount: document.querySelectorAll("h1, h2, h3").length,
    imageCount: document.querySelectorAll("img, picture, [style*='background-image']").length,
    documentHeight: body.scrollHeight || 0
  };
})()`;

/** Test seam: the in-page script must stay free of loader helpers such as `__name`. */
export function readMetricsSource(): string {
  return READ_METRICS_SOURCE;
}

const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

/** Defensive normalisation of whatever came back from the page — a hostile or broken document
 *  must not put NaN or undefined into the derivation maths. */
export function normalizeMetrics(raw: unknown): RawPageMetrics {
  const source = (raw ?? {}) as Record<string, unknown>;
  const navRaw = (source.nav ?? {}) as Record<string, unknown>;
  const footerRaw = (source.footer ?? {}) as Record<string, unknown>;
  return {
    viewportWidth: num(source.viewportWidth),
    bodyBackground: str(source.bodyBackground),
    bodyColor: str(source.bodyColor),
    headingFont: str(source.headingFont),
    bodyFont: str(source.bodyFont),
    accentColors: Array.isArray(source.accentColors)
      ? source.accentColors.filter((row): row is string => typeof row === "string")
      : [],
    nav: {
      found: navRaw.found === true,
      position: str(navRaw.position, "static"),
      width: num(navRaw.width),
      left: num(navRaw.left),
      top: num(navRaw.top),
      height: num(navRaw.height),
      borderRadius: num(navRaw.borderRadius),
      background: str(navRaw.background),
      logoCenterRatio: num(navRaw.logoCenterRatio),
      linkGroups: num(navRaw.linkGroups),
    },
    footer: {
      found: footerRaw.found === true,
      columns: num(footerRaw.columns),
      ctaButtons: num(footerRaw.ctaButtons),
      textAlign: str(footerRaw.textAlign, "left"),
    },
    sectionPaddings: Array.isArray(source.sectionPaddings)
      ? source.sectionPaddings.map((row) => num(row))
      : [],
    headingCount: num(source.headingCount),
    imageCount: num(source.imageCount),
    documentHeight: num(source.documentHeight),
  };
}

let capturePermits = 0;
let captureQueue: Array<() => void> = [];

/** Exported for tests — bounding renders is the difference between two chromium tabs and forty. */
export async function withCaptureSlot<T>(fn: () => Promise<T>): Promise<T> {
  const limit = ingestScreenshotConcurrency();
  if (capturePermits >= limit) {
    await new Promise<void>((resolve) => captureQueue.push(resolve));
  }
  capturePermits += 1;
  try {
    return await fn();
  } finally {
    capturePermits -= 1;
    const next = captureQueue.shift();
    if (next) next();
  }
}

export interface CaptureOptions {
  /** Verified permissive license on the origin. Capture is refused without it. */
  licenseVerified: boolean;
  originUrl: string;
  fetchImpl?: FetchLike;
  /** Skip robots.txt (only for a robots body already fetched by the caller). */
  robotsTxt?: string | null;
}

export interface CaptureResult {
  features?: ThemeFeatures;
  skipped?: string;
}

/**
 * Visit a demo once: screenshot to an internal thumbnail and read the visual features.
 * Returns `{ skipped }` rather than throwing whenever a gate refuses the capture.
 */
export async function captureThemeFeatures(
  demoUrl: string,
  options: CaptureOptions
): Promise<CaptureResult> {
  if (ingestScreenshotMode() === "never") return { skipped: "screenshots disabled" };
  if (!options.licenseVerified) {
    return { skipped: "license not verified — demo pages are never rendered before that" };
  }
  const policy = inspectIngestUrl(demoUrl, {
    role: "demo",
    licenseVerified: true,
    originUrl: options.originUrl,
  });
  if (!policy.ok) return { skipped: policy.reason ?? "host not allowed" };

  let target: URL;
  try {
    target = new URL(demoUrl);
  } catch {
    return { skipped: "invalid demo URL" };
  }

  const robots =
    options.robotsTxt !== undefined
      ? options.robotsTxt
      : await fetchRobots(options.fetchImpl ?? fetch, target.origin);
  if (robots && !pathAllowedByRobots(robots, target.pathname || "/")) {
    return { skipped: "robots.txt disallows this path" };
  }

  return withCaptureSlot(async () => {
    const browser = await getSharedBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      // Same identity the HTTP fetches use, so a host that wants to block us can.
      userAgent: "website-generator-ingest/1.0 (+local-admin)",
    });
    const page = await context.newPage();
    try {
      // Video and audio contribute nothing to layout metrics or a static thumbnail.
      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        // A page closed mid-flight rejects the pending route; that is not an error worth raising.
        const settled = type === "media" ? route.abort() : route.continue();
        void settled.catch(() => undefined);
      });
      await page.goto(demoUrl, {
        waitUntil: "domcontentloaded",
        timeout: ingestScreenshotTimeoutMs(),
      });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

      const metrics = normalizeMetrics(await page.evaluate(READ_METRICS_SOURCE));

      let thumbnailPath: string | undefined;
      try {
        const dir = thumbsDir();
        await fs.mkdir(dir, { recursive: true });
        const name = thumbnailNameFor(demoUrl);
        const buffer = await page.screenshot({
          type: "jpeg",
          quality: 62,
          clip: { x: 0, y: 0, width: 1280, height: Math.min(1600, Math.max(400, metrics.documentHeight)) },
        });
        const file = path.join(dir, name);
        await fs.writeFile(file, buffer);
        // Relative to the repo root so a custom INGEST_THUMBS_DIR is reflected honestly; only the
        // basename is ever used to look the file back up.
        thumbnailPath = path.relative(process.cwd(), file);
      } catch {
        // A failed thumbnail must not cost us the features we already measured.
      }

      return {
        features: deriveThemeFeatures(metrics, {
          capturedAt: Date.now(),
          sourceUrl: demoUrl,
          thumbnailPath,
        }),
      };
    } catch (err) {
      return { skipped: err instanceof Error ? err.message : String(err) };
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  });
}

/**
 * Delete thumbnails nothing references any more. At corpus scale these accumulate — ~50 KB each,
 * so 10k candidates is ~500 MB — and a rejected candidate's render is dead weight. Only files
 * matching the hash name pattern are ever removed, so an unrelated file dropped in the directory
 * is left alone.
 */
export async function pruneThumbnails(keep: ReadonlySet<string>): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(thumbsDir());
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!/^[0-9a-f]{40}\.jpg$/.test(name)) continue;
    if (keep.has(name)) continue;
    try {
      await fs.unlink(path.join(thumbsDir(), name));
      removed += 1;
    } catch {
      // Raced with a write, or already gone.
    }
  }
  return removed;
}

/** Test seam — the capture queue is module state. */
export function resetCaptureQueue(): void {
  capturePermits = 0;
  captureQueue = [];
}
