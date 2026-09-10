/**
 * Frozen skins → complete HTML files (index.html, about.html, …).
 * Each section template is rendered as itself. Look comes from the skin token pack.
 */
import type { ReactPage, SectionInstance, SiteContext, SiteTheme } from "../types.js";
import type { SiteSkin } from "./schema.js";
import { SKIN_PAGE_TITLES } from "./schema.js";

export function pageFileName(slug: string): string {
  return slug === "home" ? "index.html" : `${slug}.html`;
}

export function pageHref(href: string | undefined, fallback = "contact.html"): string {
  if (!href || href === "#" || href === "/") return "index.html";
  if (/^https?:/i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:")) return href;
  const slug = href.replace(/^\//, "").split("/")[0] || "home";
  if (!slug || slug === "home") return "index.html";
  return `${slug}.html`;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function img(value: unknown): { src: string; alt: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const nested = row.image && typeof row.image === "object" ? (row.image as Record<string, unknown>) : row;
  const src = text(nested.src);
  if (!src) return null;
  return { src, alt: text(nested.alt) || "Photograph" };
}

function cta(value: unknown): { label: string; href: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const label = text(row.label);
  if (!label) return null;
  return { label, href: pageHref(text(row.href) || undefined) };
}

function arr(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
}

function stringList(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value];
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => (typeof row === "string" ? row : text((row as Record<string, unknown>)?.text)))
    .filter(Boolean);
}

function googleFontsHref(theme: SiteTheme): string {
  const families = [theme.fontHeading, theme.fontBody]
    .filter(Boolean)
    .map((name) => `family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;500;600;700`);
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

function skinCss(theme: SiteTheme, skin: SiteSkin): string {
  const c = theme.colors;
  const dark = theme.pageTone === "dark";
  const gap =
    theme.sectionGapMode === "airy" ? "7rem" : theme.sectionGapMode === "tight" ? "3.25rem" : "5rem";
  const nav = skin.chrome.navShape;
  const capsule = nav === "floating-capsule";
  const panel = nav === "floating-panel";
  const split = nav === "split-inline";
  const radius = capsule ? "999px" : panel ? "1.35rem" : dark ? "2px" : "1.1rem";
  const displaySize =
    skin.visualFamily === "editorial-light" || skin.visualFamily === "luxury-dark"
      ? "clamp(3.2rem, 9vw, 7.2rem)"
      : skin.visualFamily === "clinical-light"
        ? "clamp(2.4rem, 6vw, 4.8rem)"
        : "clamp(2.8rem, 7.5vw, 6rem)";
  const tracking =
    skin.visualFamily === "luxury-dark" || skin.visualFamily === "editorial-light" ? "-0.055em" : "-0.03em";
  return `
:root {
  --bg: ${c.bg};
  --surface: ${c.surface};
  --text: ${c.text};
  --muted: ${c.muted};
  --accent: ${c.accent};
  --accent-soft: ${c.accentSoft};
  --nav: ${c.navBg};
  --nav-text: ${c.navText ?? c.text};
  --border: color-mix(in srgb, var(--text) 12%, transparent);
  --max: ${theme.layout?.maxWidth ?? "1120px"};
  --gap: ${gap};
  --font-display: "${theme.fontHeading}", Georgia, serif;
  --font-body: "${theme.fontBody}", system-ui, sans-serif;
  --radius: ${radius};
  --shadow: 0 1px 2px color-mix(in srgb, var(--text) 6%, transparent), 0 16px 40px -18px color-mix(in srgb, var(--text) 22%, transparent);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  line-height: 1.6;
}
img, video { max-width: 100%; display: block; }
a { color: inherit; }
.wrap { width: min(var(--max), calc(100% - 10vw)); margin: 0 auto; }
.reveal { opacity: 0; transform: translateY(16px); animation: rise 0.75s cubic-bezier(.16,1,.3,1) forwards; }
@keyframes rise { to { opacity: 1; transform: none; } }
.site-nav {
  position: sticky; top: 0; z-index: 40;
  color: var(--nav-text);
}
.nav-surface {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  background: color-mix(in srgb, var(--nav) 92%, transparent);
  backdrop-filter: blur(16px);
}
.site-nav[data-nav-shape="full-width"] .nav-surface {
  padding: 1.05rem 6vw;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
}
.site-nav[data-nav-shape="floating-capsule"] .nav-surface,
.site-nav[data-nav-shape="floating-panel"] .nav-surface {
  margin: 0.85rem auto; width: min(960px, calc(100% - 1.6rem));
  padding: 0.75rem 1.2rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.site-nav[data-nav-shape="split-inline"] {
  display: flex; justify-content: space-between; gap: 0.75rem;
  padding: 0.85rem 4vw 0;
}
.site-nav[data-nav-shape="split-inline"] .nav-surface {
  padding: 0.7rem 1.1rem;
  border-radius: 999px;
  border: 1px solid var(--border);
}
.site-nav a { text-decoration: none; }
.brand { font-family: var(--font-display); font-weight: 700; letter-spacing: ${tracking}; font-size: 1.15rem; }
.nav-links { display: flex; flex-wrap: wrap; gap: 0.35rem 1.15rem; font-size: 0.92rem; }
.nav-links a.is-active { color: var(--accent); }
.kicker {
  margin: 0 0 1rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.72rem;
  color: var(--accent);
}
h1, h2, .display {
  font-family: var(--font-display);
  letter-spacing: ${tracking};
  line-height: 0.96;
  margin: 0 0 1rem;
  font-weight: 600;
}
h1 { font-size: ${displaySize}; max-width: 16ch; }
h2 { font-size: clamp(1.7rem, 4vw, 3.1rem); max-width: 18ch; }
h3 { font-family: var(--font-display); margin: 0 0 0.4rem; font-size: 1.35rem; }
.lede { font-size: 1.15rem; color: var(--muted); max-width: 42ch; }
.btn {
  display: inline-flex; align-items: center;
  margin-top: 1.5rem; padding: 0.9rem 1.3rem;
  background: var(--accent); color: ${dark ? c.bg : "#fff"};
  text-decoration: none; font-weight: 600; border: 0; border-radius: var(--radius); cursor: pointer; font: inherit;
}
.btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }
.sec { padding: var(--gap) 0; }
.sec[data-mode="bleed"] { padding: 0; }
.media img, .media video { width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius); box-shadow: var(--shadow); }
.media.portrait { aspect-ratio: 4/5; max-height: min(72vh, 640px); }
.media.wide { aspect-ratio: 16/9; max-height: min(50vh, 480px); }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 3.2rem; align-items: center; }
.split.media-left { direction: rtl; }
.split.media-left > * { direction: ltr; }
.split.offset .media { transform: translateY(1.5rem); }
.t-hero_statement {
  min-height: 78vh;
  display: flex;
  align-items: center;
  background: var(--bg);
}
.t-hero_statement.is-center { text-align: center; }
.t-hero_statement.is-center h1, .t-hero_statement.is-center .lede { margin-left: auto; margin-right: auto; }
.t-hero_video, .t-hero_metro {
  position: relative;
  min-height: 86vh;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
  color: #f7f4ef;
}
.t-hero_video .hero-media, .t-hero_metro .hero-media { position: absolute; inset: 0; }
.t-hero_video .hero-media img, .t-hero_video .hero-media video,
.t-hero_metro .hero-media img { width: 100%; height: 100%; object-fit: cover; border-radius: 0; box-shadow: none; }
.t-hero_video .scrim, .t-hero_metro .scrim {
  position: absolute; inset: 0;
  background: linear-gradient(to top, color-mix(in srgb, var(--bg) 82%, transparent), transparent 55%);
}
.t-hero_video .wrap, .t-hero_metro .wrap { position: relative; z-index: 1; padding: 8rem 0 4.5rem; }
.t-hero_editorial, .t-hero_split_cinematic, .t-hero_spotlight { padding: var(--gap) 0; }
.t-offer_index .row {
  display: grid; grid-template-columns: 4.5rem 1fr 2fr; gap: 1rem; align-items: baseline;
  border-top: 1px solid var(--border); padding: 1.5rem 0;
}
.t-offer_index .num { font-variant-numeric: tabular-nums; color: var(--muted); letter-spacing: 0.08em; }
.t-feature_bento .cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1rem; }
.t-feature_bento .card { grid-column: span 2; background: var(--surface); padding: 1.3rem; border: 1px solid var(--border); border-radius: var(--radius); }
.t-feature_bento .card.wide { grid-column: span 3; }
.t-feature_bento .card.large { grid-column: span 4; min-height: 16rem; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.15rem; }
.card { background: var(--surface); padding: 1.25rem; border: 1px solid var(--border); border-radius: var(--radius); }
.quote { font-size: 1.55rem; font-family: var(--font-display); line-height: 1.25; }
blockquote.pull { border-left: 2px solid var(--accent); padding-left: 1.1rem; margin: 1.4rem 0 0; }
.gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.65rem; }
.gallery.masonry { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
.gallery.masonry .media:nth-child(3n) { aspect-ratio: 4/5; }
.gallery.horizontal { display: flex; gap: 0.8rem; overflow-x: auto; padding-bottom: 0.5rem; }
.gallery.horizontal .media { min-width: min(70vw, 280px); aspect-ratio: 4/5; }
.hours { display: grid; gap: 0.35rem; }
.hours div { display: flex; justify-content: space-between; gap: 1rem; border-bottom: 1px dashed var(--border); padding: 0.4rem 0; }
.t-contact_split .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2.8rem; }
form { display: grid; gap: 0.75rem; }
label { display: grid; gap: 0.35rem; font-size: 0.92rem; }
input, textarea, select {
  width: 100%; padding: 0.8rem 0.85rem; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font: inherit; border-radius: var(--radius);
}
.t-cta_band, .t-footer_cta, .t-newsletter_band {
  background: var(--accent);
  color: ${dark ? c.bg : "#fff"};
  padding: 4.5rem 0;
}
.t-cta_band.is-center, .t-footer_cta.is-center { text-align: center; }
.t-cta_band .lede, .t-footer_cta .lede { color: inherit; opacity: 0.88; }
.t-cta_band .btn, .t-footer_cta .btn { background: ${dark ? c.bg : "#fff"}; color: var(--accent); }
.t-cta_band.is-wide { padding: 6.5rem 0; }
.t-cta_band.is-compact { padding: 2.6rem 0; }
.t-stats_marquee, .t-stats_animated, .t-logo_marquee, .t-text_marquee {
  padding: 2.4rem 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.marquee { display: flex; gap: 2.5rem; overflow: hidden; font-family: var(--font-display); font-size: clamp(1.4rem, 3vw, 2.2rem); }
.site-footer { padding: 3.2rem 6vw; border-top: 1px solid var(--border); display: grid; gap: 0.7rem; }
.site-footer.two-column { grid-template-columns: 1.2fr 1fr; align-items: end; }
.site-footer.centered { text-align: center; justify-items: center; }
.site-footer.cta-heavy { background: var(--accent); color: ${dark ? c.bg : "#fff"}; }
body[data-grain="1"]::before {
  content: "";
  pointer-events: none;
  position: fixed; inset: 0; z-index: 50; opacity: 0.09;
  background-image: radial-gradient(var(--text) 0.6px, transparent 0.7px);
  background-size: 3px 3px;
}
@media (max-width: 860px) {
  .split, .t-contact_split .grid, .site-footer.two-column, .t-offer_index .row, .t-feature_bento .cards { grid-template-columns: 1fr; }
  .split.media-left { direction: ltr; }
  .t-feature_bento .card, .t-feature_bento .card.wide, .t-feature_bento .card.large { grid-column: span 1; }
  .t-hero_statement { min-height: 68vh; }
}
`.trim();
}

function mediaHtml(value: unknown, className = "media"): string {
  const picture = img(value);
  if (!picture) return "";
  return `<div class="${className}"><img src="${esc(picture.src)}" alt="${esc(picture.alt)}"></div>`;
}

function btn(value: unknown, className = "btn"): string {
  const link = cta(value);
  if (!link) return "";
  return `<a class="${className}" href="${esc(link.href)}">${esc(link.label)}</a>`;
}

function headingBlock(props: Record<string, unknown>, tag: "h1" | "h2"): string {
  const kicker = text(props.label);
  const headline = text(props.headline);
  const lede = text(props.subcopy) || text(props.body);
  return `${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ""}${
    headline ? `<${tag} class="display">${esc(headline)}</${tag}>` : ""
  }${lede ? `<p class="lede">${esc(lede)}</p>` : ""}`;
}

function shell(
  section: SectionInstance,
  inner: string,
  extraClass = "",
  mode = "contained"
): string {
  const variant = section.layoutSpec?.variant ?? "";
  return `<section class="sec reveal t-${esc(section.templateId)} ${extraClass}" data-template="${esc(
    section.templateId
  )}" data-layout="${esc(variant)}" data-mode="${esc(mode)}" id="${esc(section.id)}">${inner}</section>`;
}

function copyCol(props: Record<string, unknown>, tag: "h1" | "h2", extra = ""): string {
  return `<div>${headingBlock(props, tag)}${extra}${stringList(props.paragraphs)
    .map((row) => `<p>${esc(row)}</p>`)
    .join("")}${text(props.pullQuote) ? `<blockquote class="pull quote">${esc(text(props.pullQuote))}</blockquote>` : ""}${btn(
    props.cta
  )}</div>`;
}

function renderSection(section: SectionInstance): string {
  const p = (section.props ?? {}) as Record<string, unknown>;
  const template = section.templateId;
  const variant = text(section.layoutSpec?.variant || p.layoutVariant);
  const mediaLeft = section.layoutSpec?.mediaPosition === "left" || p.mediaPosition === "left";
  const centered = variant === "centered-stack" || variant === "default";

  if (template === "hero_statement" || template === "intro_statement") {
    const tag = template === "hero_statement" ? "h1" : "h2";
    const center = template === "hero_statement" && variant !== "full-bleed-left";
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, tag)}${btn(p.cta)}</div>`,
      center ? "is-center" : "",
      "bleed"
    );
  }

  if (template === "hero_video") {
    const video = p.video && typeof p.video === "object" ? (p.video as Record<string, unknown>) : null;
    const poster = img(video?.poster) ?? img(p.image);
    const src = text(video?.src);
    const media = src
      ? `<video autoplay muted loop playsinline poster="${esc(poster?.src ?? "")}"><source src="${esc(src)}"></video>`
      : poster
        ? `<img src="${esc(poster.src)}" alt="${esc(poster.alt)}">`
        : "";
    return shell(
      section,
      `<div class="hero-media">${media}</div><div class="scrim"></div><div class="wrap ${centered ? "is-center" : ""}">${headingBlock(p, "h1")}${btn(p.cta)}</div>`,
      centered ? "is-center" : "",
      "bleed"
    );
  }

  if (template === "hero_metro") {
    const frames = arr(p.images);
    const frame = img(frames[0]?.image ?? frames[0]) ?? img(p.image);
    return shell(
      section,
      `<div class="hero-media">${frame ? `<img src="${esc(frame.src)}" alt="${esc(frame.alt)}">` : ""}</div><div class="scrim"></div><div class="wrap is-center">${headingBlock(p, "h1")}${btn(p.cta)}</div>`,
      "is-center",
      "bleed"
    );
  }

  if (
    template === "hero_editorial" ||
    template === "hero_split_cinematic" ||
    template === "hero_spotlight"
  ) {
    if (variant === "centered-stack") {
      return shell(
        section,
        `<div class="wrap is-center">${headingBlock(p, "h1")}${btn(p.cta)}${mediaHtml(p.image, template === "hero_split_cinematic" ? "media wide" : "media portrait")}</div>`,
        "is-center"
      );
    }
    return shell(
      section,
      `<div class="wrap split ${mediaLeft ? "media-left" : ""} ${variant === "split-offset" ? "offset" : ""}">${mediaHtml(
        p.image,
        template === "hero_split_cinematic" ? "media wide" : "media portrait"
      )}${copyCol(p, "h1")}</div>`
    );
  }

  if (template === "story_split" || template === "services_showcase" || template === "scroll_showcase") {
    return shell(
      section,
      `<div class="wrap split ${mediaLeft ? "media-left" : ""}">${mediaHtml(p.image, "media portrait")}${copyCol(p, "h2")}</div>`
    );
  }

  if (template === "offer_index") {
    const items = arr(p.items).length ? arr(p.items) : arr(p.services);
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, "h2")}${items
        .map(
          (item, i) =>
            `<article class="row"><span class="num">${String(i + 1).padStart(2, "0")}</span><h3>${esc(
              text(item.title) || text(item.name)
            )}</h3><p>${esc(text(item.description) || text(item.body))}</p></article>`
        )
        .join("")}</div>`
    );
  }

  if (template === "feature_bento") {
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, "h2")}<div class="cards">${arr(p.items)
        .map((item) => {
          const span = text(item.span);
          return `<article class="card ${span}">${mediaHtml(item.image)}<h3>${esc(text(item.title))}</h3><p>${esc(
            text(item.description)
          )}</p></article>`;
        })
        .join("")}</div></div>`
    );
  }

  if (template === "menu_board") {
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, "h2")}<div class="hours">${arr(p.items)
        .map(
          (item) =>
            `<div><span>${esc(text(item.name) || text(item.title))}</span><strong>${esc(
              text(item.price) || text(item.description)
            )}</strong></div>`
        )
        .join("")}</div></div>`
    );
  }

  if (template === "hours_location") {
    return shell(
      section,
      `<div class="wrap split"><div>${headingBlock(p, "h2")}<p>${esc(text(p.address))}</p><p>${esc(text(p.phone))}</p></div><div class="hours">${arr(
        p.schedule
      )
        .map((row) => `<div><span>${esc(text(row.day))}</span><span>${esc(text(row.time))}</span></div>`)
        .join("")}</div></div>`
    );
  }

  if (template === "faq_accordion") {
    const items = arr(p.items).length ? arr(p.items) : arr(p.faqs);
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, "h2")}${items
        .map(
          (item) =>
            `<details class="card"><summary>${esc(text(item.question) || text(item.title))}</summary><p>${esc(
              text(item.answer) || text(item.description)
            )}</p></details>`
        )
        .join("")}</div>`
    );
  }

  if (template === "team_grid") {
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, "h2")}<div class="cards">${arr(p.members)
        .map(
          (m) =>
            `<article class="card">${mediaHtml(m.image, "media portrait")}<h3>${esc(text(m.name))}</h3><p>${esc(
              text(m.role)
            )}</p><p>${esc(text(m.bio))}</p></article>`
        )
        .join("")}</div></div>`
    );
  }

  if (template === "testimonial_featured" || template === "testimonial_carousel") {
    const items = arr(p.items);
    const featured = items.length ? items : [{ quote: p.quote, author: p.author, role: p.role }];
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, "h2")}${featured
        .map(
          (item) =>
            `<blockquote class="card"><p class="quote">${esc(text(item.quote))}</p><footer>${esc(text(item.author))} — ${esc(
              text(item.role)
            )}</footer></blockquote>`
        )
        .join("")}</div>`
    );
  }

  if (
    template === "gallery_masonry" ||
    template === "horizontal_gallery" ||
    template === "portfolio_strip" ||
    template === "portfolio_carousel"
  ) {
    const items = arr(p.images).length
      ? arr(p.images)
      : arr(p.items).length
        ? arr(p.items)
        : arr(p.projects).length
          ? arr(p.projects)
          : arr(p.slides);
    const galleryClass =
      template === "horizontal_gallery" ? "gallery horizontal" : template === "gallery_masonry" ? "gallery masonry" : "gallery";
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, "h2")}<div class="${galleryClass}">${items
        .map(
          (item) =>
            `${mediaHtml(item.image ?? item, "media")}${
              text(item.title) || text(item.caption) ? `<p>${esc(text(item.title) || text(item.caption))}</p>` : ""
            }`
        )
        .join("")}</div></div>`
    );
  }

  if (template === "before_after") {
    return shell(
      section,
      `<div class="wrap split"><div><p class="kicker">Before</p>${mediaHtml(p.before, "media portrait")}</div><div><p class="kicker">After</p>${mediaHtml(
        p.after,
        "media portrait"
      )}${headingBlock(p, "h2")}</div></div>`
    );
  }

  if (template === "cta_band" || template === "footer_cta" || template === "newsletter_band") {
    const extra =
      variant === "band-wide" ? "is-wide" : variant === "band-compact" ? "is-compact" : centered || !variant ? "is-center" : "";
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, "h2")}${btn(p.cta)}${btn(p.secondaryCta, "btn ghost")}</div>`,
      extra,
      "band"
    );
  }

  if (template === "contact_split") {
    const fields = arr(p.formFields);
    const action = text(p.formAction) || "#";
    const defaults = [
      { label: "Name", type: "text" },
      { label: "Email", type: "email" },
      { label: "Message", type: "textarea" },
    ];
    return shell(
      section,
      `<div class="wrap grid"><div>${headingBlock(p, "h2")}<p>${esc(text(p.email))}</p><p>${esc(text(p.phone))}</p><p>${esc(
        text(p.address)
      )}</p></div>
      <form action="${esc(action)}" method="POST">
        ${p.formAccessKey ? `<input type="hidden" name="access_key" value="${esc(text(p.formAccessKey))}">` : ""}
        ${p.formEmail ? `<input type="hidden" name="_to" value="${esc(text(p.formEmail))}">` : ""}
        ${(fields.length ? fields : defaults)
          .map((field) => {
            const name = text(field.label).toLowerCase().replace(/\s+/g, "_") || "field";
            const type = text(field.type) || "text";
            return type === "textarea"
              ? `<label>${esc(text(field.label))}<textarea name="${esc(name)}" rows="5"></textarea></label>`
              : `<label>${esc(text(field.label))}<input name="${esc(name)}" type="${esc(type)}"></label>`;
          })
          .join("")}
        <button class="btn" type="submit">${esc(text(p.submitLabel) || "Send")}</button>
      </form></div>`
    );
  }

  if (template === "quote_calculator") {
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, "h2")}<div class="cards">${arr(p.packages)
        .map(
          (row) =>
            `<article class="card"><h3>${esc(text(row.name) || text(row.title))}</h3><p>${esc(
              text(row.pricePerUnit) || text(row.price)
            )}</p></article>`
        )
        .join("")}</div>${btn(p.cta)}</div>`
    );
  }

  if (template === "pricing_tiers" || template === "pricing_toggle") {
    return shell(
      section,
      `<div class="wrap">${headingBlock(p, "h2")}<div class="cards">${arr(p.tiers)
        .map(
          (tier) =>
            `<article class="card"><h3>${esc(text(tier.name))}</h3><p>${esc(
              text(tier.price) || text(tier.monthlyPrice)
            )}</p><p>${esc((Array.isArray(tier.features) ? tier.features : []).join(" · "))}</p>${btn(tier.cta)}</article>`
        )
        .join("")}</div></div>`
    );
  }

  if (template === "stats_animated" || template === "stats_marquee") {
    return shell(
      section,
      `<div class="wrap cards">${arr(p.stats)
        .map((stat) => `<article class="card"><h2>${esc(text(stat.value))}</h2><p>${esc(text(stat.label))}</p></article>`)
        .join("")}</div>`,
      "",
      "band"
    );
  }

  if (template === "logo_marquee" || template === "text_marquee") {
    const logos = arr(p.logos).length ? arr(p.logos) : arr(p.items);
    const words = Array.isArray(p.phrases)
      ? p.phrases.map(String)
      : logos.map((row) => text(row.name) || text(row.title)).filter(Boolean);
    return shell(section, `<div class="wrap marquee"><p>${esc(words.join(" · "))}</p></div>`, "", "band");
  }

  return shell(section, `<div class="wrap">${headingBlock(p, "h2")}${btn(p.cta)}</div>`);
}

