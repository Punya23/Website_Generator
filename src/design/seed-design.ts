import type { VerticalProfileId } from "./vertical-profiles.js";
import { pickFrom } from "./variation.js";
import type { PalettePartial } from "../types.js";

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m?.[1]) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

/** Rotate accent hue within profile family so regens diverge visually. */
export function deriveAccentFromSeed(
  seed: number,
  baseAccent: string,
  _profileId: VerticalProfileId
): string {
  const rgb = parseHex(baseAccent);
  if (!rgb) return baseAccent;
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const shift = pickFrom(seed, "accent-hue", [-30, -22, -15, 15, 22, 30]);
  const next = hslToRgb((h + shift + 360) % 360, Math.min(1, s + 0.05), l);
  return toHex(next.r, next.g, next.b);
}

function softenAccent(hex: string, amount = 0.12): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const next = hslToRgb(h, Math.max(0.15, s - amount), Math.min(0.92, l + amount));
  return toHex(next.r, next.g, next.b);
}

export function applySeedToPalette(
  palette: PalettePartial,
  seed: number,
  profileId: VerticalProfileId
): PalettePartial {
  const accent = deriveAccentFromSeed(seed, palette.colors.accent, profileId);
  const gradientFrom = deriveAccentFromSeed(seed + 1, palette.colors.gradientFrom ?? accent, profileId);
  const gradientTo = deriveAccentFromSeed(seed + 2, palette.colors.gradientTo ?? accent, profileId);
  return {
    ...palette,
    colors: {
      ...palette.colors,
      accent,
      accentSoft: softenAccent(accent, profileId === "luxury-dark" ? 0.35 : 0.12),
      gradientFrom,
      gradientTo,
    },
  };
}

const HEADING_POOLS: Record<VerticalProfileId, string[]> = {
  "luxury-dark": ["Cormorant Garamond", "Playfair Display", "Libre Baskerville", "Fraunces"],
  "clinical-light": ["DM Sans", "Source Sans 3", "Plus Jakarta Sans", "Inter"],
  "corporate-light": ["Plus Jakarta Sans", "Inter", "DM Sans", "Source Sans 3"],
  "editorial-light": ["Playfair Display", "Cormorant Garamond", "Libre Baskerville", "Fraunces"],
  "warm-consumer": ["Outfit", "DM Sans", "Fraunces", "Source Sans 3"],
};

const BODY_POOL = ["Inter", "Source Sans 3", "DM Sans"] as const;

export function pickTypographyFromSeed(
  seed: number,
  profileId: VerticalProfileId
): { fontHeading: string; fontBody: string } {
  return {
    fontHeading: pickFrom(seed, "heading-font", HEADING_POOLS[profileId]),
    fontBody: pickFrom(seed, "body-font", [...BODY_POOL]),
  };
}
