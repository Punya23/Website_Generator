import type { SiteTheme } from "../types.js";

type Rgb = { r: number; g: number; b: number; a?: number };

export function parseColor(input: string): Rgb | null {
  const s = input.trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex?.[1]) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return {
      r: Number.parseInt(h.slice(0, 2), 16),
      g: Number.parseInt(h.slice(2, 4), 16),
      b: Number.parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgba = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] !== undefined ? Number(rgba[4]) : 1,
    };
  }

  return null;
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

export function luminance(color: string): number {
  const effective = resolveEffectiveColor(color, "#ffffff");
  const c = parseColor(effective);
  return c ? rgbLuminance(c) : 0.5;
}

/** Blend foreground over background when foreground has alpha < 1. */
export function resolveEffectiveColor(fg: string, under: string): string {
  const top = parseColor(fg);
  const bottom = parseColor(under);
  if (!top) return fg;
  if (!bottom || top.a === undefined || top.a >= 1) return toHex(top);
  const a = Math.min(1, Math.max(0, top.a));
  return toHex({
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
  });
}

export function contrast(a: string, b: string): number {
  const ca = parseColor(resolveEffectiveColor(a, b));
  const cb = parseColor(b);
  if (!ca || !cb) return 4.5;
  const la = rgbLuminance(ca);
  const lb = rgbLuminance(cb);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function effectiveNavBg(navBg: string, pageBg: string): string {
  return resolveEffectiveColor(navBg, pageBg);
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
  const effectiveBg = parseColor(bg)?.a !== undefined && parseColor(bg)!.a! < 1
    ? resolveEffectiveColor(bg, "#ffffff")
    : bg;
  if (contrast(fg, effectiveBg) >= min) return fg;
  const bgLum = luminance(effectiveBg);
  let candidate = fg;
  for (let i = 0; i < 12; i++) {
    candidate = bgLum > 0.5 ? darken(candidate, 0.08) : lighten(candidate, 0.08);
    if (contrast(candidate, effectiveBg) >= min) return candidate;
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

export interface DesignTokenQA {
  passed: boolean;
  issues: Array<{ code: string; message: string; severity: "hard" | "soft" }>;
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
    pageTone: theme.pageTone ?? "light",
    navTreatment: theme.navTreatment ?? "solid",
    gradientMood: theme.gradientMood ?? "subtle",
    accentRole: theme.accentRole ?? "sparing",
    layout: theme.layout ?? { ...DEFAULT_LAYOUT },
    colors: c,
  };
}

/** Only nudge illegible text — preserve the AI's color choices. */
export function ensureReadableTheme(theme: SiteTheme): SiteTheme {
  const filled = fillThemeDefaults(theme);
  const c = { ...filled.colors };
  const navEffective = effectiveNavBg(c.navBg, c.bg);

  c.text = ensureContrast(c.text, c.surface, 4.5);
  c.muted = ensureContrast(c.muted, c.surface, 3);

  const navText = c.navText ?? (luminance(navEffective) < 0.5 ? "#f8fafc" : "#0f172a");
  c.navText = ensureContrast(navText, navEffective, 4.5);

  const navMuted = c.navMuted ?? mix(c.navText, navEffective, 0.35);
  c.navMuted = ensureContrast(navMuted, navEffective, 3);

  const navActiveBg = c.navActiveBg ?? mix(c.accent, navEffective, 0.3);
  c.navActiveBg = navActiveBg;
  c.navActiveText = ensureContrast(c.navActiveText ?? c.accent, navActiveBg, 4.5);

  // CTA gradient text is white — ensure gradient mid-tone is dark enough
  const gradMid = mix(c.gradientFrom, c.gradientTo, 0.5);
  if (contrast("#ffffff", gradMid) < 3) {
    c.gradientFrom = darken(c.gradientFrom, 0.15);
    c.gradientTo = darken(c.gradientTo, 0.1);
  }

  return { ...filled, colors: c };
}

/** @deprecated use ensureReadableTheme */
export const normalizeTheme = ensureReadableTheme;

export function runDesignTokenQA(theme: SiteTheme): DesignTokenQA {
  const t = fillThemeDefaults(theme);
  const c = t.colors;
  const issues: DesignTokenQA["issues"] = [];
  const navEffective = effectiveNavBg(c.navBg, c.bg);

  if (c.navText && contrast(c.navText, navEffective) < 4.5) {
    issues.push({
      code: "NAV_CONTRAST",
      message: `Nav text contrast ${contrast(c.navText, navEffective).toFixed(2)} on effective nav`,
      severity: "hard",
    });
  }

  if (t.navTreatment === "glass-light" && t.pageTone === "light") {
    issues.push({
      code: "GLASS_LIGHT_ON_LIGHT",
      message: "glass-light nav on light page may wash out",
      severity: "soft",
    });
  }

  if (contrast("#ffffff", mix(c.gradientFrom, c.gradientTo, 0.5)) < 3) {
    issues.push({
      code: "GRADIENT_CTA_CONTRAST",
      message: "CTA gradient may be too light for white text",
      severity: "soft",
    });
  }

  const hard = issues.filter((i) => i.severity === "hard");
  return { passed: hard.length === 0, issues };
}

export function buildThemeTokens(theme: SiteTheme): ThemeTokens {
  const t = fillThemeDefaults(theme);
  const c = t.colors;
  const layout = t.layout!;
  const navEffective = effectiveNavBg(c.navBg, c.bg);
  const navIsDark = luminance(navEffective) < 0.5;
  const fallbackNavText = navIsDark ? "#fafafa" : "#0f172a";
  const navText = c.navText ?? fallbackNavText;
  const navMuted = c.navMuted ?? mix(navText, navEffective, 0.4);
  const navActiveBg = c.navActiveBg ?? mix(c.accent, navEffective, 0.25);
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