function navHtml(ctx: SiteContext, skin: SiteSkin, activeSlug: string): string {
  const shape = skin.chrome.navShape;
  const links = Object.keys(skin.pages)
    .map((slug) => {
      const meta = SKIN_PAGE_TITLES[slug];
      return `<a href="${pageFileName(slug)}" class="${slug === activeSlug ? "is-active" : ""}">${esc(
        meta?.navLabel ?? slug
      )}</a>`;
    })
    .join("");
  const brand = `<a class="brand" href="index.html">${esc(ctx.businessName)}</a>`;
  if (shape === "split-inline") {
    return `<header class="site-nav" data-nav-shape="${esc(shape)}"><div class="nav-surface">${brand}</div><div class="nav-surface"><nav class="nav-links">${links}</nav></div></header>`;
  }
  return `<header class="site-nav" data-nav-shape="${esc(shape)}"><div class="nav-surface">${brand}<nav class="nav-links">${links}</nav></div></header>`;
}

function footerHtml(ctx: SiteContext, skin: SiteSkin): string {
  const layout = skin.chrome.footerLayout;
  const links = Object.keys(skin.pages)
    .map((slug) => `<a href="${pageFileName(slug)}">${esc(SKIN_PAGE_TITLES[slug]?.navLabel ?? slug)}</a>`)
    .join(" · ");
  return `<footer class="site-footer ${esc(layout)}"><div><strong>${esc(ctx.businessName)}</strong><p>${esc(
    ctx.expandedBrief.tagline
  )}</p></div><div>${links}<p>© ${new Date().getFullYear()}</p></div></footer>`;
}

