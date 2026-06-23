import type { ContentBlock } from "../types.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function revealWrap(inner: string, extraClass = ""): string {
  return `<div class="reveal${extraClass ? ` ${extraClass}` : ""}">${inner}</div>`;
}

export function renderContentBlock(block: ContentBlock): string {
  const id = escapeHtml(block.id);
  const type = block.type;

  switch (type) {
    case "headline": {
      const heroImage = str(block.heroImage);
      if (heroImage) {
        const bg = escapeHtml(heroImage);
        return revealWrap(`<section class="block-hero" data-block-id="${id}" data-block-type="${type}" style="background-image: linear-gradient(to top, color-mix(in srgb, var(--gradient-from) 88%, black), transparent 70%), url('${bg}')">
  <div class="hero-content">
    <h1>${escapeHtml(str(block.text))}</h1>
    ${block.subtext ? `<p>${escapeHtml(str(block.subtext))}</p>` : ""}
  </div>
</section>`);
      }
      return revealWrap(`<header class="section-headline" data-block-id="${id}" data-block-type="${type}">
  <h1>${escapeHtml(str(block.text))}</h1>
  ${block.subtext ? `<p class="section-subtitle">${escapeHtml(str(block.subtext))}</p>` : ""}
</header>`);
    }

    case "stat":
      return revealWrap(`<section class="block block-stat" data-block-id="${id}" data-block-type="${type}">
  <div class="value">${escapeHtml(str(block.value))}</div>
  <div class="label">${escapeHtml(str(block.label))}</div>
</section>`);

    case "testimonial":
      return revealWrap(`<section class="block block-testimonial" data-block-id="${id}" data-block-type="${type}">
  <blockquote>"${escapeHtml(str(block.quote))}"</blockquote>
  <cite>— ${escapeHtml(str(block.author))}${block.role ? `, ${escapeHtml(str(block.role))}` : ""}</cite>
</section>`);

    case "cta":
      return revealWrap(`<section class="block-cta" data-block-id="${id}" data-block-type="${type}">
  <div class="cta-inner">
    <h2>${escapeHtml(str(block.headline))}</h2>
    ${block.subtext ? `<p>${escapeHtml(str(block.subtext))}</p>` : ""}
    <a class="btn" href="${escapeHtml(str(block.buttonUrl, "#"))}">${escapeHtml(str(block.buttonText, "Get Started"))}</a>
  </div>
</section>`);

    case "image":
      return revealWrap(`<section class="block block-image" data-block-id="${id}" data-block-type="${type}">
  ${
    block.src
      ? `<img src="${escapeHtml(str(block.src))}" alt="${escapeHtml(str(block.alt, "Image"))}" loading="lazy" />`
      : `<div class="placeholder">${escapeHtml(str(block.alt, "Image"))}</div>`
  }
</section>`);

    case "text":
      return revealWrap(`<section class="block block-text" data-block-id="${id}" data-block-type="${type}">
  ${block.title ? `<h2>${escapeHtml(str(block.title))}</h2>` : ""}
  <div class="prose">${escapeHtml(str(block.text)).replace(/\n/g, "<br/>")}</div>
</section>`);

    case "feature":
      return revealWrap(`<section class="block block-feature" data-block-id="${id}" data-block-type="${type}">
  <h3>${escapeHtml(str(block.title))}</h3>
  <p>${escapeHtml(str(block.description))}</p>
</section>`);

    case "gallery":
      return revealWrap(`<section class="block block-gallery" data-block-id="${id}" data-block-type="${type}">
  ${
    block.src
      ? `<img src="${escapeHtml(str(block.src))}" alt="${escapeHtml(str(block.caption, "Gallery"))}" loading="lazy" />`
      : `<div class="placeholder">${escapeHtml(str(block.caption, "Gallery"))}</div>`
  }
  ${block.caption ? `<div class="caption">${escapeHtml(str(block.caption))}</div>` : ""}
</section>`);

    case "faq":
      return revealWrap(`<section class="block block-faq" data-block-id="${id}" data-block-type="${type}">
  <h3 class="faq-q">${escapeHtml(str(block.question))}</h3>
  <p class="faq-a">${escapeHtml(str(block.answer))}</p>
</section>`);

    case "contact":
      return revealWrap(`<section class="block block-contact" data-block-id="${id}" data-block-type="${type}">
  ${block.title ? `<h2>${escapeHtml(str(block.title))}</h2>` : ""}
  ${block.email ? `<p>✉ ${escapeHtml(str(block.email))}</p>` : ""}
  ${block.phone ? `<p>☎ ${escapeHtml(str(block.phone))}</p>` : ""}
  ${block.address ? `<p>📍 ${escapeHtml(str(block.address))}</p>` : ""}
  ${block.hours ? `<p>🕐 ${escapeHtml(str(block.hours))}</p>` : ""}
</section>`);

    default:
      return revealWrap(`<section class="block" data-block-id="${id}" data-block-type="${escapeHtml(type)}">
  <p>${escapeHtml(str(block.text, JSON.stringify(block)))}</p>
</section>`);
  }
}
