/**
 * Remap one template's structural CSS (corner radius, container width) toward another template's
 * design fingerprint — the structural counterpart to `recolor-css.ts`, which does the same job for
 * color.
 *
 * Only applied to a section BORROWED from a non-anchor template (`select.ts`'s cross-template mix);
 * the anchor's own stylesheet ships untouched, since it defines the site's look. Snapping to the
 * anchor's own representative values (rather than proportionally scaling the source's numbers) is
 * deliberate — a proportional scale of a 2px source radius by a 20x factor produces an ugly 40px
 * corner no template ever actually authored; the anchor's own real value is always a value the site
 * already looks correct with.
 */
import { type Declaration, type Root } from "postcss";
import { parseCssTolerantly } from "./scope-css.js";
import type { DesignFingerprint } from "../types.js";

const RADIUS_PROPS = /^(border-radius|border-(top|bottom)-(left|right)-radius)$/i;
const LENGTH_RE = /(-?\d*\.?\d+)(px|rem|em)\b/;
const PILL_VALUE_RE = /^\s*(50%|9999px|999px|100vh|100vw)\s*$/i;

const RADIUS_REPRESENTATIVE_PX: Record<DesignFingerprint["radiusScale"], string> = {
  sharp: "3px",
  soft: "10px",
  rounded: "20px",
  pill: "9999px",
};

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

/** Rewrites every `border-radius` (shorthand or corner-specific longhand) declaration's numeric or
 *  percentage value to the target fingerprint's representative radius for its bucket. A multi-value
 *  shorthand (`border-radius: 4px 4px 0 0`) has every non-zero component remapped together, keeping
 *  a deliberately-asymmetric shape (a "flag" corner, only-top-rounded) recognizable rather than
 *  collapsing it into one flat value. */
function restyleRadius(root: Root, target: DesignFingerprint): number {
  let rewritten = 0;
  const targetValue = RADIUS_REPRESENTATIVE_PX[target.radiusScale];
  root.walkDecls(RADIUS_PROPS, (decl) => {
    const parts = decl.value.split(/\s+/);
    let changed = false;
    const next = parts.map((part) => {
      if (PILL_VALUE_RE.test(part)) {
        changed = true;
        return targetValue;
      }
      const match = part.match(LENGTH_RE);
      if (!match) return part;
      const px = Number.parseFloat(match[1]!) * (match[2] === "px" ? 1 : 16);
      if (px <= 0) return part; // a genuine sharp (0) corner in a multi-value shape stays sharp
      changed = true;
      return targetValue;
    });
    if (changed) {
      decl.value = next.join(" ");
      rewritten += 1;
    }
  });
  return rewritten;
}

/** Rewrites `max-width` declarations that look like a page/section container (matched the same way
 *  `design-fingerprint.ts` identified the source's own container width in the first place) to the
 *  target's container width, so a borrowed section's content rail lines up with the rest of the
 *  page instead of visibly over- or under-shooting it. Declarations far from the source's own
 *  measured container width (an image, a modal, an icon wrapper) are left alone. */
function restyleContainerWidth(root: Root, source: DesignFingerprint, target: DesignFingerprint): number {
  if (Math.abs(source.containerMaxWidthPx - target.containerMaxWidthPx) < 24) return 0; // not worth touching
  let rewritten = 0;
  root.walkDecls("max-width", (decl) => {
    const match = decl.value.match(LENGTH_RE);
    if (!match) return;
    const px = Number.parseFloat(match[1]!) * (match[2] === "px" ? 1 : 16);
    if (Math.abs(px - source.containerMaxWidthPx) > source.containerMaxWidthPx * 0.15) return;
    decl.value = `${target.containerMaxWidthPx}px`;
    rewritten += 1;
  });
  return rewritten;
}

export interface RestyleStats {
  radiusRewritten: number;
  containerRewritten: number;
}

export interface RestyleResult {
  css: string;
  stats: RestyleStats;
}

/** No-op (returns the input unchanged) when `source` and `target` already read the same — avoids
 *  needless CSS churn (and cache misses) for the common case of two templates that already share a
 *  design language, and is always a no-op for the anchor's own stylesheet since callers only invoke
 *  this for a borrowed, non-anchor template. */
export function restyleCss(css: string, source: DesignFingerprint, target: DesignFingerprint): RestyleResult {
  if (
    source.radiusScale === target.radiusScale &&
    Math.abs(source.containerMaxWidthPx - target.containerMaxWidthPx) < 24
  ) {
    return { css, stats: { radiusRewritten: 0, containerRewritten: 0 } };
  }
  try {
    const root = parseCssTolerantly(css);
    const radiusRewritten = restyleRadius(root, target);
    const containerRewritten = restyleContainerWidth(root, source, target);
    return { css: root.toString(), stats: { radiusRewritten, containerRewritten } };
  } catch {
    // A stylesheet the tolerant parser still can't make sense of ships as-is — the section's own
    // corners/width may not match the anchor, but a broken stylesheet is worse than a mismatched one.
    return { css, stats: { radiusRewritten: 0, containerRewritten: 0 } };
  }
}
