/**
 * The page shape shared by every template under `real-estate/*` — hand-mapped, not crawled.
 *
 * Verified byte-identical (structural CSS rules, class names, DOM shape) across all four template
 * folders; only `:root` color tokens, fonts, and the copy itself differ (see the CSS file's own
 * header comment: "Component class names are shared across every Real Estate vertical in this
 * project"). With the shape fixed and small (8 pages, a few dozen component types), hand-authoring
 * every selector once and validating it against each template's real HTML at extraction time (see
 * `extract.ts`) is more reliable than a generic heuristic crawler would be, and every selector here
 * has been read against the actual markup rather than guessed.
 *
 * `fillSource` is assigned per real-world-risk, not per convenience:
 *  - a specific fact a business would actually publish (a listing's price and address, an agent's
 *    name and phone, a customer's testimonial) is `"data"` — resolved from that business's own
 *    records, never invented, falling back to the template's own clearly-fictional demo value when
 *    no record exists. Fabricating a specific price, street address, or customer quote is a trust
 *    problem, not a copy-quality one — same line `copy-slots.ts` already draws around testimonials
 *    and team photos for the scraped-template corpus, generalized here to every specific claim a
 *    real-estate site makes.
 *  - genuine brand-voice marketing prose (headlines, section copy, a plausible property
 *    description when no real listing feed exists yet) is `"llm"`.
 *  - short label copy that decorates a functionally-fixed target (a nav link's wording, a footer
 *    category heading) is also `"llm"`, but word-capped tightly and annotated with what the label
 *    must still mean.
 *  - pure UI mechanics with no brand-voice value ("Search", "Join", form field labels) are
 *    `"fixed"` — never substituted by anyone.
 */
import { CONTAINER_WIDTH_PX, gridColumnWidthPx } from "./measure.js";
import type { BriefField, ImageFillSource, TextComposeKind, TextFillSource } from "./schema.js";

export type TextMode =
  | { mode: "prose"; typo: string; widthPx: number; lines: number }
  | { mode: "label"; maxWords: number }
  /** A pre-set budget with no CSS box behind it — SEO fields (`<title>`, meta description) follow
   *  a search-engine convention, not a rendered element's width/font-size. */
  | { mode: "fixed"; minChars: number; maxChars: number };

export interface TextDescriptor {
  id: string;
  selector: string;
  role: string;
  fillSource: TextFillSource;
  text: TextMode;
  briefField?: BriefField;
  /** Read/write an attribute instead of the element's text content — e.g. `content` on
   *  `<meta name="description">`. Absent (the default): text content, via `fill.ts`'s usual
   *  child-preserving/plain-text setter. */
  attr?: string;
  /** Remove these (decorative, e.g. an accordion's "+" icon glyph) from a CLONE before reading the
   *  placement's reference text at extraction time — see `extract.ts`. */
  stripChildSelectors?: string[];
  /** When true, `fill.ts` replaces only this element's own direct text node(s) and leaves every
   *  element child untouched (a functional link, an icon glyph). Default (false/absent): the whole
   *  element's content is replaced with plain text, which is what an LLM's answer always is anyway
   *  (it never emits markup) — the one accepted cost is that a decorative inline accent (e.g. the
   *  emphasized word in a hero headline) does not survive a rewrite. */
  preserveChildren?: boolean;
  /** Selects one of `fill.ts`'s hand-written composition rules instead of a plain substitution —
   *  for the handful of spots where the visible text is a template LITERAL plus a business fact
   *  ("© 2026 Prestige Realty", "Call (415) 555-0101"), or plainly needs two brief fields at once
   *  ("(415) 555-0182 / hello@prestigerealty.com"), not one field substituted verbatim. */
  compose?: TextComposeKind;
  notes?: string;
}

export interface ImageDescriptor {
  id: string;
  selector: string;
  domKind: "img" | "background";
  role: string;
  fillSource: ImageFillSource;
  aspectRatio: string;
  minWidthPx: number;
  minHeightPx: number;
  subject: string;
  notes?: string;
}

export interface PageDescriptorSet {
  page: string;
  text: TextDescriptor[];
  images: ImageDescriptor[];
}

const prose = (typo: string, widthPx: number, lines: number): TextMode => ({ mode: "prose", typo, widthPx, lines });
const label = (maxWords: number): TextMode => ({ mode: "label", maxWords });
const seo = (minChars: number, maxChars: number): TextMode => ({ mode: "fixed", minChars, maxChars });

/** `<title>` and meta description — standard SEO length conventions (Google truncates a title
 *  around ~60 characters, a description around ~155-160), the same on every page regardless of
 *  which template or vertical it's for. Every real page in this template set has exactly one of
 *  each, so these two descriptors are added once per page rather than templated further. */
function seoFields(idPrefix: string): TextDescriptor[] {
  return [
    { id: `${idPrefix}.title`, selector: "title", role: "pageTitle", fillSource: "llm", text: seo(15, 60) },
    {
      id: `${idPrefix}.description`, selector: "meta[name='description']", attr: "content",
      role: "pageMetaDescription", fillSource: "llm", text: seo(70, 158),
    },
  ];
}

const COL3 = gridColumnWidthPx(3);
const COL4 = gridColumnWidthPx(4);
/** `.detail-layout{grid-template-columns:2fr 1fr;gap:48px}` inside the container's content width. */
const MAIN_COL = Math.round((CONTAINER_WIDTH_PX - 48) * (2 / 3));
const SIDEBAR_COL = Math.round((CONTAINER_WIDTH_PX - 48) * (1 / 3)) - 2 * 26;

// ---------------------------------------------------------------------------
// Shared repeated-component builders
// ---------------------------------------------------------------------------

/** `.property-card` — used on index/listings/property-detail/agent-detail, always inside the
 *  page's one `.grid--3` (verified: no page mixes two card types in the same grid, so a bare
 *  `nth-of-type` scoped to `.property-card` is unambiguous — see the module comment). */
