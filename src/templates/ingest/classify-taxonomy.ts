/**
 * What vertical is this template actually for?
 *
 * The first version of this answered that from one signal: the bundle subfolder an operator
 * dropped the zip in. That is a real signal (a human sorted it) but a coarse one — a marketplace
 * bundle's "Business, Finance & Law" folder holds construction, logistics and consulting
 * templates, "Multipurpose & Landing Pages" says nothing about any of its contents, and a zip
 * sitting at the bundle root gets no hint at all. Selection then had nothing to hard-filter on,
 * so a plumber's site could be built from a wedding template.
 *
 * So classification reads the template itself. The hero headline is the strongest evidence a
 * template carries about its own subject — it is the sentence the template author wrote to say
 * what kind of business this design is for — followed by nav labels and page titles, then the
 * rest of the headings, then body copy. Each of those is scored separately and combined by
 * weight (`classifyTaxonomyWeighted`), so 4000 characters of footer boilerplate cannot outvote
 * one hero headline that says "Fine Dining Restaurant".
 *
 * Deterministic, no LLM: this runs for every one of ~900 templates on every ingest, and keyword
 * scoring against the same taxonomy a brief goes through is what makes template-side and
 * brief-side classification directly comparable in the first place.
 */
import * as cheerio from "cheerio";
import {
  classifyTaxonomyWeighted,
  type TaxonomyMatch,
  type WeightedSource,
} from "../../skins/taxonomy.js";
import type { SectionRole } from "../types.js";

/**
 * Evidence weights, highest first. Tuned so that a single confident content signal (a hero that
 * names its vertical with a `strong` keyword: 3 × 3.2 = 9.6) beats a folder name that names a
 * different one (3 × 2.4 = 7.2) — the operator's filing is trusted, but the template gets the
 * last word about itself, which is the whole point of reading the markup.
 */
const WEIGHTS = {
  hero: 3.2,
  folder: 2.4,
  pageTitles: 2.0,
  nav: 1.6,
  templateName: 1.4,
  headings: 1.1,
  body: 0.45,
} as const;

/** How much body copy is sampled. Long enough to catch a vertical named only in an about
 *  paragraph, short enough that a 40-page template does not drown the hero on volume alone. */
const MAX_BODY_CHARS = 6000;

/**
 * Nav labels that every template ships regardless of vertical. They are page-structure words, not
 * subject words, so counting them adds noise with no discriminating power — and several of them
 * ("shop", "blog", "portfolio", "services") are real taxonomy keywords that would otherwise tag a
 * generic corporate template as retail or media purely for having a Blog link. The same words are
 * still counted when they appear in a hero or a heading, where they are a statement about the
 * business rather than a menu item.
 */
const NAV_STOPWORDS = new Set([
  "home", "homepage", "index", "main",
  "about", "about us", "who we are",
  "contact", "contact us", "get in touch",
  "blog", "news", "posts", "post", "articles", "article",
  "services", "service", "portfolio", "gallery", "projects", "project", "works", "work",
  "shop", "store", "cart", "checkout", "my account", "account", "wishlist",
  "pages", "page", "elements", "shortcodes", "components", "features", "demo", "demos",
  "team", "faq", "faqs", "pricing", "testimonials", "login", "register", "sign in", "sign up",
  "search", "menu", "more", "read more", "view all", "single", "details", "detail",
  "404", "error", "coming soon", "style guide", "typography", "buttons", "icons",
]);

/**
 * Section-chrome vocabulary, stripped from the low-weight heading/body evidence only.
 *
 * Confirmed against this repo's own ingested corpus: nearly every business template ships a
 * "Latest News" / "From the Blog" / "Recent Posts" band, and those words are `medium`/`weak`
 * keywords for `media-publishing`. Summed across a dozen headings and a few thousand characters of
 * demo post copy, they were beating the actual subject — a factory template and a makeup-artist
 * template both classified as a magazine. They stay counted in the hero, the page titles, the nav
 * and the template name, where naming yourself a blog is a statement rather than a page section;
 * and the genuinely discriminating publishing words (`magazine`, `editorial`, `journalism`,
 * `publishing`, `publication`) are never stripped anywhere.
 */
const CHROME_TERMS = new Set([
  "blog", "blogs", "news", "post", "posts", "article", "articles",
  "newsletter", "subscribe", "press", "story", "stories", "readers",
  "updates", "latest", "recent", "read",
]);

function stripChromeTerms(text: string): string {
  return text
    .split(/(\W+)/)
    .map((token) => (CHROME_TERMS.has(token.toLowerCase()) ? " " : token))
    .join("");
}

