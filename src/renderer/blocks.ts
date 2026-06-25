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

function featureList(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return `<ul class="feature-list">${items
    .map((item) => `<li>${escapeHtml(String(item))}</li>`)
    .join("")}</ul>`;
}

function isHeroHeadline(block: ContentBlock): boolean {
  return block.variant === "hero" || block.heroVariant === "hero";
}

function renderFormField(field: Record<string, unknown>, index: number): string {
  const label = escapeHtml(str(field.label, `Field ${index + 1}`));
  const name = escapeHtml(str(field.name, `field_${index}`).replace(/\s+/g, "_").toLowerCase());
  const required = Boolean(field.required);
  const fieldType = str(field.type, "text");

  if (fieldType === "select" && Array.isArray(field.options)) {
    const options = (field.options as unknown[])
      .map((opt) => `<option value="${escapeHtml(String(opt))}">${escapeHtml(String(opt))}</option>`)
      .join("");
    return `<label class="form-field">
  <span class="form-label">${label}${required ? " *" : ""}</span>
  <select name="${name}"${required ? " required" : ""}>${options}</select>
</label>`;
  }

  if (fieldType === "textarea") {
    return `<label class="form-field">
  <span class="form-label">${label}${required ? " *" : ""}</span>
  <textarea name="${name}" rows="4"${required ? " required" : ""}></textarea>
</label>`;
  }

  const inputType = ["text", "email", "tel", "datetime-local", "date", "number"].includes(fieldType)
    ? fieldType
    : "text";

  return `<label class="form-field">
  <span class="form-label">${label}${required ? " *" : ""}</span>
  <input type="${escapeHtml(inputType)}" name="${name}"${required ? " required" : ""} />
</label>`;
}

function renderFallbackBlock(block: ContentBlock, id: string, type: string): string {
  const title = str(block.title) || str(block.headline);
  const text = str(block.text) || str(block.content) || str(block.description);
  if (!title && !text) {
    return `<!-- omitted unknown block ${id} type=${type} -->`;
  }
  return revealWrap(`<section class="block block-text" data-block-id="${id}" data-block-type="text">
  ${title ? `<h2>${escapeHtml(title)}</h2>` : ""}
  ${text ? `<div class="prose">${escapeHtml(text)}</div>` : ""}
</section>`);
}