function propertyCard(idPrefix: string, n: number): { text: TextDescriptor[]; images: ImageDescriptor[] } {
  const base = `.property-card:nth-of-type(${n})`;
  return {
    text: [
      {
        id: `${idPrefix}.${n - 1}.badge`, selector: `${base} .property-card__badge`, role: "propertyBadge",
        fillSource: "data", text: label(2),
        notes: 'Listing status ("For Sale", "New Listing", "For Rent", "Sold") from the real listing feed.',
      },
      { id: `${idPrefix}.${n - 1}.price`, selector: `${base} .property-card__price`, role: "propertyPrice", fillSource: "data", text: label(4) },
      { id: `${idPrefix}.${n - 1}.location`, selector: `${base} .property-card__location`, role: "propertyLocation", fillSource: "data", text: label(8) },
      { id: `${idPrefix}.${n - 1}.title`, selector: `${base} .property-card__title a`, role: "propertyTitle", fillSource: "data", text: prose("cardTitle", COL3, 1) },
      { id: `${idPrefix}.${n - 1}.beds`, selector: `${base} .property-card__meta span:nth-of-type(1)`, role: "propertyMeta", fillSource: "data", text: label(3) },
      { id: `${idPrefix}.${n - 1}.baths`, selector: `${base} .property-card__meta span:nth-of-type(2)`, role: "propertyMeta", fillSource: "data", text: label(3) },
      { id: `${idPrefix}.${n - 1}.sqft`, selector: `${base} .property-card__meta span:nth-of-type(3)`, role: "propertyMeta", fillSource: "data", text: label(3) },
    ],
    images: [
      {
        id: `${idPrefix}.${n - 1}.photo`, selector: `${base} .property-card__media img`, domKind: "img",
        role: "propertyPhoto", fillSource: "data", aspectRatio: "4:3", minWidthPx: 800, minHeightPx: 600,
        subject: "exterior or a signature interior room of the listed property",
      },
    ],
  };
}

/** `.agent-card` — the full variant (agents.html) carries socials; the preview variant
 *  (about.html/index.html "meet the team") does not. Both share name/role/contact/photo. */
function agentCard(idPrefix: string, n: number, opts: { socials: boolean }): { text: TextDescriptor[]; images: ImageDescriptor[] } {
  const base = `.agent-card:nth-of-type(${n})`;
  const text: TextDescriptor[] = [
    { id: `${idPrefix}.${n - 1}.name`, selector: `${base} .agent-card__name a`, role: "agentName", fillSource: "data", text: label(4) },
    { id: `${idPrefix}.${n - 1}.role`, selector: `${base} .agent-card__role`, role: "agentRole", fillSource: "data", text: label(4) },
    { id: `${idPrefix}.${n - 1}.contact`, selector: `${base} .agent-card__contact`, role: "agentContact", fillSource: "data", text: label(10) },
  ];
  if (!opts.socials) {
    // no-op placeholder branch kept for readability at call sites; nothing extra to add.
  }
  return {
    text,
    images: [
      {
        id: `${idPrefix}.${n - 1}.photo`, selector: `${base} .agent-card__photo img`, domKind: "img",
        role: "agentHeadshot", fillSource: "data", aspectRatio: "1:1", minWidthPx: 480, minHeightPx: 480,
        subject: "professional headshot, front-facing, neutral background",
      },
    ],
  };
}

function testimonialCard(idPrefix: string, n: number): { text: TextDescriptor[]; images: ImageDescriptor[] } {
  const base = `.testimonial-card:nth-of-type(${n})`;
  return {
    text: [
      {
        id: `${idPrefix}.${n - 1}.quote`, selector: `${base} .testimonial-card__quote`, role: "testimonialQuote",
        fillSource: "data", text: prose("testimonialQuote", COL3, 4),
        notes: "A real customer's own words. Never fabricated — falls back to the template's demo quote (clearly fictional) when no real testimonial exists yet.",
      },
      { id: `${idPrefix}.${n - 1}.authorName`, selector: `${base} .testimonial-card__author > div > strong`, role: "testimonialAuthorName", fillSource: "data", text: label(4) },
      { id: `${idPrefix}.${n - 1}.authorRole`, selector: `${base} .testimonial-card__author > div > span`, role: "testimonialAuthorRole", fillSource: "data", text: label(5) },
    ],
    images: [
      {
        id: `${idPrefix}.${n - 1}.avatar`, selector: `${base} .testimonial-card__author img`, domKind: "img",
        role: "testimonialAvatar", fillSource: "data", aspectRatio: "1:1", minWidthPx: 96, minHeightPx: 96,
        subject: "the customer's own photo — never a stand-in for a real person",
      },
    ],
  };
}

function serviceCard(idPrefix: string, n: number, opts: { columns: 3 | 4; link: boolean }): TextDescriptor[] {
  const base = `.service-card:nth-of-type(${n})`;
  const width = opts.columns === 3 ? COL3 : COL4;
  const out: TextDescriptor[] = [
    { id: `${idPrefix}.${n - 1}.title`, selector: `${base} .service-card__title`, role: "serviceTitle", fillSource: "llm", text: prose("cardTitle", width, 2) },
    { id: `${idPrefix}.${n - 1}.text`, selector: `${base} .service-card__text`, role: "serviceText", fillSource: "llm", text: prose("infoCardText", width, 4) },
  ];
  if (opts.link) {
    out.push({
      id: `${idPrefix}.${n - 1}.link`, selector: `${base} .service-card__link`, role: "sectionLinkCta",
      fillSource: "fixed", text: label(3), notes: 'Mechanical link label ("Get Started →"), not brand copy.',
    });
  }
  return out;
}

function processStep(idPrefix: string, n: number): TextDescriptor[] {
  const base = `.process-step:nth-of-type(${n})`;
  return [
    { id: `${idPrefix}.${n - 1}.title`, selector: `${base} .process-step__title`, role: "processTitle", fillSource: "llm", text: prose("processTitle", COL4, 1) },
    { id: `${idPrefix}.${n - 1}.text`, selector: `${base} .process-step__text`, role: "processText", fillSource: "llm", text: prose("processText", COL4, 3) },
  ];
}

function statItem(idPrefix: string, n: number): TextDescriptor[] {
  const base = `.stat-item:nth-of-type(${n})`;
  return [
    { id: `${idPrefix}.${n - 1}.number`, selector: `${base} .stat-item__number`, role: "statNumber", fillSource: "data", text: label(2), notes: "A real business stat (years in business, units sold/managed, satisfaction rate)." },
    { id: `${idPrefix}.${n - 1}.label`, selector: `${base} .stat-item__label`, role: "statLabel", fillSource: "data", text: label(3) },
  ];
}

