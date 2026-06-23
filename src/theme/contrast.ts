import type { SiteTheme } from "../types.js";

type Rgb = { r: number; g: number; b: number };

export function parseColor(input: string): Rgb | null {
  const hex = input.trim();
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

function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbLuminance(rgb: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

function luminance(hex: string): number {
  const c = parseColor(hex);
  return c ? rgbLuminance(c) : 0.5;
}

export function contrast(a: string, b: string): number {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return 4.5;
  const la = rgbLuminance(ca);
  const lb = rgbLuminance(cb);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(a: string, b: string, weight: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const w = Math.min(1, Math.max(0, weight));
  return toHex({
    r: ca.r * (1 - w) + cb.r * w,
    g: ca.g * (1 - w) + cb.g * w,
    b: ca.b * (1 - w) + cb.b * w,
  });
}

function lighten(hex: string, amount: number): string {
  return mix(hex, "#ffffff", amount);
}

function darken(hex: string, amount: number): string {
  return mix(hex, "#000000", amount);
}

function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return fg;
  const bgLum = luminance(bg);
  let candidate = fg;
  for (let i = 0; i < 12; i++) {
    candidate = bgLum > 0.5 ? darken(candidate, 0.08) : lighten(candidate, 0.08);
    if (contrast(candidate, bg) >= min) return candidate;
  }
  return bgLum > 0.5 ? "#0f172a" : "#f8fafc";
}

export interface ThemeTokens {
  navBg: string;
  navText: string;
  navMuted: string;
  navActiveBg: string;
  navActiveText: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  gradientFrom: string;
  gradientTo: string;
  maxWidth: string;
  gridColumns: number;
  sectionGap: string;
  cardMinHeight: string;
}

const DEFAULT_LAYOUT = {
  maxWidth: "1200px",
  gridColumns: 3,
  sectionGap: "3rem",
  cardMinHeight: "200px",
};

/** Fill missing layout/nav fields — never override AI-chosen palette. */
export function fillThemeDefaults(theme: SiteTheme): SiteTheme {
  const c = { ...theme.colors };
  return {
    ...theme,
    layout: theme.layout ?? { ...DEFAULT_LAYOUT },
    colors: c,
  };
}

/** Only nudge illegible text — preserve the AI's color choices. */
export function ensureReadableTheme(theme: SiteTheme): SiteTheme {
  const filled = fillThemeDefaults(theme);
  const c = { ...filled.colors };
  c.text = ensureContrast(c.text, c.surface, 4.5);
  c.muted = ensureContrast(c.muted, c.surface, 3);
  if (c.navText) c.navText = ensureContrast(c.navText, c.navBg, 4.5);
  if (c.navMuted) c.navMuted = ensureContrast(c.navMuted, c.navBg, 3);
  if (c.navActiveText && c.navActiveBg) {
    c.navActiveText = ensureContrast(c.navActiveText, c.navActiveBg, 4.5);
  }
  return { ...filled, colors: c };
}

/** @deprecated use ensureReadableTheme */
export const normalizeTheme = ensureReadableTheme;

export function buildThemeTokens(theme: SiteTheme): ThemeTokens {
  const t = fillThemeDefaults(theme);
  const c = t.colors;
  const layout = t.layout!;
  const navIsDark = luminance(c.navBg.startsWith("rgba") ? c.bg : c.navBg) < 0.5;
  const fallbackNavText = navIsDark ? "#fafafa" : "#0f172a";
  const navText = c.navText ?? fallbackNavText;
  const navMuted = c.navMuted ?? mix(navText, c.navBg, 0.4);
  const navActiveBg = c.navActiveBg ?? mix(c.accent, c.navBg, 0.25);
  const navActiveText = c.navActiveText ?? ensureContrast(c.accent, navActiveBg, 4.5);

  return {
    navBg: c.navBg,
    navText,
    navMuted,
    navActiveBg,
    navActiveText,
    bg: c.bg,
    surface: c.surface,
    text: c.text,
    muted: c.muted,
    accent: c.accent,
    accentSoft: c.accentSoft,
    gradientFrom: c.gradientFrom,
    gradientTo: c.gradientTo,
    maxWidth: layout.maxWidth,
    gridColumns: layout.gridColumns,
    sectionGap: layout.sectionGap,
    cardMinHeight: layout.cardMinHeight,
  };
}
