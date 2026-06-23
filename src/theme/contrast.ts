import type { SiteTheme } from "../types.js";

type Rgb = { r: number; g: number; b: number };

function parseColor(input: string): Rgb | null {
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

function luminance({ r, g, b }: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return 4.5;
  const la = luminance(ca);
  const lb = luminance(cb);
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
  const bgLum = luminance(parseColor(bg) ?? { r: 255, g: 255, b: 255 });
  let candidate = fg;
  for (let i = 0; i < 12; i++) {
    candidate = bgLum > 0.5 ? darken(candidate, 0.08) : lighten(candidate, 0.08);
    if (contrast(candidate, bg) >= min) return candidate;
  }
  return bgLum > 0.5 ? "#0f172a" : "#f8fafc";
}

function isNear(a: string, b: string, threshold = 1.15): boolean {
  return contrast(a, b) < threshold;
}

/** Deterministic contrast-safe palette — never rely on LLM for card/text pairs. */
export function normalizeTheme(theme: SiteTheme): SiteTheme {
  const c = { ...theme.colors };
  const bgLum = luminance(parseColor(c.bg) ?? { r: 248, g: 250, b: 252 });
  const isDark = bgLum < 0.35;

  if (isDark) {
    if (isNear(c.bg, c.surface)) c.surface = lighten(c.bg, 0.12);
    c.text = ensureContrast(c.text, c.surface, 7);
    c.muted = ensureContrast(mix(c.text, c.surface, 0.45), c.surface, 4.5);
    c.accentSoft = mix(c.accent, c.surface, 0.18);
    c.navBg = c.navBg.startsWith("rgba") ? c.navBg : mix(c.bg, "#000000", 0.15);
  } else {
    if (isNear(c.bg, c.surface)) c.surface = "#ffffff";
    c.text = ensureContrast(c.text, c.surface, 7);
    c.muted = ensureContrast(mix(c.text, c.surface, 0.55), c.surface, 4.5);
    c.accentSoft = mix(c.accent, c.surface, 0.12);
    if (!c.navBg.includes("rgba")) c.navBg = mix(c.surface, c.bg, 0.5);
  }

  c.accent = ensureContrast(c.accent, c.surface, 3);
  c.gradientFrom = c.gradientFrom || c.accent;
  c.gradientTo = c.gradientTo || lighten(c.accent, 0.2);

  return { ...theme, colors: c };
}

export { contrast, parseColor };