function faqItem(idPrefix: string, n: number): TextDescriptor[] {
  const base = `.faq-item:nth-of-type(${n})`;
  return [
    {
      id: `${idPrefix}.${n - 1}.question`, selector: `${base} .faq-item__question`, role: "faqQuestion",
      fillSource: "llm", text: prose("processTitle", 760, 2),
      stripChildSelectors: [".faq-item__icon"], preserveChildren: true,
      notes: "Preserves the trailing +/− toggle icon — only the question text itself is replaced.",
    },
    { id: `${idPrefix}.${n - 1}.answer`, selector: `${base} .faq-item__answer p`, role: "faqAnswer", fillSource: "llm", text: prose("detailBody", 760, 3) },
  ];
}

function ctaBanner(idPrefix: string, selectorPrefix: string, buttonCount: 1 | 2): TextDescriptor[] {
  const out: TextDescriptor[] = [
    { id: `${idPrefix}.heading`, selector: `${selectorPrefix} .cta-banner h2`, role: "ctaHeading", fillSource: "llm", text: prose("ctaHeading", 640, 2) },
    { id: `${idPrefix}.body`, selector: `${selectorPrefix} .cta-banner p`, role: "ctaBody", fillSource: "llm", text: prose("ctaBody", 560, 2) },
  ];
  for (let i = 1; i <= buttonCount; i++) {
    out.push({
      id: `${idPrefix}.button.${i - 1}`, selector: `${selectorPrefix} .cta-banner__actions a:nth-of-type(${i})`,
      role: "ctaButtonLabel", fillSource: "llm", text: label(4),
    });
  }
  return out;
}

