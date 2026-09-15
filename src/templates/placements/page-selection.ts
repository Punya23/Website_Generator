/**
 * Lets a caller generate a real-estate site with FEWER than the template's full 8 pages — a
 * business with no active listings might not want `listings.html`/`property-detail.html` at all,
 * one with no named staff might skip `agents.html`/`agent-detail.html`. Two real problems, both
 * solved here, neither solvable by just not calling `fillPlacementsFile` for the dropped pages:
 *
 * 1. **Cost** — an excluded page's fields must never reach the LLM at all, not get filled and then
 *    discarded. `filterPageOrder` does this by shrinking `PlacementsFile.pageOrder` BEFORE
 *    `fillPlacementsFile` ever sees it (both its own per-page loop and `fillRealEstateTemplate`'s
 *    iterate `pageOrder`, never `Object.keys(file.pages)` — dropping a filename from the array is
 *    enough; the unused `PagePlacements` entry left behind in `file.pages` is inert).
 *
 * 2. **Dead links** — every one of the 4 templates cross-links pages outside chrome, not just in
 *    nav/footer: `index.html`'s hero/CTA-banner/6 featured-property cards link `listings.html` /
 *    `property-detail.html`; `about.html`'s 3 team cards link `agent-detail.html`; every
 *    `listings.html`/`agents.html` card links its own detail page; both detail pages carry a
 *    breadcrumb and a "related" grid. Verified structurally identical across real-estate-agency,
 *    luxury-real-estate, and commercial-real-estate (byte-identical HTML, only visible labels
 *    differ); property-management varies only which existing page one CTA's href already points
 *    at, not the shape. Dropping a page without also removing what still points at it would ship a
 *    site with real 404s — `pruneDanglingPageLinks` runs on every KEPT page's final HTML (after
 *    `applyPlacements`, so it never interferes with a fill) and removes every `<a href>` aimed at an
 *    excluded page: the enclosing `<li>` for a nav/footer menu item, the whole element for a
 *    button-styled CTA (a hero/section button with one fewer sibling in a flex row is fine; a bare
 *    unstyled fragment of leftover text where a button was is not), and a plain unwrap-to-text for
 *    everything else (a property/agent card's title link, a breadcrumb crumb — reads perfectly well
 *    as non-clickable text). A footer column left with no real links after that (every "Property
 *    Types" item pointed at the one excluded listings page) is removed whole, heading included.
 */
import * as cheerio from "cheerio";
import { REAL_ESTATE_PAGE_ORDER } from "./real-estate-map.js";
import type { PlacementsFile } from "./schema.js";

/** One entry per file in `REAL_ESTATE_PAGE_ORDER`, in the same order — the slug vocabulary used
 *  everywhere else in this codebase (`ctx.pages`, `htmlPages`, ...) for these same 8 pages. */
export const REAL_ESTATE_PAGE_SLUGS = REAL_ESTATE_PAGE_ORDER.map(pageFileToSlugInternal) as readonly string[];

function pageFileToSlugInternal(pageFile: string): string {
  return pageFile === "index.html" ? "home" : pageFile.replace(/\.html$/, "");
}

/** `"index.html"` -> `"home"`, `"about.html"` -> `"about"` — same convention `pageFileName`
 *  (compose.ts) and `placements-pipeline.ts`'s own (private, duplicate) `slugForPageFile` use.
 *  Exported here as the one shared implementation for the real-estate placements pipeline. */
export function slugForPageFile(pageFile: string): string {
  return pageFileToSlugInternal(pageFile);
}

/** `"home"` -> `"index.html"`, `"about"` -> `"about.html"`. `null` for a slug that isn't one of
 *  this template's 8 pages — a caller-supplied typo, never silently ignored. */
export function pageFileForSlug(slug: string): string | null {
  if (slug === "home") return "index.html";
  const file = `${slug}.html`;
  return REAL_ESTATE_PAGE_ORDER.includes(file) ? file : null;
}

