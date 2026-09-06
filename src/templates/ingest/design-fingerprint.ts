/**
 * Structural "design fingerprint" per ingested template — container width, corner radius, and
 * spacing rhythm, read heuristically from the template's own (scoped) stylesheet.
 *
 * `recolor-css.ts` forces every template onto the same color palette; nothing forces them onto the
 * same structural scale. Two templates recolored identically can still clash the moment a section
 * from one lands next to a section from the other: a 940px container next to a 1400px one reads as
 * misaligned boxes, a sharp-cornered card next to a pill-shaped one reads as two different design
 * systems glued together. This is the missing signal `select.ts` needs to know a cross-template mix
 * is actually safe, and `restyle-css.ts` needs to know what to remap a borrowed section *toward*.
 *
 * Heuristic, not measured (no headless render): a corpus of 1000+ templates has to be fingerprinted
 * once at ingest without a browser round-trip per template. Every signal here degrades gracefully —
 * an unmatched stylesheet just yields the default fingerprint, which conservatively reads as "generic
 * mid-scale" rather than throwing.
 */
import { type Declaration, type Root } from "postcss";
import { parseCssTolerantly } from "./scope-css.js";
import type { DesignFingerprint, RadiusScale, SpacingScale } from "../types.js";

const CONTAINER_MIN_PX = 480;
const CONTAINER_MAX_PX = 2000;
/** Real container widths cluster tightly around Bootstrap/Foundation-style breakpoints. Anything
 *  outside this band is far more likely to be an image, a modal, or an outlier than a page container. */
const COMMON_CONTAINER_RANGE: [number, number] = [860, 1600];
const CONTAINER_SELECTOR_RE = /\b(container|wrapper|inner|content|row|wrap)\b/i;

const RADIUS_PROPS = /^(border-radius|border-(top|bottom)-(left|right)-radius)$/i;
const PILL_SELECTOR_RE = /\b(btn|button|badge|pill|tag|chip|toggle)\b/i;

const SPACING_PROPS = /^(padding|padding-top|padding-bottom|margin|margin-top|margin-bottom|gap|row-gap|column-gap)$/i;
const SPACING_SELECTOR_RE = /\b(section|hero|container|wrapper|row|band)\b/i;

const DEFAULT_FINGERPRINT: DesignFingerprint = {
  containerMaxWidthPx: 1200,
  radiusPx: 8,
  radiusScale: "soft",
  spacingScale: "normal",
};

function toPx(value: number, unit: string): number {
  if (unit === "rem" || unit === "em") return value * 16;
  return value;
}

/** One numeric length token in a declaration's value, e.g. the `71.25rem` in `max-width: 71.25rem`. */
const LENGTH_RE = /(-?\d*\.?\d+)(px|rem|em)\b/;
/** `50%`, `9999px`, or a bare huge px value — every one of these means "fully rounded" regardless
 *  of the box's actual size, which is why they cannot be averaged in with real pixel radii. */
const PILL_VALUE_RE = /^\s*(50%|9999px|999px|100vh|100vw)\s*$/i;

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function mode(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const [v, count] of counts) {
    if (count > bestCount) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}

export function radiusScaleForPx(px: number): RadiusScale {
  if (px >= 999) return "pill";
  if (px <= 4) return "sharp";
  if (px <= 14) return "soft";
  if (px <= 28) return "rounded";
  return "pill";
}

export function spacingScaleForPx(px: number): SpacingScale {
  if (px <= 16) return "tight";
  if (px <= 40) return "normal";
  return "loose";
}

/** Selector text a postcss `Rule` carries — read once per declaration's parent, tolerant of
 *  non-Rule parents (e.g. a declaration inside `@media` still has a Rule grandparent via `.parent`). */
function selectorOf(decl: Declaration): string {
  let node: { type?: string; selector?: string; parent?: unknown } | undefined = decl as unknown as {
    type?: string;
    selector?: string;
    parent?: unknown;
  };
  for (let depth = 0; node && depth < 4; depth += 1) {
    if (node.type === "rule" && typeof node.selector === "string") return node.selector;
    node = node.parent as typeof node;
  }
  return "";
}

function extractContainerWidths(root: Root): number[] {
  const widths: number[] = [];
  root.walkDecls("max-width", (decl) => {
    const match = decl.value.match(LENGTH_RE);
    if (!match) return;
    const px = toPx(Number.parseFloat(match[1]!), match[2]!);
    if (px < CONTAINER_MIN_PX || px > CONTAINER_MAX_PX) return;
    const selector = selectorOf(decl);
    const inCommonRange = px >= COMMON_CONTAINER_RANGE[0] && px <= COMMON_CONTAINER_RANGE[1];
    if (CONTAINER_SELECTOR_RE.test(selector) || inCommonRange) widths.push(Math.round(px));
  });
  return widths;
}