export function renderContentBlock(block: ContentBlock): string {
  const id = escapeHtml(block.id);
  const type = block.type;

  switch (type) {
    case "headline": {
      const heroImage = str(block.heroImage);
      const splitImage = str(block.splitImage);
      const headingTag = typeof block.level === "number" && block.level >= 2 ? "h2" : "h1";

      if (splitImage && isHeroHeadline(block)) {
        return revealWrap(`<section class="block-split-hero" data-block-id="${id}" data-block-type="${type}">
  <div class="split-hero-text">
    <${headingTag}>${escapeHtml(str(block.text))}</${headingTag}>
    ${block.subtext ? `<p>${escapeHtml(str(block.subtext))}</p>` : ""}
    ${block.buttonText ? `<a class="btn" href="${escapeHtml(str(block.buttonUrl, "#"))}">${escapeHtml(str(block.buttonText))}</a>` : ""}
  </div>
  <div class="split-hero-media">
    <img src="${escapeHtml(splitImage)}" alt="${escapeHtml(str(block.text))}" loading="eager" />
  </div>
</section>`);
      }
      if (heroImage && isHeroHeadline(block)) {
        const bg = escapeHtml(heroImage);
        return revealWrap(`<section class="block-hero" data-block-id="${id}" data-block-type="${type}" style="background-image: linear-gradient(to top, color-mix(in srgb, var(--gradient-from) 88%, black), transparent 70%), url('${bg}')">
  <div class="hero-content">
    <${headingTag}>${escapeHtml(str(block.text))}</${headingTag}>
    ${block.subtext ? `<p>${escapeHtml(str(block.subtext))}</p>` : ""}
  </div>
</section>`);
      }
      return revealWrap(`<header class="section-headline" data-block-id="${id}" data-block-type="${type}">
  <${headingTag}>${escapeHtml(str(block.text))}</${headingTag}>
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

    case "pricing": {
      const highlighted = Boolean(block.highlighted);
      return revealWrap(`<section class="block block-pricing${highlighted ? " block-pricing--featured" : ""}" data-block-id="${id}" data-block-type="${type}">
  <h3>${escapeHtml(str(block.title, "Plan"))}</h3>
  <div class="price"><span class="amount">${escapeHtml(str(block.price))}</span>${block.period ? `<span class="period">/${escapeHtml(str(block.period))}</span>` : ""}</div>
  ${block.description ? `<p class="pricing-desc">${escapeHtml(str(block.description))}</p>` : ""}
  ${featureList(block.features)}
  ${block.buttonText ? `<a class="btn btn-pricing" href="${escapeHtml(str(block.buttonUrl, "#"))}">${escapeHtml(str(block.buttonText))}</a>` : ""}
</section>`);
    }

    case "logo":
      return revealWrap(`<section class="block block-logo" data-block-id="${id}" data-block-type="${type}">
  ${
    block.src
      ? `<img src="${escapeHtml(str(block.src))}" alt="${escapeHtml(str(block.name, "Partner"))}" loading="lazy" />`
      : `<span class="logo-name">${escapeHtml(str(block.name, "Partner"))}</span>`
  }
</section>`);

    case "bento": {
      const span = str(block.span, "normal");
      return revealWrap(
        `<section class="block block-bento block-bento--${escapeHtml(span)}" data-block-id="${id}" data-block-type="${type}" data-bento-span="${escapeHtml(span)}">
  ${block.src ? `<img src="${escapeHtml(str(block.src))}" alt="${escapeHtml(str(block.title, "Highlight"))}" loading="lazy" />` : ""}
  <div class="bento-body">
    ${block.title ? `<h3>${escapeHtml(str(block.title))}</h3>` : ""}
    ${block.description ? `<p>${escapeHtml(str(block.description))}</p>` : ""}
  </div>
</section>`,
        `bento-span-${span}`
      );
    }

    case "list":
      return revealWrap(`<section class="block block-list" data-block-id="${id}" data-block-type="${type}">
  ${block.title ? `<h3>${escapeHtml(str(block.title))}</h3>` : ""}
  ${featureList(block.items)}
</section>`);

    case "form": {
      const fields = Array.isArray(block.fields) ? block.fields : [];
      const fieldsHtml = fields
        .map((field, i) =>
          field && typeof field === "object"
            ? renderFormField(field as Record<string, unknown>, i)
            : ""
        )
        .join("\n  ");
      const submitLabel = escapeHtml(str(block.submitLabel, "Submit"));
      return revealWrap(`<section class="block block-form" data-block-id="${id}" data-block-type="${type}">
  ${block.title ? `<h2>${escapeHtml(str(block.title))}</h2>` : ""}
  <form class="site-form" action="#" method="post" onsubmit="event.preventDefault()">
  ${fieldsHtml}
  <button type="submit" class="btn btn-form">${submitLabel}</button>
  </form>
</section>`);
    }

    case "beforeAfter": {
      const beforeSrc = str(block.beforeSrc) || str(block.beforeImage);
      const afterSrc = str(block.afterSrc) || str(block.afterImage);
      const caption = str(block.caption);
      return revealWrap(`<section class="block block-before-after" data-block-id="${id}" data-block-type="${type}">
  <div class="before-after-pair">
    <figure class="before-after-item">
      ${beforeSrc ? `<img src="${escapeHtml(beforeSrc)}" alt="Before" loading="lazy" />` : `<div class="placeholder">Before</div>`}
      <figcaption>Before</figcaption>
    </figure>
    <figure class="before-after-item">
      ${afterSrc ? `<img src="${escapeHtml(afterSrc)}" alt="After" loading="lazy" />` : `<div class="placeholder">After</div>`}
      <figcaption>After</figcaption>
    </figure>
  </div>
  ${caption ? `<p class="caption">${escapeHtml(caption)}</p>` : ""}
</section>`);
    }

    default:
      return renderFallbackBlock(block, id, type);
  }
}
