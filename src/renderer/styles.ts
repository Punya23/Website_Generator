import type { SiteTheme } from "../types.js";

export function buildStyles(theme: SiteTheme): string {
  const c = theme.colors;
  const fonts = encodeURIComponent(theme.fontHeading).replace(/%20/g, "+");
  const fontsBody = encodeURIComponent(theme.fontBody).replace(/%20/g, "+");

  return `
@import url('https://fonts.googleapis.com/css2?family=${fonts}:wght@500;600;700;800&family=${fontsBody}:wght@400;500;600&display=swap');

:root {
  --color-bg: ${c.bg};
  --color-surface: ${c.surface};
  --color-text: ${c.text};
  --color-muted: ${c.muted};
  --color-accent: ${c.accent};
  --color-accent-soft: ${c.accentSoft};
  --color-border: color-mix(in srgb, ${c.text} 10%, transparent);
  --color-on-surface: ${c.text};
  --color-on-muted: ${c.muted};
  --gradient-from: ${c.gradientFrom};
  --gradient-to: ${c.gradientTo};
  --nav-bg: ${c.navBg};
  --font-heading: '${theme.fontHeading}', Georgia, serif;
  --font-body: '${theme.fontBody}', system-ui, sans-serif;
  --space-xs: 0.5rem;
  --space-sm: 0.75rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  --space-2xl: 3rem;
  --space-3xl: 5rem;
  --radius: 20px;
  --radius-sm: 12px;
  --shadow: 0 8px 30px color-mix(in srgb, ${c.text} 6%, transparent);
  --shadow-lg: 0 24px 60px color-mix(in srgb, ${c.text} 10%, transparent);
  --max-width: 1200px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}

*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  font-family: var(--font-body);
  background: var(--color-bg);
  color: var(--color-on-surface);
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

/* ── Nav ── */
.site-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md) clamp(var(--space-md), 4vw, var(--space-xl));
  background: var(--nav-bg);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 100;
  transition: box-shadow 0.4s var(--ease-out);
}
.site-nav.scrolled { box-shadow: var(--shadow); }
.site-nav a {
  color: var(--color-text);
  text-decoration: none;
  font-weight: 500;
  font-size: clamp(0.8rem, 2vw, 0.9rem);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  transition: background 0.25s, color 0.25s, transform 0.25s var(--ease-spring);
}
.site-nav a:hover { transform: translateY(-2px); }
.site-nav a:hover, .site-nav a.active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.site-nav .brand {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: clamp(1rem, 3vw, 1.2rem);
  margin-right: auto;
  letter-spacing: -0.03em;
}

/* ── Layout shell ── */
.page-wrapper,
.layout-section--contained {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 clamp(var(--space-md), 4vw, var(--space-xl));
  width: 100%;
}
.site-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xl);
  padding-bottom: var(--space-3xl);
}
.layout-section--bleed { width: 100%; padding: 0; }
.layout-section--contained .layout-stack { gap: var(--space-xl); }
.layout-section--bleed + .layout-section--contained,
.layout-section--contained + .layout-section--bleed { margin-top: var(--space-sm); }

/* ── Layout primitives ── */
.layout-stack { display: flex; flex-direction: column; gap: var(--space-xl); width: 100%; }
.layout-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--space-lg);
  width: 100%;
  align-items: stretch;
}
.layout-row > .reveal,
.layout-row > .block,
.layout-row > .block-hero,
.layout-row > header.section-headline,
.layout-row > .block-cta {
  flex: 1 1 min(100%, 300px);
  min-width: 0;
}
.layout-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--grid-min, 260px)), 1fr));
  gap: var(--space-lg);
  width: 100%;
  align-items: stretch;
}

/* ── Motion (Framer-style) ── */
.reveal {
  opacity: 0;
  transform: translateY(32px) scale(0.98);
  transition:
    opacity 0.8s var(--ease-out),
    transform 0.8s var(--ease-out);
  will-change: opacity, transform;
}
.reveal.visible {
  opacity: 1;
  transform: translateY(0) scale(1);
}
[data-motion="bold"] .reveal {
  transform: translateY(40px) scale(0.95);
  transition-duration: 0.65s;
  transition-timing-function: var(--ease-spring);
}

/* ── Cards — always surface + readable text (no accentSoft backgrounds) ── */
.block {
  background: var(--color-surface);
  color: var(--color-on-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: clamp(var(--space-lg), 3vw, var(--space-xl));
  box-shadow: var(--shadow);
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
  transition: transform 0.4s var(--ease-out), box-shadow 0.4s var(--ease-out);
}
.block:hover:not(.block-hero) {
  transform: translateY(-6px);
  box-shadow: var(--shadow-lg);
}

/* ── Hero (never a card) ── */
.block-hero {
  border: none;
  padding: 0;
  overflow: hidden;
  min-height: clamp(360px, 55vh, 560px);
  display: flex;
  align-items: flex-end;
  border-radius: 0;
  box-shadow: none;
  background-size: cover;
  background-position: center;
  position: relative;
  width: 100%;
}
.block-hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, color-mix(in srgb, var(--color-bg) 92%, black) 0%, transparent 55%);
  pointer-events: none;
}
.block-hero .hero-content {
  position: relative;
  z-index: 1;
  padding: clamp(var(--space-2xl), 6vw, var(--space-3xl)) clamp(var(--space-lg), 5vw, var(--space-2xl));
  color: #fff;
  max-width: 760px;
  width: 100%;
}
.block-hero h1 {
  margin: 0;
  font-family: var(--font-heading);
  font-size: clamp(2.25rem, 6vw, 3.75rem);
  line-height: 1.05;
  letter-spacing: -0.04em;
  text-shadow: 0 4px 30px rgba(0,0,0,0.35);
}
.block-hero p {
  margin: var(--space-md) 0 0;
  font-size: clamp(1rem, 2.5vw, 1.2rem);
  opacity: 0.95;
  line-height: 1.5;
  max-width: 48ch;
}

/* ── Page headlines (never a card) ── */
.section-headline {
  padding: var(--space-2xl) 0 var(--space-md);
  border: none;
  background: none;
  box-shadow: none;
}
.section-headline h1 {
  margin: 0;
  font-family: var(--font-heading);
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 1.1;
  letter-spacing: -0.03em;
  color: var(--color-text);
}
.section-subtitle {
  margin: var(--space-md) 0 0;
  color: var(--color-muted);
  font-size: clamp(1rem, 2.5vw, 1.15rem);
  max-width: 56ch;
  line-height: 1.6;
}

/* ── Stats band ── */
.block-stat {
  text-align: center;
  padding: var(--space-xl);
  background: var(--color-surface);
  border-top: 3px solid var(--color-accent);
}
.layout-row .block-stat { border-top: none; border-left: 3px solid var(--color-accent); }
.block-stat .value {
  font-family: var(--font-heading);
  font-size: clamp(2rem, 4vw, 2.75rem);
  font-weight: 800;
  color: var(--color-accent);
  line-height: 1;
}
.block-stat .label {
  color: var(--color-muted);
  font-size: 0.8rem;
  margin-top: var(--space-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

/* ── Features ── */
.block-feature {
  position: relative;
  padding-top: calc(var(--space-xl) + 8px);
}
.block-feature::before {
  content: '';
  position: absolute;
  top: var(--space-lg);
  left: clamp(var(--space-lg), 3vw, var(--space-xl));
  width: 48px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-accent);
}
.block-feature h3 {
  margin: 0 0 var(--space-sm);
  font-family: var(--font-heading);
  font-size: clamp(1.05rem, 2.5vw, 1.2rem);
  color: var(--color-text);
}
.block-feature p { margin: 0; color: var(--color-muted); font-size: 0.95rem; line-height: 1.65; }

/* ── Testimonials ── */
.block-testimonial { border-left: 4px solid var(--color-accent); }
.block-testimonial blockquote {
  margin: 0;
  font-size: clamp(1rem, 2.5vw, 1.08rem);
  font-style: italic;
  line-height: 1.65;
  color: var(--color-text);
}
.block-testimonial cite {
  display: block;
  margin-top: var(--space-md);
  color: var(--color-accent);
  font-weight: 600;
  font-style: normal;
  font-size: 0.875rem;
}

/* ── Images & gallery (fixed aspect ratios) ── */
.block-image, .block-gallery {
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.block-image img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  display: block;
  transition: transform 0.7s var(--ease-out);
}
.block-gallery img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
  transition: transform 0.7s var(--ease-out);
}
.block-image:hover img, .block-gallery:hover img { transform: scale(1.06); }
.block-image .placeholder, .block-gallery .placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  background: var(--color-surface);
  color: var(--color-muted);
  border: 1px dashed var(--color-border);
}
.block-gallery .caption {
  padding: var(--space-md) var(--space-lg);
  font-size: 0.875rem;
  color: var(--color-muted);
  font-weight: 500;
  background: var(--color-surface);
}

/* ── Text & FAQ ── */
.block-text h2 {
  margin: 0 0 var(--space-sm);
  font-family: var(--font-heading);
  font-size: clamp(1.2rem, 3vw, 1.45rem);
  color: var(--color-text);
}
.block-text .prose, .block-text p {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.75;
  font-size: 1rem;
}
.block-faq .faq-q {
  margin: 0 0 var(--space-sm);
  font-family: var(--font-heading);
  font-size: 1.1rem;
  color: var(--color-text);
}
.block-faq .faq-a { margin: 0; color: var(--color-muted); line-height: 1.65; }

/* ── Contact ── */
.block-contact {
  background: var(--color-surface);
  border-left: 4px solid var(--color-accent);
}
.block-contact h2 {
  font-family: var(--font-heading);
  margin: 0 0 var(--space-md);
  color: var(--color-text);
}
.block-contact p { margin: var(--space-xs) 0; color: var(--color-muted); }

/* ── CTA band ── */
.block-cta {
  text-align: center;
  background: linear-gradient(135deg, var(--gradient-from), var(--gradient-to));
  color: #fff;
  padding: clamp(var(--space-2xl), 8vw, var(--space-3xl)) clamp(var(--space-lg), 4vw, var(--space-xl));
  border: none;
  box-shadow: none;
}
.block-cta .cta-inner { max-width: 640px; margin: 0 auto; }
.block-cta h2 {
  margin: 0 0 var(--space-sm);
  font-family: var(--font-heading);
  font-size: clamp(1.5rem, 4vw, 2.25rem);
  color: #fff;
}
.block-cta p { margin: 0 0 var(--space-lg); opacity: 0.95; color: #fff; }
.block-cta .btn {
  display: inline-block;
  background: #fff;
  color: var(--color-accent);
  padding: var(--space-sm) var(--space-xl);
  border-radius: 999px;
  font-weight: 700;
  text-decoration: none;
  transition: transform 0.3s var(--ease-spring), box-shadow 0.3s;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
}
.block-cta .btn:hover {
  transform: scale(1.06);
  box-shadow: 0 10px 30px rgba(0,0,0,0.25);
}

/* ── Vertical accents ── */
[data-vertical="fitness"] .block-stat .value { font-size: clamp(2.25rem, 5vw, 3rem); }
[data-vertical="fitness"] .layout-section--bleed .block-gallery img { aspect-ratio: 3 / 2; }
[data-archetype="energy-bento"] .layout-grid { gap: var(--space-md); }

.site-footer {
  text-align: center;
  padding: var(--space-xl);
  color: var(--color-muted);
  font-size: 0.85rem;
  border-top: 1px solid var(--color-border);
  margin-top: var(--space-xl);
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .site-main { gap: var(--space-xl); }
  .layout-row { flex-direction: column; }
  .layout-row > .reveal,
  .layout-row > .block { flex: 1 1 100%; }
  .layout-grid { gap: var(--space-md); }
  .block-hero { min-height: 320px; }
  .layout-row .block-stat { border-left: none; border-top: 3px solid var(--color-accent); }
}

@media (max-width: 480px) {
  .site-nav { justify-content: center; }
  .site-nav .brand { flex: 1 0 100%; text-align: center; margin-right: 0; margin-bottom: var(--space-xs); }
  .block { padding: var(--space-lg); }
}
`;
}

export const BASE_STYLES = buildStyles({
  vertical: "default",
  mood: "default",
  fontHeading: "Inter",
  fontBody: "Inter",
  colors: {
    bg: "#f8fafc",
    surface: "#ffffff",
    text: "#0f172a",
    muted: "#64748b",
    accent: "#6366f1",
    accentSoft: "#eef2ff",
    gradientFrom: "#4f46e5",
    gradientTo: "#818cf8",
    navBg: "rgba(255,255,255,0.92)",
  },
});