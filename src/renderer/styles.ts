import type { SiteTheme } from "../types.js";
import { buildThemeTokens } from "../theme/contrast.js";
import { resolveMotionPreset, motionPresetCss } from "../motion/presets.js";

/** Structural CSS shell — all visual values come from the AI theme tokens. */
export function buildStyles(theme: SiteTheme): string {
  const t = buildThemeTokens(theme);
  const motionPreset = resolveMotionPreset(theme.motionPreset, theme.motionStyle);
  const fonts = encodeURIComponent(theme.fontHeading).replace(/%20/g, "+");
  const fontsBody = encodeURIComponent(theme.fontBody).replace(/%20/g, "+");

  return `
@import url('https://fonts.googleapis.com/css2?family=${fonts}:wght@500;600;700;800&family=${fontsBody}:wght@400;500;600&display=swap');

:root {
  --color-bg: ${t.bg};
  --color-surface: ${t.surface};
  --color-text: ${t.text};
  --color-muted: ${t.muted};
  --color-accent: ${t.accent};
  --color-accent-soft: ${t.accentSoft};
  --color-border: color-mix(in srgb, ${t.text} 12%, transparent);
  --nav-bg: ${t.navBg};
  --nav-text: ${t.navText};
  --nav-muted: ${t.navMuted};
  --nav-active-bg: ${t.navActiveBg};
  --nav-active-text: ${t.navActiveText};
  --gradient-from: ${t.gradientFrom};
  --gradient-to: ${t.gradientTo};
  --font-heading: '${theme.fontHeading}', Georgia, serif;
  --font-body: '${theme.fontBody}', system-ui, sans-serif;
  --max-width: ${t.maxWidth};
  --section-gap: ${t.sectionGap};
  --card-min-height: ${t.cardMinHeight};
  --grid-columns: ${t.gridColumns};
  --radius: 16px;
  --shadow: 0 8px 28px color-mix(in srgb, ${t.text} 8%, transparent);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

*, *::before, *::after { box-sizing: border-box; }
html {
  scroll-behavior: smooth;
  scroll-padding-top: 4.5rem;
}
body {
  margin: 0;
  font-family: var(--font-body);
  background: var(--color-bg);
  color: var(--color-text);
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

.site-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.85rem clamp(1rem, 4vw, 2rem);
  background: var(--nav-bg);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.site-nav .brand {
  font-family: var(--font-heading);
  font-weight: 700;
  margin-right: auto;
  color: var(--nav-text);
}
.site-nav a {
  color: var(--nav-muted);
  text-decoration: none;
  font-size: 0.875rem;
  padding: 0.35rem 0.65rem;
  border-radius: 8px;
  transition: color 0.2s, background 0.2s;
}
.site-nav a:hover { color: var(--nav-text); }
.site-nav a.active {
  color: var(--nav-active-text);
  background: var(--nav-active-bg);
  font-weight: 600;
}

.site-main {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
  padding-bottom: var(--section-gap);
}
.layout-section--contained,
.site-main > .layout-stack,
.site-main > .layout-grid,
.site-main > .layout-row {
  width: 100%;
  max-width: var(--max-width);
  margin-inline: auto;
  padding-inline: clamp(1rem, 4vw, 2rem);
}
.layout-section--bleed { width: 100%; }

.layout-stack { display: flex; flex-direction: column; gap: var(--section-gap); width: 100%; }
.layout-row,
.layout-grid {
  display: grid;
  gap: 1.5rem;
  width: 100%;
  align-items: stretch;
  grid-template-columns: repeat(var(--grid-columns, 3), minmax(var(--grid-min, 240px), 1fr));
}
.layout-row[data-cols="1"], .layout-grid[data-cols="1"] { grid-template-columns: 1fr; }
.layout-row[data-cols="2"], .layout-grid[data-cols="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.layout-row[data-cols="3"], .layout-grid[data-cols="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.layout-row[data-cols="4"], .layout-grid[data-cols="4"] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.layout-row[data-cols="5"], .layout-grid[data-cols="5"] { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.layout-row[data-cols="6"], .layout-grid[data-cols="6"] { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.layout-grid > .reveal,
.layout-row > .reveal { display: flex; min-width: 0; align-items: stretch; }
.layout-grid > .reveal > .block,
.layout-row > .reveal > .block,
.layout-grid > .reveal > header,
.layout-row > .reveal > header {
  width: 100%;
  min-height: var(--card-min-height);
}

.layout-bento {
  display: grid;
  gap: 1rem;
  width: 100%;
  grid-template-columns: repeat(var(--bento-columns, 4), minmax(0, 1fr));
  grid-auto-rows: minmax(140px, auto);
  align-items: stretch;
}
.layout-bento > .reveal { display: flex; min-width: 0; }
.block-bento { padding: 0; overflow: hidden; display: flex; flex-direction: column; min-height: 140px; }
.block-bento img { width: 100%; height: 100%; object-fit: cover; flex: 1; min-height: 120px; }
.block-bento .bento-body { padding: 1rem 1.25rem; }
.block-bento--wide { grid-column: span 2; }
.block-bento--tall { grid-row: span 2; }
.block-bento--large { grid-column: span 2; grid-row: span 2; }

${motionPresetCss(motionPreset)}

.block {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: clamp(1.25rem, 3vw, 2rem);
  box-shadow: var(--shadow);
  min-width: 0;
  overflow-wrap: anywhere;
}

.block-hero {
  border: none;
  padding: 0;
  min-height: clamp(320px, 50vh, 520px);
  display: flex;
  align-items: flex-end;
  background-size: cover;
  background-position: center;
  border-radius: 0;
  box-shadow: none;
  position: relative;
  width: 100%;
}
.block-hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, color-mix(in srgb, var(--color-bg) 85%, black), transparent 60%);
}
.block-hero .hero-content {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: var(--max-width);
  margin-inline: auto;
  padding: clamp(2rem, 6vw, 4rem) clamp(1rem, 4vw, 2rem);
  color: #fff;
}
.block-hero h1 {
  margin: 0;
  font-family: var(--font-heading);
  font-size: clamp(2rem, 5vw, 3.5rem);
  line-height: 1.1;
}

.block-split-hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  padding: 0;
  border: none;
  box-shadow: none;
  min-height: clamp(320px, 45vh, 480px);
  overflow: hidden;
}
.block-split-hero .split-hero-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: clamp(2rem, 5vw, 3.5rem);
  background: var(--color-surface);
}
.block-split-hero .split-hero-text h1 {
  margin: 0;
  font-family: var(--font-heading);
  font-size: clamp(1.75rem, 4vw, 2.75rem);
}
.block-split-hero .split-hero-text p { color: var(--color-muted); }
.block-split-hero .split-hero-media { min-height: 240px; }
.block-split-hero .split-hero-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.block-pricing { text-align: center; }
.block-pricing--featured {
  border-color: var(--color-accent);
  box-shadow: 0 12px 40px color-mix(in srgb, var(--color-accent) 25%, transparent);
  transform: translateY(-4px);
}
.block-pricing .price { margin: 0.75rem 0; }
.block-pricing .amount {
  font-family: var(--font-heading);
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 800;
  color: var(--color-accent);
}
.block-pricing .period { color: var(--color-muted); font-size: 0.9rem; }
.block-pricing .feature-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0;
  text-align: left;
  color: var(--color-muted);
}
.block-pricing .feature-list li { padding: 0.35rem 0; border-bottom: 1px solid var(--color-border); }
.block-pricing .btn-pricing {
  display: inline-block;
  margin-top: 0.5rem;
  background: var(--color-accent);
  color: #fff;
  padding: 0.55rem 1.25rem;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 600;
}

.block-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  padding: 1rem;
  background: var(--color-surface);
}
.block-logo img { max-height: 48px; max-width: 100%; object-fit: contain; filter: grayscale(100%); opacity: 0.85; }
.block-logo .logo-name {
  font-weight: 700;
  color: var(--color-muted);
  font-size: 0.9rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.section-headline {
  padding: var(--section-gap) 0 1rem;
  border: none;
  background: none;
  box-shadow: none;
  min-height: auto;
}
.section-headline h1,
.section-headline h2 {
  margin: 0;
  font-family: var(--font-heading);
  font-size: clamp(1.75rem, 4vw, 2.75rem);
}
.section-subtitle { margin-top: 0.75rem; color: var(--color-muted); max-width: 56ch; }

.block-stat { text-align: center; border-top: 3px solid var(--color-accent); }
.block-stat .value {
  font-family: var(--font-heading);
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 800;
  color: var(--color-accent);
}
.block-stat .label { color: var(--color-muted); font-size: 0.85rem; margin-top: 0.5rem; }

.block-feature h3,
.block-text h2,
.block-list h3,
.block-faq .faq-q,
.block-contact h2,
.block-form h2 {
  font-family: var(--font-heading);
  margin: 0 0 0.5rem;
}
.block-feature p,
.block-text p,
.block-faq .faq-a,
.block-contact p { color: var(--color-muted); margin: 0; }

.block-testimonial { border-left: 4px solid var(--color-accent); }
.block-testimonial blockquote { margin: 0; font-style: italic; }
.block-testimonial cite {
  display: block;
  margin-top: 0.75rem;
  color: var(--color-accent);
  font-style: normal;
  font-weight: 600;
  font-size: 0.875rem;
}

.block-image img,
.block-gallery img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  display: block;
}
.block-image, .block-gallery { padding: 0; overflow: hidden; }
.block-image .placeholder, .block-gallery .placeholder {
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  border: 1px dashed var(--color-border);
}

.block-cta {
  text-align: center;
  background: linear-gradient(135deg, var(--gradient-from), var(--gradient-to));
  color: #fff;
  border: none;
  box-shadow: none;
  padding: clamp(2rem, 8vw, 4rem) clamp(1rem, 4vw, 2rem);
}
.block-cta h2 { color: #fff; margin: 0 0 0.5rem; font-family: var(--font-heading); }
.block-cta p { color: #fff; opacity: 0.95; }
.block-cta .btn {
  display: inline-block;
  margin-top: 1rem;
  background: #fff;
  color: var(--color-accent);
  padding: 0.65rem 1.5rem;
  border-radius: 999px;
  font-weight: 700;
  text-decoration: none;
}

.feature-list {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
  color: var(--color-muted);
}
.feature-list li { margin: 0.35rem 0; }

.block-form .site-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 0.75rem;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.form-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
}
.block-form input,
.block-form select,
.block-form textarea {
  font: inherit;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
}
.btn-form {
  align-self: flex-start;
  margin-top: 0.25rem;
  background: var(--color-accent);
  color: #fff;
  border: none;
  padding: 0.65rem 1.5rem;
  border-radius: 999px;
  font-weight: 700;
  cursor: pointer;
}

.block-before-after .before-after-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.block-before-after { padding: 0; overflow: hidden; }
.block-before-after img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
}
.block-before-after figcaption {
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-muted);
  text-align: center;
}
.block-before-after .caption {
  padding: 0.75rem 1.25rem;
  color: var(--color-muted);
  margin: 0;
}

.site-footer {
  text-align: center;
  padding: 2rem;
  color: var(--color-muted);
  font-size: 0.85rem;
  border-top: 1px solid var(--color-border);
}

@media (max-width: 768px) {
  .layout-row, .layout-grid, .layout-bento { grid-template-columns: 1fr; }
  .layout-row[data-cols="2"], .layout-grid[data-cols="2"] { grid-template-columns: 1fr; }
  .block-bento--wide, .block-bento--tall, .block-bento--large { grid-column: span 1; grid-row: span 1; }
  .block-split-hero { grid-template-columns: 1fr; }
}
`;
}

export const BASE_STYLES = buildStyles({
  vertical: "default",
  mood: "default",
  fontHeading: "Inter",
  fontBody: "Inter",
  motionStyle: "subtle",
  layout: { maxWidth: "1200px", gridColumns: 3, sectionGap: "3rem", cardMinHeight: "200px" },
  colors: {
    bg: "#f8fafc",
    surface: "#ffffff",
    text: "#0f172a",
    muted: "#64748b",
    accent: "#6366f1",
    accentSoft: "#eef2ff",
    gradientFrom: "#4f46e5",
    gradientTo: "#818cf8",
    navBg: "rgba(255,255,255,0.95)",
    navText: "#0f172a",
    navMuted: "#64748b",
    navActiveBg: "#eef2ff",
    navActiveText: "#4f46e5",
  },
});