function extractRadii(root: Root): { general: number[]; pillish: number[] } {
  const general: number[] = [];
  const pillish: number[] = [];
  root.walkDecls(RADIUS_PROPS, (decl) => {
    const selector = selectorOf(decl);
    const isPillCandidate = PILL_SELECTOR_RE.test(selector);
    for (const raw of decl.value.split(/\s+/)) {
      if (PILL_VALUE_RE.test(raw)) {
        (isPillCandidate ? pillish : general).push(999);
        continue;
      }
      const match = raw.match(LENGTH_RE);
      if (!match) continue;
      const px = toPx(Number.parseFloat(match[1]!), match[2]!);
      if (px < 0 || px > 400) continue;
      (isPillCandidate ? pillish : general).push(Math.round(px));
    }
  });
  return { general, pillish };
}

function extractSpacing(root: Root): number[] {
  const values: number[] = [];
  root.walkDecls(SPACING_PROPS, (decl) => {
    const selector = selectorOf(decl);
    if (!SPACING_SELECTOR_RE.test(selector)) return;
    for (const raw of decl.value.split(/\s+/)) {
      const match = raw.match(LENGTH_RE);
      if (!match) continue;
      const px = toPx(Number.parseFloat(match[1]!), match[2]!);
      if (px < 4 || px > 200) continue;
      values.push(Math.round(px));
    }
  });
  return values;
}

/** Read a template's structural design language from its own (already scoped) stylesheet. Never
 *  throws — a stylesheet postcss cannot make sense of yields the conservative default fingerprint
 *  rather than failing the whole ingest over a cosmetic signal. */
export function extractDesignFingerprint(css: string): DesignFingerprint {
  try {
    const root = parseCssTolerantly(css);

    const containerWidths = extractContainerWidths(root);
    const containerMaxWidthPx =
      mode(containerWidths) ?? median(containerWidths) ?? DEFAULT_FINGERPRINT.containerMaxWidthPx;

    const { general, pillish } = extractRadii(root);
    // Button/badge corners are the strongest "how rounded does this design feel" signal — a card
    // grid is often a flatter, more conservative radius than the buttons sitting inside it. Only
    // fall back to the general population when nothing pill-selector-shaped was found at all.
    const radiusSample = pillish.length > 0 ? pillish : general;
    const radiusPx = median(radiusSample) ?? DEFAULT_FINGERPRINT.radiusPx;

    const spacingValues = extractSpacing(root);
    const spacingPx = median(spacingValues) ?? 24;

    return {
      containerMaxWidthPx: Math.round(containerMaxWidthPx),
      radiusPx: Math.min(999, Math.round(radiusPx)),
      radiusScale: radiusScaleForPx(radiusPx),
      spacingScale: spacingScaleForPx(spacingPx),
    };
  } catch {
    return DEFAULT_FINGERPRINT;
  }
}

const RADIUS_ORDER: RadiusScale[] = ["sharp", "soft", "rounded", "pill"];
const SPACING_ORDER: SpacingScale[] = ["tight", "normal", "loose"];

function bucketCloseness<T>(order: T[], a: T, b: T): number {
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia < 0 || ib < 0) return 0.5;
  const distance = Math.abs(ia - ib);
  if (distance === 0) return 1;
  if (distance === 1) return 0.6;
  return 0.2;
}

/**
 * How safe it is to place a section fingerprinted `candidate` next to the site's anchor design
 * (fingerprinted `anchor`) — 0 (visibly clashing) to 1 (indistinguishable). `select.ts` gates
 * cross-template mixing on this; `restyle-css.ts` is what actually closes the gap once a mix is
 * accepted, but a pairing scoring near 0 here is one no amount of CSS remapping should paper over
 * (e.g. a 940px editorial container forced to become a 1600px full-bleed one loses its own rhythm).
 *
 * Missing fingerprints (a section ingested before this field existed, not yet backfilled) score 0 —
 * the safe default is "don't mix it in," not "assume it's fine."
 */
export function fingerprintCompatibility(
  anchor: DesignFingerprint | undefined,
  candidate: DesignFingerprint | undefined
): number {
  if (!anchor || !candidate) return 0;
  const containerScore = 1 - Math.min(1, Math.abs(anchor.containerMaxWidthPx - candidate.containerMaxWidthPx) / 400);
  const radiusScore = bucketCloseness(RADIUS_ORDER, anchor.radiusScale, candidate.radiusScale);
  const spacingScore = bucketCloseness(SPACING_ORDER, anchor.spacingScale, candidate.spacingScale);
  return 0.5 * containerScore + 0.3 * radiusScore + 0.2 * spacingScore;
}