export interface PageSelectionResult {
  /** `file.pageOrder`, narrowed to the requested slugs, same relative order. */
  pageOrder: string[];
  /** Every file this selection leaves OUT — what `pruneDanglingPageLinks` removes links to. */
  excludedFiles: Set<string>;
  /** A slug the caller asked for that isn't one of the 8 real ids — surfaced so a typo
   *  ("listing" for "listings") fails loudly instead of silently shipping every page. */
  unknownSlugs: string[];
}

/** Resolves a caller's requested slugs against one template's real `pageOrder`. `"home"` is always
 *  kept even if the caller forgot it — a site with no home page isn't a smaller site, it's a broken
 *  one, and every other page's nav/breadcrumb links back to it unconditionally. */
export function resolvePageSelection(pageOrder: readonly string[], selectedSlugs: readonly string[]): PageSelectionResult {
  const requested = new Set(selectedSlugs);
  requested.add("home");
  const unknownSlugs = selectedSlugs.filter((slug) => pageFileForSlug(slug) === null);
  const kept = pageOrder.filter((file) => requested.has(slugForPageFile(file)));
  const excludedFiles = new Set(pageOrder.filter((file) => !kept.includes(file)));
  return { pageOrder: kept, excludedFiles, unknownSlugs };
}

/** Narrows `file.pageOrder` to `selection.pageOrder` — see this module's own doc comment for why
 *  that alone (not touching `file.pages`) is enough to keep an excluded page's fields away from the
 *  LLM entirely, in both `fillPlacementsFile`'s and `fillRealEstateTemplate`'s per-page loops. */
export function filterPlacementsFileToPages(file: PlacementsFile, selection: PageSelectionResult): PlacementsFile {
  return { ...file, pageOrder: selection.pageOrder };
}

/** A `<a>` styled as its own clickable control (a button, a "View Details →" link) rather than
 *  plain text wearing a link — removed outright when its target page is gone, rather than unwrapped
 *  into a stray text fragment sitting where a button used to be. Matches this project's own
 *  `btn`/`btn--*` classes and any BEM `__link`/`__cta` suffix (`service-card__link`, ...) — broad on
 *  purpose: a false "button-like" match only means one extra element removed instead of unwrapped,
 *  never a dead link left behind either way. */
const BUTTON_LIKE_CLASS_RE = /(?:^|\s)(?:btn(?:--[\w-]+)?|[\w-]*__(?:link|cta))(?:\s|$)/;

/** Removes every reference to an excluded page from `html` — see this module's own doc comment for
 *  the full reasoning. Safe to call on a page with nothing to prune (`excludedFiles` empty, or none
 *  of its links target an excluded page): returns `html` unchanged in the first case, and every
 *  other `<a>` is left completely untouched either way (`href` matching is exact-string, on the
 *  literal bare filenames every template in this folder already uses). */
export function pruneDanglingPageLinks(html: string, excludedFiles: ReadonlySet<string>): string {
  if (excludedFiles.size === 0) return html;
  const $ = cheerio.load(html, null, false);

  $("a[href]").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") ?? "";
    if (!excludedFiles.has(href)) return;

    const $li = $a.closest("li");
    if ($li.length > 0) {
      $li.remove();
      return;
    }

    if (BUTTON_LIKE_CLASS_RE.test($a.attr("class") ?? "")) {
      $a.remove();
    } else {
      $a.replaceWith($a.html() ?? $a.text());
    }
  });

  // A footer (or similar) column whose entire link list pointed at the one page just excluded
  // (real-estate-map.ts's footer "Property Types" column: 5 links, every one -> listings.html) is
  // left with a heading over an empty <ul> otherwise — remove the whole column, not just its links.
  $(".footer__col").each((_, col) => {
    const $col = $(col);
    if ($col.find("ul").length > 0 && $col.find("li").length === 0) {
      $col.remove();
    }
  });

  return $.html();
}