export interface TaxonomyEvidenceSection {
  role: SectionRole;
  /** The section's first heading, when it has one. */
  headingText?: string;
  /** Collapsed text content of the section. */
  text?: string;
  /** The section's markup — only read to pull nav link labels. */
  html?: string;
}

export interface TemplateTaxonomyInput {
  /** Bundle subfolder the zip was found in, e.g. "Health & Medical". */
  folderHint?: string;
  /** Human-readable template name, derived from the zip filename. */
  templateName?: string;
  /** `<title>` of each parsed page. */
  pageTitles?: string[];
  sections: readonly TaxonomyEvidenceSection[];
}

export interface TemplateTaxonomy {
  match: TaxonomyMatch;
  /** Which kinds of evidence actually contributed — `folder` alone means the markup said nothing
   *  recognisable, which is exactly the case the old folder-only classifier could not detect. */
  source: "folder" | "content" | "combined" | "none";
  /** The weighted sources, for tracing a surprising classification back to what caused it. */
  evidence: Array<{ kind: keyof typeof WEIGHTS; weight: number; sample: string }>;
}

/** Link labels from a nav section, minus the structural boilerplate every template shares. */
export function navLabels(html: string): string[] {
  const $ = cheerio.load(html, null, false);
  const labels: string[] = [];
  $("a").each((_, node) => {
    const label = $(node).text().replace(/\s+/g, " ").trim().toLowerCase();
    if (!label || label.length > 40) return;
    if (NAV_STOPWORDS.has(label)) return;
    labels.push(label);
  });
  return [...new Set(labels)];
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Build the weighted evidence set. Exported so ingest and the backfill share one definition of
 *  "what counts as evidence", rather than each assembling its own and drifting apart. */
export function taxonomyEvidence(input: TemplateTaxonomyInput): TemplateTaxonomy["evidence"] {
  const rows: TemplateTaxonomy["evidence"] = [];
  const add = (kind: keyof typeof WEIGHTS, text: string): void => {
    const sample = collapse(text);
    if (sample) rows.push({ kind, weight: WEIGHTS[kind], sample });
  };

  // Hero: heading first, then its lead copy. This is the template author's own statement of what
  // the design is for, and the signal the whole reclassification exists to read.
  const heroes = input.sections.filter((section) => section.role === "hero");
  add(
    "hero",
    heroes
      .flatMap((section) => [section.headingText ?? "", (section.text ?? "").slice(0, 400)])
      .join(" ")
  );

  if (input.folderHint) add("folder", input.folderHint);
  if (input.pageTitles?.length) add("pageTitles", input.pageTitles.join(" · "));

  const navs = input.sections.filter((section) => section.role === "nav" && section.html);
  add("nav", navs.flatMap((section) => navLabels(section.html!)).join(" "));

  if (input.templateName) add("templateName", input.templateName);

  add(
    "headings",
    stripChromeTerms(
      input.sections
        .filter((section) => section.role !== "hero" && section.role !== "nav")
        .map((section) => section.headingText ?? "")
        .join(" ")
    )
  );

  add(
    "body",
    stripChromeTerms(
      input.sections
        .filter((section) => section.role !== "nav" && section.role !== "footer")
        .map((section) => section.text ?? "")
        .join(" ")
        .slice(0, MAX_BODY_CHARS)
    )
  );

  return rows;
}

export function classifyTemplateTaxonomy(input: TemplateTaxonomyInput): TemplateTaxonomy {
  const evidence = taxonomyEvidence(input);
  const sources: WeightedSource[] = evidence.map((row) => ({ text: row.sample, weight: row.weight }));
  const match = classifyTaxonomyWeighted(sources);

  if (match.industryScore <= 0) return { match, source: "none", evidence };

  // Which evidence families could have produced this industry on their own — reported so a
  // mis-tag is traceable to "the folder said so" vs "the markup said so".
  const folderOnly = evidence.filter((row) => row.kind === "folder");
  const contentOnly = evidence.filter((row) => row.kind !== "folder");
  const fromFolder =
    folderOnly.length > 0 &&
    classifyTaxonomyWeighted(folderOnly.map((row) => ({ text: row.sample, weight: 1 }))).industryScore > 0;
  const fromContent =
    contentOnly.length > 0 &&
    classifyTaxonomyWeighted(contentOnly.map((row) => ({ text: row.sample, weight: row.weight })))
      .industryScore > 0;

  const source: TemplateTaxonomy["source"] =
    fromFolder && fromContent ? "combined" : fromContent ? "content" : fromFolder ? "folder" : "none";
  return { match, source, evidence };
}
