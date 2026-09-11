/**
 * Force a target palette onto a template's own stylesheet, changing colors and nothing else.
 *
 * A pure "swap the CSS custom properties" pass is not enough: real templates declare a `:root`
 * block AND scatter raw hex literals through gradients, shadows and one-off rules (the Bijoy
 * sample in this repo's bundle has both). So every color literal in every declaration is parsed,
 * bucketed by the property it appears in plus its luminance, and remapped:
 *
 * - background-role colors keep their relative layering (a card that sat on a lighter panel still
 *   reads as a distinct layer afterwards) by rank-mapping onto the palette's background ramp;
 * - text/border colors snap to the palette's on-dark equivalents;
 * - saturated accents keep their HUE and only get lightness/saturation clamped, which is what
 *   keeps two recolored templates from collapsing into the same monochrome look;
 * - shadows collapse toward black, preserving alpha.
 *
 * A custom property's role is inferred from every place it is actually *used* via `var(--x)`, not
 * from the property it happens to be declared under. Templates commonly declare `--black-1: #111`
 * in `:root` and then write `color: var(--black-1)` everywhere for body text — if role were taken
 * from the declaration site alone, every one of those custom properties defaults to "background"
 * (see `roleForProp`), so the text color gets folded into the background ramp and comes out a
 * similar dark tone to the page background itself: illegible, near-invisible text. Confirmed live
 * against the Bijoy sample in this repo's bundle before this fix.
 */
import { type Declaration, type Root } from "postcss";
import { parseCssTolerantly } from "./scope-css.js";
import { colord, extend, type Colord } from "colord";
import namesPlugin from "colord/plugins/names";
import type { RecolorPalette } from "../types.js";

// The names plugin ships a default export typed as Plugin; NodeNext resolution surfaces it as a
// namespace, so it is re-cast to the parameter type `extend` actually accepts.
extend([namesPlugin as unknown as Parameters<typeof extend>[0][number]]);

type ColorRole = "background" | "text" | "border" | "shadow" | "accent";

const BACKGROUND_PROPS = /^(background|background-color|background-image|border-image|fill)$/i;
const TEXT_PROPS = /^(color|-webkit-text-fill-color|caret-color)$/i;
const BORDER_PROPS = /^(border|border-[a-z]+|border-[a-z]+-color|border-color|outline|outline-color|stroke|column-rule|column-rule-color)$/i;
const SHADOW_PROPS = /^(box-shadow|-webkit-box-shadow|text-shadow|filter|-webkit-filter)$/i;

/** Matches hex, rgb(a), hsl(a) and bare CSS color names as separate tokens. */
const COLOR_TOKEN_RE =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)|\b[a-zA-Z]{3,20}\b/g;

/** Matches a `var(--name` reference (fallback value, if any, is not needed — the declared value
 *  for `--name` is looked up directly). */
const VAR_REF_RE = /var\(\s*--([a-zA-Z0-9_-]+)/g;
/** Same reference, capturing the whole `var(--name, fallback)` call so it can be replaced outright. */
const VAR_CALL_RE = /var\(\s*--([a-zA-Z0-9_-]+)\s*(?:,[^)]*)?\)/g;

const NON_COLOR_KEYWORDS = new Set([
  "inherit", "initial", "unset", "revert", "none", "auto", "transparent", "currentcolor",
  "linear", "radial", "conic", "gradient", "repeating", "to", "at", "from", "var", "calc",
  "inset", "solid", "dashed", "dotted", "double", "groove", "ridge", "outset", "hidden",
  "center", "top", "bottom", "left", "right", "cover", "contain", "repeat", "no", "space",
  "round", "padding", "content", "border", "box", "url", "important", "and", "not", "only",
]);

function roleForProp(prop: string): ColorRole {
  const p = prop.toLowerCase();
  if (SHADOW_PROPS.test(p)) return "shadow";
  if (BORDER_PROPS.test(p)) return "border";
  if (TEXT_PROPS.test(p)) return "text";
  if (BACKGROUND_PROPS.test(p)) return "background";
  return "background";
}

function parseColor(token: string): Colord | null {
  const c = colord(token);
  return c.isValid() ? c : null;
}