function sectionHeader(idPrefix: string, selectorPrefix: string, opts: { eyebrow?: boolean; subtitle?: boolean } = {}): TextDescriptor[] {
  const out: TextDescriptor[] = [
    { id: `${idPrefix}.title`, selector: `${selectorPrefix} .section__title`, role: "sectionTitle", fillSource: "llm", text: prose("sectionTitle", 620, 2) },
  ];
  if (opts.eyebrow !== false) {
    out.push({ id: `${idPrefix}.eyebrow`, selector: `${selectorPrefix} .section__eyebrow`, role: "sectionEyebrow", fillSource: "llm", text: label(3) });
  }
  if (opts.subtitle) {
    out.push({ id: `${idPrefix}.subtitle`, selector: `${selectorPrefix} .section__subtitle`, role: "sectionSubtitle", fillSource: "llm", text: prose("sectionSubtitle", 620, 2) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chrome — nav / topbar / footer, identical on every page
// ---------------------------------------------------------------------------

const NAV_PAGES = ["Home", "About", "Listings", "Agents", "Services", "Contact"];

export function chromeDescriptors(): PageDescriptorSet {
  const text: TextDescriptor[] = [];

  NAV_PAGES.forEach((pageName, i) => {
    text.push({
      id: `chrome.nav.link.${i}`, selector: `.navbar__links li:nth-of-type(${i + 1}) a`,
      role: "navLink", fillSource: "fixed", text: label(2),
      notes: `Site navigation to the ${pageName} page — structural, never rewritten.`,
    });
  });

  text.push(
    { id: "chrome.nav.brand", selector: ".navbar__logo", role: "brandName", fillSource: "brief", briefField: "businessName", text: label(3), notes: "Two-tone in the source (two styled spans); fill sets it as one plain run." },
    { id: "chrome.footer.brand", selector: ".footer__logo", role: "brandName", fillSource: "brief", briefField: "businessName", text: label(3) },
    { id: "chrome.nav.cta", selector: ".navbar__actions a", role: "navCta", fillSource: "llm", text: label(5), notes: 'Short call-to-action linking to the contact page (e.g. "Get a Free Valuation").' },
    { id: "chrome.topbar.address", selector: ".topbar__contact span:nth-of-type(1)", role: "topbarAddress", fillSource: "brief", briefField: "address", text: label(10) },
    { id: "chrome.topbar.phone", selector: ".topbar__contact span:nth-of-type(2)", role: "topbarPhone", fillSource: "brief", briefField: "phone", text: label(5) },
    { id: "chrome.topbar.email", selector: ".topbar__contact span:nth-of-type(3)", role: "topbarEmail", fillSource: "brief", briefField: "email", text: label(5) },
    { id: "chrome.footer.about", selector: ".footer__col:nth-of-type(1) .footer__about", role: "footerAbout", fillSource: "llm", text: prose("footerAbout", 300, 3) },
    { id: "chrome.footer.col2.heading", selector: ".footer__col:nth-of-type(2) h4", role: "footerColHeading", fillSource: "fixed", text: label(2) }
  );

  for (let i = 1; i <= 5; i++) {
    text.push({
      id: `chrome.footer.col2.link.${i - 1}`, selector: `.footer__col:nth-of-type(2) li:nth-of-type(${i}) a`,
      role: "footerLink", fillSource: "fixed", text: label(3),
      notes: "Site navigation, mirrored in the footer — structural, never rewritten.",
    });
  }

  text.push({
    id: "chrome.footer.col3.heading", selector: ".footer__col:nth-of-type(3) h4", role: "footerColHeading",
    fillSource: "llm", text: label(3), notes: 'Category heading for the list below (e.g. "Property Types", "Signature Markets", "Popular Areas").',
  });
  for (let i = 1; i <= 5; i++) {
    text.push({
      id: `chrome.footer.col3.link.${i - 1}`, selector: `.footer__col:nth-of-type(3) li:nth-of-type(${i}) a`,
      role: "footerLink", fillSource: "llm", text: label(4),
      notes: "A property type, market, or service area this business covers.",
    });
  }

  text.push(
    { id: "chrome.footer.col4.heading", selector: ".footer__col:nth-of-type(4) h4", role: "footerColHeading", fillSource: "llm", text: label(4), notes: 'Heading for the newsletter signup (e.g. "Stay Updated").' },
    { id: "chrome.footer.newsletterText", selector: ".footer__col:nth-of-type(4) .footer__about", role: "footerNewsletterText", fillSource: "llm", text: prose("footerAbout", 260, 2) },
    {
      id: "chrome.footer.copyright", selector: ".footer__bottom span:nth-of-type(1)", role: "footerCopyright",
      fillSource: "brief", briefField: "businessName", text: label(6), compose: "footerCopyright",
      notes: 'fill.ts composes this as "© <current year> <businessName>. All rights reserved." rather than substituting verbatim.',
    },
    {
      id: "chrome.footer.license", selector: ".footer__bottom span:nth-of-type(2)", role: "footerLicense",
      fillSource: "brief", briefField: "licenseNumber", text: label(6), compose: "footerLicense", preserveChildren: true,
      notes: "Mixed content: a license/registration number followed by two fixed legal links (Privacy Policy, Terms). Only the leading text is replaced.",
    }
  );

  return { page: "chrome", text, images: [] };
}

// ---------------------------------------------------------------------------
// index.html
// ---------------------------------------------------------------------------

function indexPage(): PageDescriptorSet {
  const text: TextDescriptor[] = [
    ...seoFields("home.seo"),
    { id: "home.hero.eyebrow", selector: ".hero__eyebrow", role: "heroEyebrow", fillSource: "llm", text: label(4) },
    { id: "home.hero.title", selector: ".hero__title", role: "heroTitle", fillSource: "llm", text: prose("heroTitle", 720, 2), notes: "Drops the source's <em>-accented word — a model's answer is plain text." },
    { id: "home.hero.subtitle", selector: ".hero__subtitle", role: "heroSubtitle", fillSource: "llm", text: prose("heroSubtitle", 560, 3) },
    { id: "home.hero.cta.0", selector: ".hero__actions a:nth-of-type(1)", role: "heroCta", fillSource: "llm", text: label(3) },
    { id: "home.hero.cta.1", selector: ".hero__actions a:nth-of-type(2)", role: "heroCta", fillSource: "llm", text: label(3) },
    ...sectionHeader("home.featured", "main > section:nth-of-type(2)", { subtitle: false }),
    { id: "home.featured.viewAll", selector: "main > section:nth-of-type(2) .section__header--split a", role: "sectionLinkCta", fillSource: "llm", text: label(3) },
  ];
  const images: ImageDescriptor[] = [
    { id: "home.hero.background", selector: ".hero", domKind: "background", role: "heroBackground", fillSource: "data", aspectRatio: "16:9", minWidthPx: 1600, minHeightPx: 900, subject: "wide establishing shot of the business's own market/neighborhood, dusk or golden-hour" },
  ];
  for (let n = 1; n <= 6; n++) {
    const card = propertyCard("home.featured", n);
    text.push(...card.text);
    images.push(...card.images);
  }
  for (let n = 1; n <= 4; n++) text.push(...statItem("home.stats", n));
  text.push(...sectionHeader("home.why", "main > section:nth-of-type(4)", { subtitle: true }));
  for (let n = 1; n <= 4; n++) text.push(...serviceCard("home.why", n, { columns: 4, link: false }));
  text.push(...sectionHeader("home.how", "main > section:nth-of-type(5)", { subtitle: false }));
  for (let n = 1; n <= 4; n++) text.push(...processStep("home.how", n));
  text.push(...sectionHeader("home.testimonials", "main > section:nth-of-type(6)", { subtitle: false }));
  for (let n = 1; n <= 3; n++) {
    const t = testimonialCard("home.testimonials", n);
    text.push(...t.text);
    images.push(...t.images);
  }
  text.push(...ctaBanner("home.cta", "main > section:nth-of-type(7)", 2));
  return { page: "index.html", text, images };
}

// ---------------------------------------------------------------------------
// about.html
// ---------------------------------------------------------------------------

function aboutPage(): PageDescriptorSet {
  const text: TextDescriptor[] = [
    ...seoFields("about.seo"),
    { id: "about.banner.title", selector: ".page-banner__title", role: "pageBannerTitle", fillSource: "llm", text: prose("pageBannerTitle", 760, 2) },
    { id: "about.story.eyebrow", selector: ".detail-layout .section__eyebrow", role: "sectionEyebrow", fillSource: "llm", text: label(3) },
    { id: "about.story.title", selector: ".detail-layout .section__title", role: "sectionTitle", fillSource: "llm", text: prose("sectionTitle", MAIN_COL, 2) },
    { id: "about.story.paragraph.0", selector: ".detail-layout > div:nth-of-type(1) > p:nth-of-type(1)", role: "detailDescription", fillSource: "llm", text: prose("detailBody", MAIN_COL, 4) },
    { id: "about.story.paragraph.1", selector: ".detail-layout > div:nth-of-type(1) > p:nth-of-type(2)", role: "detailDescription", fillSource: "llm", text: prose("detailBody", MAIN_COL, 4) },
    { id: "about.story.paragraph.2", selector: ".detail-layout > div:nth-of-type(1) > p:nth-of-type(3)", role: "detailDescription", fillSource: "llm", text: prose("detailBody", MAIN_COL, 4) },
    ...sectionHeader("about.values", "main > section:nth-of-type(3)", { subtitle: false }),
  ];
  const images: ImageDescriptor[] = [
    { id: "about.banner.background", selector: ".page-banner", domKind: "background", role: "pageBannerBackground", fillSource: "data", aspectRatio: "16:9", minWidthPx: 1600, minHeightPx: 900, subject: "the business's storefront, office, or team at work" },
    { id: "about.story.photo", selector: ".detail-layout img", domKind: "img", role: "aboutPhoto", fillSource: "data", aspectRatio: "4:3", minWidthPx: 800, minHeightPx: 600, subject: "the business's own office, storefront, or founder" },
  ];
  for (let n = 1; n <= 4; n++) text.push(...serviceCard("about.values", n, { columns: 4, link: false }));
  for (let n = 1; n <= 4; n++) text.push(...statItem("about.stats", n));
  text.push(...sectionHeader("about.team", "main > section:nth-of-type(5)", { subtitle: false }));
  text.push({ id: "about.team.viewAll", selector: "main > section:nth-of-type(5) .section__header--split a", role: "sectionLinkCta", fillSource: "llm", text: label(3) });
  for (let n = 1; n <= 3; n++) {
    const a = agentCard("about.team", n, { socials: false });
    text.push(...a.text);
    images.push(...a.images);
  }
  text.push(...ctaBanner("about.cta", "main > section:nth-of-type(6)", 2));
  return { page: "about.html", text, images };
}

// ---------------------------------------------------------------------------
// services.html
// ---------------------------------------------------------------------------

function servicesPage(): PageDescriptorSet {
  const text: TextDescriptor[] = [
    ...seoFields("services.seo"),
    { id: "services.banner.title", selector: ".page-banner__title", role: "pageBannerTitle", fillSource: "llm", text: prose("pageBannerTitle", 760, 2) },
    ...sectionHeader("services.offers", "main > section:nth-of-type(2)", { subtitle: false }),
  ];
  const images: ImageDescriptor[] = [
    { id: "services.banner.background", selector: ".page-banner", domKind: "background", role: "pageBannerBackground", fillSource: "data", aspectRatio: "16:9", minWidthPx: 1600, minHeightPx: 900, subject: "the business's services being delivered" },
  ];
  for (let n = 1; n <= 6; n++) text.push(...serviceCard("services.offers", n, { columns: 3, link: true }));
  text.push(...sectionHeader("services.process", "main > section:nth-of-type(3)", { subtitle: false }));
  for (let n = 1; n <= 4; n++) text.push(...processStep("services.process", n));
  text.push(...sectionHeader("services.faq", "main > section:nth-of-type(4)", { subtitle: false }));
  for (let n = 1; n <= 5; n++) text.push(...faqItem("services.faq", n));
  text.push(...ctaBanner("services.cta", "main > section:nth-of-type(5)", 1));
  return { page: "services.html", text, images };
}

// ---------------------------------------------------------------------------
// listings.html
// ---------------------------------------------------------------------------

function listingsPage(): PageDescriptorSet {
  const text: TextDescriptor[] = [
    ...seoFields("listings.seo"),
    { id: "listings.banner.title", selector: ".page-banner__title", role: "pageBannerTitle", fillSource: "llm", text: prose("pageBannerTitle", 760, 2) },
  ];
  const images: ImageDescriptor[] = [
    { id: "listings.banner.background", selector: ".page-banner", domKind: "background", role: "pageBannerBackground", fillSource: "data", aspectRatio: "16:9", minWidthPx: 1600, minHeightPx: 900, subject: "an aerial or streetscape view representative of the business's market" },
  ];
  // Filter bar, sort control, results count and pagination are live UI state, not business
  // content — intentionally out of scope (see PLACEMENTS_SCHEMA.md, "What's intentionally left out").
  for (let n = 1; n <= 9; n++) {
    const card = propertyCard("listings.card", n);
    text.push(...card.text);
    images.push(...card.images);
  }
  return { page: "listings.html", text, images };
}

// ---------------------------------------------------------------------------
// property-detail.html
// ---------------------------------------------------------------------------

function propertyDetailPage(): PageDescriptorSet {
  const text: TextDescriptor[] = [
    ...seoFields("property.seo"),
    { id: "property.badge", selector: ".detail-header .property-card__badge", role: "detailBadge", fillSource: "data", text: label(2) },
    { id: "property.title", selector: ".detail-header h1", role: "detailTitle", fillSource: "data", text: prose("unstyledH1", MAIN_COL, 2) },
    { id: "property.location", selector: ".detail-header__location", role: "detailLocation", fillSource: "data", text: label(10) },
    { id: "property.price", selector: ".detail-header__price", role: "detailPrice", fillSource: "data", text: label(4) },
    { id: "property.facts.0.value", selector: ".key-facts__item:nth-of-type(1) strong", role: "keyFactValue", fillSource: "data", text: label(2) },
    { id: "property.facts.0.label", selector: ".key-facts__item:nth-of-type(1) span", role: "keyFactLabel", fillSource: "fixed", text: label(2) },
    { id: "property.facts.1.value", selector: ".key-facts__item:nth-of-type(2) strong", role: "keyFactValue", fillSource: "data", text: label(2) },
    { id: "property.facts.1.label", selector: ".key-facts__item:nth-of-type(2) span", role: "keyFactLabel", fillSource: "fixed", text: label(2) },
    { id: "property.facts.2.value", selector: ".key-facts__item:nth-of-type(3) strong", role: "keyFactValue", fillSource: "data", text: label(2) },
    { id: "property.facts.2.label", selector: ".key-facts__item:nth-of-type(3) span", role: "keyFactLabel", fillSource: "fixed", text: label(2) },
    { id: "property.facts.3.value", selector: ".key-facts__item:nth-of-type(4) strong", role: "keyFactValue", fillSource: "data", text: label(2) },
    { id: "property.facts.3.label", selector: ".key-facts__item:nth-of-type(4) span", role: "keyFactLabel", fillSource: "fixed", text: label(2) },
    // `.detail-section` shares the plain `div` tag with `.detail-header`/`.key-facts` siblings, so
    // `:nth-of-type` (always tag-positional per the CSS spec, regardless of class) must use each
    // section's REAL position among ALL div children, not its position among `.detail-section`s
    // alone — 3rd/4th/5th div child on this page, not 1st/2nd/3rd. See the same note on
    // `agentDetailPage()` below, where the numbering differs because that page's div children are
    // ordered differently.
    { id: "property.description.heading", selector: ".detail-section:nth-of-type(3) > h3", role: "detailSectionHeading", fillSource: "fixed", text: label(2) },
    {
      id: "property.description.body", selector: ".detail-section:nth-of-type(3) > p", role: "detailDescription",
      fillSource: "llm", text: prose("detailBody", MAIN_COL, 8),
      notes: "Plausible listing description. A real listing feed's own description should be used instead of this once one exists — see the module's fillSource policy.",
    },
    { id: "property.amenities.heading", selector: ".detail-section:nth-of-type(4) > h3", role: "detailSectionHeading", fillSource: "fixed", text: label(2) },
  ];
  for (let n = 1; n <= 8; n++) {
    text.push({
      id: `property.amenities.${n - 1}`, selector: `.amenities-list li:nth-of-type(${n})`, role: "amenityItem",
      fillSource: "llm", text: label(6),
    });
  }
  text.push(
    { id: "property.location.heading", selector: ".detail-section:nth-of-type(5) > h3", role: "detailSectionHeading", fillSource: "fixed", text: label(2) },
    { id: "property.sidebar.agentName", selector: ".sidebar-card:nth-of-type(1) strong", role: "agentName", fillSource: "data", text: label(4) },
    { id: "property.sidebar.agentRole", selector: ".sidebar-card:nth-of-type(1) span", role: "agentRole", fillSource: "data", text: label(4) },
    { id: "property.sidebar.blurb", selector: ".sidebar-card:nth-of-type(1) p", role: "sidebarBlurb", fillSource: "llm", text: prose("sidebarBlurb", SIDEBAR_COL, 2) },
    {
      id: "property.sidebar.callButton", selector: ".sidebar-card:nth-of-type(1) a:nth-of-type(1)", role: "sidebarHeading",
      fillSource: "brief", briefField: "phone", text: label(4), compose: "callButton",
      notes: 'fill.ts composes this as "Call <phone>".',
    },
    { id: "property.tour.heading", selector: ".sidebar-card:nth-of-type(2) h3", role: "sidebarHeading", fillSource: "fixed", text: label(3) },
    ...sectionHeader("property.similar", "main > section:nth-of-type(2)", { subtitle: false }),
    { id: "property.similar.viewAll", selector: "main > section:nth-of-type(2) .section__header--split a", role: "sectionLinkCta", fillSource: "llm", text: label(3) }
  );
  const images: ImageDescriptor[] = [
    { id: "property.gallery.main", selector: ".gallery__main img", domKind: "img", role: "galleryMain", fillSource: "data", aspectRatio: "3:2", minWidthPx: 1200, minHeightPx: 800, subject: "the property's exterior, hero angle" },
    { id: "property.gallery.side.0", selector: ".gallery__side img:nth-of-type(1)", domKind: "img", role: "gallerySide", fillSource: "data", aspectRatio: "1:1", minWidthPx: 700, minHeightPx: 700, subject: "the property's living/common area" },
    { id: "property.gallery.side.1", selector: ".gallery__side img:nth-of-type(2)", domKind: "img", role: "gallerySide", fillSource: "data", aspectRatio: "1:1", minWidthPx: 700, minHeightPx: 700, subject: "the property's kitchen or a second interior room" },
    { id: "property.sidebar.agentPhoto", selector: ".sidebar-card:nth-of-type(1) img", domKind: "img", role: "sidebarAgentPhoto", fillSource: "data", aspectRatio: "1:1", minWidthPx: 120, minHeightPx: 120, subject: "the listing agent's headshot" },
  ];
  for (let n = 1; n <= 3; n++) {
    const card = propertyCard("property.similar", n);
    text.push(...card.text);
    images.push(...card.images);
  }
  return { page: "property-detail.html", text, images };
}

// ---------------------------------------------------------------------------
// agents.html
// ---------------------------------------------------------------------------

function agentsPage(): PageDescriptorSet {
  const text: TextDescriptor[] = [
    ...seoFields("agents.seo"),
    { id: "agents.banner.title", selector: ".page-banner__title", role: "pageBannerTitle", fillSource: "llm", text: prose("pageBannerTitle", 760, 2) },
    ...sectionHeader("agents.team", "main > section:nth-of-type(2)", { subtitle: true }),
  ];
  const images: ImageDescriptor[] = [
    { id: "agents.banner.background", selector: ".page-banner", domKind: "background", role: "pageBannerBackground", fillSource: "data", aspectRatio: "16:9", minWidthPx: 1600, minHeightPx: 900, subject: "the team together, or the office" },
  ];
  for (let n = 1; n <= 6; n++) {
    const a = agentCard("agents.roster", n, { socials: true });
    text.push(...a.text);
    images.push(...a.images);
  }
  text.push(...ctaBanner("agents.cta", "main > section:nth-of-type(3)", 1));
  return { page: "agents.html", text, images };
}

// ---------------------------------------------------------------------------
// agent-detail.html
// ---------------------------------------------------------------------------

function agentDetailPage(): PageDescriptorSet {
  const text: TextDescriptor[] = [
    ...seoFields("agentDetail.seo"),
    { id: "agentDetail.name", selector: "h1[data-field='agent.name']", role: "agentName", fillSource: "data", text: prose("unstyledH1", MAIN_COL, 1) },
    { id: "agentDetail.role", selector: ".detail-layout .agent-card__role", role: "agentRole", fillSource: "data", text: label(4) },
    { id: "agentDetail.contact", selector: ".detail-layout > div:nth-of-type(1) > div:nth-of-type(1) > div > div:nth-of-type(2)", role: "agentContact", fillSource: "data", text: label(12), notes: "Phone, email, and license number in one line." },
    // Div-child order on this page: [0]=header block, [1]=this "About" detail-section,
    // [2]=key-facts, [3]=the "Current Listings" detail-section — see the matching note in
    // `propertyDetailPage()` above for why `:nth-of-type` must use that raw position.
    { id: "agentDetail.aboutHeading", selector: ".detail-section:nth-of-type(2) > h3", role: "detailSectionHeading", fillSource: "data", text: label(3), notes: 'Literally "About <agent\'s first name>" — regenerate from the real name rather than the template\'s own demo name.' },
    { id: "agentDetail.bio.0", selector: ".detail-section:nth-of-type(2) > p:nth-of-type(1)", role: "detailDescription", fillSource: "llm", text: prose("detailBody", MAIN_COL, 4), notes: "Plausible professional bio — avoid unverifiable specific claims (exact deal counts, awards) unless the business supplied them." },
    { id: "agentDetail.bio.1", selector: ".detail-section:nth-of-type(2) > p:nth-of-type(2)", role: "detailDescription", fillSource: "llm", text: prose("detailBody", MAIN_COL, 3) },
    { id: "agentDetail.facts.0.value", selector: ".key-facts__item:nth-of-type(1) strong", role: "keyFactValue", fillSource: "data", text: label(2) },
    { id: "agentDetail.facts.0.label", selector: ".key-facts__item:nth-of-type(1) span", role: "keyFactLabel", fillSource: "fixed", text: label(2) },
    { id: "agentDetail.facts.1.value", selector: ".key-facts__item:nth-of-type(2) strong", role: "keyFactValue", fillSource: "data", text: label(2) },
    { id: "agentDetail.facts.1.label", selector: ".key-facts__item:nth-of-type(2) span", role: "keyFactLabel", fillSource: "fixed", text: label(2) },
    { id: "agentDetail.facts.2.value", selector: ".key-facts__item:nth-of-type(3) strong", role: "keyFactValue", fillSource: "data", text: label(2) },
    { id: "agentDetail.facts.2.label", selector: ".key-facts__item:nth-of-type(3) span", role: "keyFactLabel", fillSource: "fixed", text: label(2) },
    { id: "agentDetail.facts.3.value", selector: ".key-facts__item:nth-of-type(4) strong", role: "keyFactValue", fillSource: "data", text: label(2) },
    { id: "agentDetail.facts.3.label", selector: ".key-facts__item:nth-of-type(4) span", role: "keyFactLabel", fillSource: "fixed", text: label(2) },
    { id: "agentDetail.listingsHeading", selector: ".detail-section:nth-of-type(4) > h3", role: "detailSectionHeading", fillSource: "data", text: label(4), notes: 'Literally "Current Listings by <agent\'s first name>".' },
  ];
  const images: ImageDescriptor[] = [
    { id: "agentDetail.photo", selector: ".detail-layout > div:nth-of-type(1) > div:nth-of-type(1) > img", domKind: "img", role: "agentHeadshot", fillSource: "data", aspectRatio: "1:1", minWidthPx: 480, minHeightPx: 480, subject: "the agent's own professional headshot" },
  ];
  for (let n = 1; n <= 3; n++) {
    const card = propertyCard("agentDetail.listings", n);
    text.push(...card.text);
    images.push(...card.images);
  }
  const testimonial = testimonialCard("agentDetail.testimonial", 1);
  text.push(...testimonial.text);
  images.push(...testimonial.images);
  text.push(
    { id: "agentDetail.contactHeading", selector: ".sidebar-card h3", role: "sidebarHeading", fillSource: "data", text: label(3), notes: 'Literally "Contact <agent\'s first name>".' }
  );
  return { page: "agent-detail.html", text, images };
}

// ---------------------------------------------------------------------------
// contact.html
// ---------------------------------------------------------------------------

function contactPage(): PageDescriptorSet {
  const text: TextDescriptor[] = [
    ...seoFields("contact.seo"),
    { id: "contact.banner.title", selector: ".page-banner__title", role: "pageBannerTitle", fillSource: "llm", text: prose("pageBannerTitle", 760, 2) },
    { id: "contact.info.0.title", selector: ".info-card:nth-of-type(1) .info-card__title", role: "infoCardTitle", fillSource: "fixed", text: label(3) },
    { id: "contact.info.0.text", selector: ".info-card:nth-of-type(1) .info-card__text", role: "infoCardText", fillSource: "brief", briefField: "address", text: prose("infoCardText", COL3, 2) },
    { id: "contact.info.1.title", selector: ".info-card:nth-of-type(2) .info-card__title", role: "infoCardTitle", fillSource: "fixed", text: label(3) },
    {
      id: "contact.info.1.text", selector: ".info-card:nth-of-type(2) .info-card__text", role: "infoCardText",
      fillSource: "brief", briefField: "phone", text: prose("infoCardText", COL3, 2), compose: "phoneAndEmail",
      notes: "fill.ts composes this as \"<phone><br><email>\" — both brief fields, not just briefField above.",
    },
    { id: "contact.info.2.title", selector: ".info-card:nth-of-type(3) .info-card__title", role: "infoCardTitle", fillSource: "fixed", text: label(3) },
    { id: "contact.info.2.text", selector: ".info-card:nth-of-type(3) .info-card__text", role: "infoCardText", fillSource: "brief", briefField: "hours", text: prose("infoCardText", COL3, 2) },
    { id: "contact.form.heading", selector: ".form-card .section__title", role: "formHeading", fillSource: "llm", text: prose("sectionTitle", 500, 1) },
    { id: "contact.form.intro", selector: ".form-card > p", role: "formIntro", fillSource: "llm", text: prose("detailBody", 500, 2) },
    { id: "contact.sidebar.heading", selector: ".sidebar-card h3", role: "sidebarHeading", fillSource: "llm", text: label(6) },
    { id: "contact.sidebar.agentName", selector: ".sidebar-card__agent strong", role: "agentName", fillSource: "data", text: label(4) },
    { id: "contact.sidebar.agentRole", selector: ".sidebar-card__agent span", role: "agentRole", fillSource: "data", text: label(4) },
    {
      id: "contact.sidebar.callButton", selector: ".sidebar-card a", role: "sidebarHeading", fillSource: "brief",
      briefField: "phone", text: label(4), compose: "callButton", notes: 'fill.ts composes this as "Call <phone>".',
    },
  ];
  const images: ImageDescriptor[] = [
    { id: "contact.banner.background", selector: ".page-banner", domKind: "background", role: "pageBannerBackground", fillSource: "data", aspectRatio: "16:9", minWidthPx: 1600, minHeightPx: 900, subject: "the business's office entrance or storefront" },
    { id: "contact.sidebar.agentPhoto", selector: ".sidebar-card__agent img", domKind: "img", role: "sidebarAgentPhoto", fillSource: "data", aspectRatio: "1:1", minWidthPx: 120, minHeightPx: 120, subject: "the point-of-contact agent's headshot" },
  ];
  return { page: "contact.html", text, images };
}

/** Every page's descriptor set, in nav order. `generate.ts`/`extract.ts` iterate this list plus
 *  `chromeDescriptors()` to build one template's full `PlacementsFile`. */
export function realEstatePageBuilders(): PageDescriptorSet[] {
  return [indexPage(), aboutPage(), servicesPage(), listingsPage(), propertyDetailPage(), agentsPage(), agentDetailPage(), contactPage()];
}

export const REAL_ESTATE_PAGE_ORDER = [
  "index.html", "about.html", "services.html", "listings.html",
  "property-detail.html", "agents.html", "agent-detail.html", "contact.html",
];

// ---------------------------------------------------------------------------
// Section grouping — the human/LLM-facing "which visual block is this in" answer.
// ---------------------------------------------------------------------------

/**
 * Maps a placement `id` to the section it visually belongs to (`"hero"`, `"featuredListings"`,
 * `"nav"`, ...) — what `llm-view.ts` groups by so an LLM (or a human) sees "the hero section needs
 * these 5 fields" / "the nav never needs anything" instead of a flat list of 404 ids.
 *
 * A lookup table against `id`, not a live property on every descriptor above: every id already
 * begins with the exact string chosen for its group (`"home.featured.0.title"`,
 * `"chrome.nav.link.3"`, ...) precisely because the id itself was designed as `<group>.<field>` /
 * `<group>.<index>.<field>` — so grouping is a pure function of the id, and adding it here costs
 * one small, reviewable table instead of touching all ~450 descriptor literals above. Checked in
 * declaration order, first match wins — more specific rules (`"chrome.footer.col2."`) are listed
 * before the general fallback they'd otherwise be shadowed by (`"chrome.footer."`).
 */
interface SectionRule {
  match: string;
  section: string;
  /** Match the id exactly rather than as a prefix — for a handful of ids that are themselves a
   *  complete field name today (`"property.title"`) and would otherwise swallow an unrelated,
   *  longer id that happens to start the same way (`"property.location"` the address field vs.
   *  `"property.location.heading"` the unrelated "Location" detail-section's own heading). */
  exact?: boolean;
}

const SECTION_RULES: SectionRule[] = [
  // Chrome
  { match: "chrome.nav.link.", section: "nav" },
  { match: "chrome.nav.brand", section: "nav", exact: true },
  // Deliberately its own section, not "nav": the CTA button is marketing copy that happens to sit
  // in the nav bar, not site navigation — keeping it separate means the "nav" section itself is
  // 100% locked (every field editable:false), which is the literal, unambiguous answer to "does
  // the navigation bar ever need to change".
  { match: "chrome.nav.cta", section: "navCta", exact: true },
  { match: "chrome.topbar.", section: "topbar" },
  { match: "chrome.footer.col2.", section: "footerQuickLinks" },
  { match: "chrome.footer.col3.", section: "footerCategories" },
  { match: "chrome.footer.col4.", section: "footerNewsletter" },
  { match: "chrome.footer.newsletterText", section: "footerNewsletter", exact: true },
  { match: "chrome.footer.", section: "footer" },

  // index.html
  { match: "home.seo.", section: "seo" },
  { match: "home.hero.", section: "hero" },
  { match: "home.featured.", section: "featuredListings" },
  { match: "home.stats.", section: "stats" },
  { match: "home.why.", section: "whyUs" },
  { match: "home.how.", section: "howItWorks" },
  { match: "home.testimonials.", section: "testimonials" },
  { match: "home.cta.", section: "cta" },

  // about.html
  { match: "about.seo.", section: "seo" },
  { match: "about.banner.", section: "banner" },
  { match: "about.story.", section: "story" },
  { match: "about.values.", section: "values" },
  { match: "about.stats.", section: "stats" },
  { match: "about.team.", section: "team" },
  { match: "about.cta.", section: "cta" },

  // services.html
  { match: "services.seo.", section: "seo" },
  { match: "services.banner.", section: "banner" },
  { match: "services.offers.", section: "services" },
  { match: "services.process.", section: "process" },
  { match: "services.faq.", section: "faq" },
  { match: "services.cta.", section: "cta" },

  // listings.html
  { match: "listings.seo.", section: "seo" },
  { match: "listings.banner.", section: "banner" },
  { match: "listings.card.", section: "listings" },

  // property-detail.html — the 4 exact rules must stay ahead of any prefix rule that could
  // otherwise shadow them (none currently would, but exact keeps this order-independent).
  { match: "property.seo.", section: "seo" },
  { match: "property.badge", section: "listing", exact: true },
  { match: "property.title", section: "listing", exact: true },
  { match: "property.price", section: "listing", exact: true },
  { match: "property.location", section: "listing", exact: true },
  { match: "property.gallery.", section: "gallery" },
  { match: "property.facts.", section: "keyFacts" },
  { match: "property.description.", section: "description" },
  { match: "property.amenities.", section: "amenities" },
  { match: "property.location.", section: "location" },
  { match: "property.sidebar.", section: "sidebar" },
  { match: "property.tour.", section: "sidebar" },
  { match: "property.similar.", section: "similarListings" },

  // agents.html
  { match: "agents.seo.", section: "seo" },
  { match: "agents.banner.", section: "banner" },
  { match: "agents.team.", section: "team" },
  { match: "agents.roster.", section: "team" },
  { match: "agents.cta.", section: "cta" },

  // agent-detail.html
  { match: "agentDetail.seo.", section: "seo" },
  { match: "agentDetail.name", section: "profile", exact: true },
  { match: "agentDetail.role", section: "profile", exact: true },
  { match: "agentDetail.contact", section: "profile", exact: true },
  { match: "agentDetail.photo", section: "profile", exact: true },
  { match: "agentDetail.aboutHeading", section: "bio", exact: true },
  { match: "agentDetail.bio.", section: "bio" },
  { match: "agentDetail.facts.", section: "keyFacts" },
  { match: "agentDetail.listingsHeading", section: "listings", exact: true },
  { match: "agentDetail.listings.", section: "listings" },
  { match: "agentDetail.testimonial.", section: "testimonials" },
  { match: "agentDetail.contactHeading", section: "sidebar", exact: true },

  // contact.html
  { match: "contact.seo.", section: "seo" },
  { match: "contact.banner.", section: "banner" },
  { match: "contact.info.", section: "contactInfo" },
  { match: "contact.form.", section: "form" },
  { match: "contact.sidebar.", section: "sidebar" },
];

export function sectionForId(id: string): string {
  for (const rule of SECTION_RULES) {
    if (rule.exact ? id === rule.match : id.startsWith(rule.match)) return rule.section;
  }
  return "misc";
}