export function renderSkinHtmlPage(
  ctx: SiteContext,
  skin: SiteSkin,
  slug: string,
  sections: SectionInstance[]
): string {
  const theme = ctx.designSystem;
  const title = SKIN_PAGE_TITLES[slug]?.title ?? slug;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(ctx.businessName)} — ${esc(title)}</title>
  <link rel="stylesheet" href="${esc(googleFontsHref(theme))}">
  <style>${skinCss(theme, skin)}</style>
</head>
<body data-skin="${esc(skin.id)}" data-family="${esc(skin.visualFamily)}" data-page="${esc(slug)}" data-page-tone="${esc(
    theme.pageTone ?? "light"
  )}" data-grain="${skin.chrome.grainOverlay ? "1" : "0"}">
${navHtml(ctx, skin, slug)}
<main>
${sections.map(renderSection).join("\n")}
</main>
${footerHtml(ctx, skin)}
</body>
</html>`;
}

export function renderSkinHtmlSite(
  ctx: SiteContext,
  skin: SiteSkin,
  instances: Record<string, SectionInstance[]>
): Record<string, string> {
  const htmlPages: Record<string, string> = {};
  for (const slug of Object.keys(skin.pages)) {
    htmlPages[slug] = renderSkinHtmlPage(ctx, skin, slug, instances[slug] ?? []);
  }
  return htmlPages;
}

export function reactPagesFromSkin(
  ctx: SiteContext,
  skin: SiteSkin,
  instances: Record<string, SectionInstance[]>
): Record<string, ReactPage> {
  const pages: Record<string, ReactPage> = {};
  for (const slug of Object.keys(skin.pages)) {
    const meta = SKIN_PAGE_TITLES[slug];
    pages[slug] = {
      slug,
      title: meta?.title ?? slug,
      navLabel: meta?.navLabel ?? slug,
      sections: instances[slug] ?? [],
    };
  }
  ctx.reactPages = pages;
  return pages;
}