function isColorToken(token: string): boolean {
  const lower = token.toLowerCase();
  if (NON_COLOR_KEYWORDS.has(lower)) return false;
  if (/^#[0-9a-fA-F]{3,8}$/.test(token)) return true;
  if (/^(rgba?|hsla?)\(/i.test(token)) return true;
  if (/^[a-zA-Z]+$/.test(token)) return colord(lower).isValid();
  return false;
}

function firstColorToken(value: string): string | null {
  for (const token of value.match(COLOR_TOKEN_RE) ?? []) {
    if (isColorToken(token)) return token;
  }
  return null;
}

interface Occurrence {
  key: string;
  role: ColorRole;
  color: Colord;
}

/** `--name` -> its declared color, resolved one level (a custom property whose value is itself
 *  `var(--other)` is not chased further — real templates rarely chain past one level, and an
 *  unresolved reference just falls back to the declaration-site default below). */
function collectCustomProps(root: Root): Map<string, Colord> {
  const props = new Map<string, Colord>();
  root.walkDecls((decl: Declaration) => {
    if (!decl.prop.startsWith("--")) return;
    const token = firstColorToken(decl.value);
    const color = token ? parseColor(token) : null;
    if (color) props.set(decl.prop.slice(2), color);
  });
  return props;
}

/**
 * Every literal color occurrence, PLUS one occurrence per `var(--name)` reference site — attributed
 * to the referencing declaration's role, which is what makes a text-role usage of a custom property
 * count as "text" even though the property itself is declared once, generically, in `:root`.
 */
function scanOccurrences(root: Root, customProps: Map<string, Colord>): Occurrence[] {
  const occurrences: Occurrence[] = [];
  root.walkDecls((decl: Declaration) => {
    const isCustomPropDecl = decl.prop.startsWith("--");
    const role = roleForProp(decl.prop);

    // A custom property's OWN declaration site (`--black-1: #111`) contributes no role vote of
    // its own — that would just reintroduce the bug this function exists to fix. Its role comes
    // entirely from where it is referenced.
    if (!isCustomPropDecl) {
      for (const token of decl.value.match(COLOR_TOKEN_RE) ?? []) {
        if (!isColorToken(token)) continue;
        const color = parseColor(token);
        if (!color) continue;
        occurrences.push({ key: color.toHex(), role, color });
      }
    }

    VAR_REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VAR_REF_RE.exec(decl.value))) {
      const name = match[1]!;
      const color = customProps.get(name);
      if (color) occurrences.push({ key: color.toHex(), role, color });
    }
  });
  return occurrences;
}

export interface RecolorStats {
  distinctColors: number;
  rewritten: number;
  sourceWasDark: boolean;
}

export interface RecolorResult {
  css: string;
  stats: RecolorStats;
}

