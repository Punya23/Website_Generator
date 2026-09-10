/**
 * One template page -> its top-level structural sections, kept verbatim.
 *
 * Real templates wrap sections at arbitrary depth (`<div class="wrapper"><section id="hero">`),
 * so this collects every `section|header|footer|nav` and keeps only the outermost ones rather
 * than assuming they are direct children of `<body>`.
 */
import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";

const SECTION_TAGS = "section, header, footer, nav";

export interface RawSection {
  /** The element's own outerHTML, byte-for-byte from the source (scripts stripped, see below). */
  html: string;
  tag: string;
  id: string;
  className: string;
  headingText: string;
  /** Text content, collapsed — used for role classification only, never rewritten. */
  text: string;
  sourceOrder: number;
}

export interface PageExtraction {
  title: string;
  sections: RawSection[];
  /** hrefs of local stylesheets referenced by this page, in document order. */
  stylesheetHrefs: string[];
  /** Contents of the page's inline `<style>` blocks, in document order. */
  inlineStyles: string[];
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isLocalHref(href: string): boolean {
  if (!href) return false;
  if (/^(https?:)?\/\//i.test(href)) return false;
  if (/^(data|mailto|tel|javascript):/i.test(href)) return false;
  return true;
}

/**
 * Third-party template JS is not executed on composed pages (mixing bespoke jQuery/GSAP glue
 * from arbitrarily-picked templates cannot be validated at corpus scale), so script tags are
 * dropped at ingest rather than shipped inert-but-present.
 */
function stripScripts(el: cheerio.Cheerio<DomElement>): void {
  el.find("script").remove();
}

/**
 * Fallback splitter for div-only templates: descend to the container that actually holds the
 * page's content, then treat that container's substantial element children as sections.
 */
function divSections($: cheerio.CheerioAPI, alreadyTaken: DomElement[]): DomElement[] {
  const body = $("body");
  const bodyTextLength = body.text().replace(/\s+/g, " ").trim().length;
  // Enough copy to be a real page rather than a redirect stub or a JS-only shell.
  if (bodyTextLength < 120) return [];

  // Walk down while a single child still holds most of the text — skips `.page-wraper`-style
  // wrappers without hard-coding class names.
  let container = body;
  for (let depth = 0; depth < 6; depth++) {
    const children = container.children("div, main, article").toArray();
    const dominant = children.find((child) => {
      const text = $(child).text().replace(/\s+/g, " ").trim().length;
      return text > 0 && text / Math.max(1, container.text().trim().length) > 0.7;
    });
    if (!dominant) break;
    const next = $(dominant);
    // Stop once the dominant child is itself made of several content blocks.
    if (countContentBlocks($, next) >= 2) {
      container = next;
      break;
    }
    container = next;
  }

  const taken = new Set(alreadyTaken);
  return container
    .children("div, main, article, aside")
    .toArray()
    .filter((node) => {
      if (taken.has(node)) return false;
      if ($(node).parents(SECTION_TAGS).toArray().length > 0) return false;
      const text = $(node).text().replace(/\s+/g, " ").trim();
      const hasMedia = $(node).find("img, video, svg").length > 0;
      const hasHeading = $(node).find("h1, h2, h3, h4").length > 0;
      return text.length > 60 || (hasMedia && hasHeading);
    })
    .slice(0, 24);
}

function countContentBlocks($: cheerio.CheerioAPI, container: cheerio.Cheerio<DomElement>): number {
  return container.children("div, section, article").filter((_, node) => {
    const text = $(node).text().replace(/\s+/g, " ").trim();
    return text.length > 60;
  }).length;
}

export function extractPageSections(html: string, pageName: string): PageExtraction {
  const $ = cheerio.load(html);
  const title = collapse($("title").first().text()) || pageName;

  const stylesheetHrefs: string[] = [];
  $("link[rel='stylesheet']").each((_, node) => {
    const href = $(node).attr("href") ?? "";
    if (isLocalHref(href)) stylesheetHrefs.push(href);
  });

  const inlineStyles: string[] = [];
  $("style").each((_, node) => {
    const css = $(node).html() ?? "";
    if (css.trim()) inlineStyles.push(css);
  });

  const candidates = $("body").find(SECTION_TAGS).toArray();
  const outermost = candidates.filter((node) => {
    const parents = $(node).parents(SECTION_TAGS).toArray();
    return parents.length === 0;
  });

  // Older/blog-style templates mark up content blocks as plain divs (the Kelsey sample in this
  // repo's bundle has semantic <header>/<footer> but a div-only body). Without a fallback those
  // templates ingest as chrome-only.
  const contentful = outermost.filter((node) => {
    const tag = (node as { tagName?: string }).tagName?.toLowerCase();
    return tag !== "nav" && tag !== "header" && tag !== "footer";
  });
  if (contentful.length < 2) {
    outermost.push(...divSections($, outermost));
  }

  const sections: RawSection[] = [];
  outermost.forEach((node, index) => {
    stripScripts($(node));
    const outer = $.html(node);
    if (!outer || collapse($(node).text()).length < 2) return;
    const heading = collapse($(node).find("h1, h2, h3").first().text());
    sections.push({
      html: outer,
      tag: (node as { tagName?: string }).tagName?.toLowerCase() ?? "section",
      id: $(node).attr("id") ?? "",
      className: $(node).attr("class") ?? "",
      headingText: heading,
      text: collapse($(node).text()).slice(0, 600),
      sourceOrder: index,
    });
  });

  return { title, sections, stylesheetHrefs, inlineStyles };
}