export function recolorCss(css: string, palette: RecolorPalette): RecolorResult {
  const root = parseCssTolerantly(css);
  const customProps = collectCustomProps(root);
  const occurrences = scanOccurrences(root, customProps);

  // Aggregate each distinct color's dominant role and how often it appears.
  const byColor = new Map<string, { color: Colord; counts: Record<ColorRole, number>; total: number }>();
  for (const occ of occurrences) {
    const row = byColor.get(occ.key) ?? {
      color: occ.color,
      counts: { background: 0, text: 0, border: 0, shadow: 0, accent: 0 },
      total: 0,
    };
    row.counts[occ.role] += 1;
    row.total += 1;
    byColor.set(occ.key, row);
  }

  const dominantRole = (counts: Record<ColorRole, number>): ColorRole => {
    let best: ColorRole = "background";
    let bestN = -1;
    for (const role of ["background", "text", "border", "shadow"] as ColorRole[]) {
      if (counts[role] > bestN) {
        best = role;
        bestN = counts[role];
      }
    }
    return best;
  };

  const isAccent = (color: Colord): boolean => {
    const { s, l } = color.toHsl();
    return s >= 35 && l >= 12 && l <= 92;
  };

  // Background-role, low-saturation colors form the template's surface stack.
  const surfaces = [...byColor.entries()]
    .filter(([, row]) => dominantRole(row.counts) === "background" && !isAccent(row.color))
    .map(([key, row]) => ({ key, color: row.color, weight: row.total, lum: row.color.toHsl().l }));

  // Direction matters: a light template inverts onto the dark ramp (lightest surface becomes the
  // deepest black), while an already-dark template keeps its own ordering so layering is not
  // turned inside out.
  const weighted = surfaces.reduce((sum, s) => sum + s.weight, 0) || 1;
  const meanLum = surfaces.reduce((sum, s) => sum + s.lum * s.weight, 0) / weighted;
  const sourceWasDark = surfaces.length > 0 && meanLum < 45;

  const ordered = [...surfaces].sort((a, b) => (sourceWasDark ? a.lum - b.lum : b.lum - a.lum));
  const ramp = palette.backgroundRamp;
  const surfaceMap = new Map<string, string>();
  ordered.forEach((surface, index) => {
    surfaceMap.set(surface.key, ramp[Math.min(index, ramp.length - 1)]!);
  });

  const mapColor = (color: Colord, role: ColorRole): string => {
    const alpha = color.alpha();
    const hex = color.toHex();
    const withAlpha = (out: string): string =>
      alpha < 1 ? colord(out).alpha(alpha).toRgbString() : out;

    if (role === "shadow") {
      return withAlpha(colord("#000000").toHex());
    }

    if (isAccent(color)) {
      const hsl = color.toHsl();
      const clampedL = Math.min(
        palette.accentMaxLightness * 100,
        Math.max(palette.accentMinLightness * 100, hsl.l)
      );
      // A palette with its own `accentColor` (the live, user-chosen brand color) forces every
      // accent onto that hue/saturation — the source's own brand hue only wins for the built-in
      // presets, which have no `accentColor` and fall through to preserving it untouched.
      const forced = palette.accentColor ? colord(palette.accentColor).toHsl() : null;
      const h = forced?.h ?? hsl.h;
      const s = Math.min(forced?.s ?? hsl.s, 85);
      return withAlpha(colord({ h, s, l: clampedL }).toHex());
    }

    if (role === "background") {
      const mapped = surfaceMap.get(hex);
      if (mapped) return withAlpha(mapped);
      return withAlpha(color.toHsl().l > 50 ? ramp[0]! : ramp[ramp.length - 1]!);
    }

    if (role === "border") return withAlpha(palette.borderOnDark);

    // text
    const { s, l } = color.toHsl();
    if (s < 20 && l > 35 && l < 75) return withAlpha(palette.mutedOnDark);
    return withAlpha(palette.textOnDark);
  };

  let rewritten = 0;
  root.walkDecls((decl: Declaration) => {
    const role = roleForProp(decl.prop);
    COLOR_TOKEN_RE.lastIndex = 0;
    decl.value = decl.value.replace(COLOR_TOKEN_RE, (token) => {
      if (!isColorToken(token)) return token;
      const color = parseColor(token);
      if (!color) return token;
      const row = byColor.get(color.toHex());
      const effectiveRole = row ? dominantRole(row.counts) : role;
      // A custom property carries no property context of its own; use how it is actually used
      // (via the var()-attributed tally built above), not the declaration site's default.
      const finalRole = decl.prop.startsWith("--") ? effectiveRole : role;
      rewritten += 1;
      return mapColor(color, finalRole);
    });

    // A custom property this declaration references may be used elsewhere for a genuinely
    // different role — confirmed live: `--thm-base` serves both `color:` (text) in one rule and
    // `background-color:` (background) in another, on the same element. The variable's shared
    // recolored value can only be right for whichever role won the majority vote; this specific
    // usage, when it's the loser, gets its own direct literal instead of the shared reference —
    // an all-white theme-base variable used for text stays light; the one usage of it as a button
    // background gets pushed back into the dark ramp rather than rendering white-on-white.
    if (!decl.prop.startsWith("--")) {
      VAR_CALL_RE.lastIndex = 0;
      decl.value = decl.value.replace(VAR_CALL_RE, (call, name: string) => {
        const original = customProps.get(name);
        if (!original) return call; // not a color custom property (spacing, timing, …) — leave it
        const overallRole = dominantRole(byColor.get(original.toHex())?.counts ?? { background: 0, text: 0, border: 0, shadow: 0, accent: 0 });
        if (overallRole === role) return call; // no conflict — the shared recolored value is already right
        rewritten += 1;
        return mapColor(original, role);
      });
    }
  });

  return {
    css: root.toString(),
    stats: { distinctColors: byColor.size, rewritten, sourceWasDark },
  };
}
