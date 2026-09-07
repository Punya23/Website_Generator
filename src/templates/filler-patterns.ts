/**
 * Placeholder/filler text detection, shared between `copy-slots.ts` (the compose-time neutralizing
 * pass, which has `brief`/`role` context and rewrites what it finds) and `scanHtmlForFillerLeaks`
 * below (a ship-time, read-only gate over the FINAL composed HTML — no brief/role, deliberately: it
 * runs from `code-qa.ts` on a whole assembled page, independent of which pass should have caught
 * something and in what order, catching whatever survived regardless of why).
 */
import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";
import { looksLikeRawJson } from "../llm/parse-json.js";

/** Unmistakable markers — one is enough, none of these are English. */
export const LOREM_RE = /\b(lorem|ipsum|dolor sit amet|consectetur|adipisicing|adipiscing|eiusmod|tempor|incididunt|aliquip|commodo consequat|voluptate|excepteur|proident)\b/i;
/**
 * The rest of the standard lorem vocabulary. Templates very often ship a paragraph that never says
 * "lorem ipsum" at all — confirmed live on a real generated page: "Donec quam felis ultricies nec
 * pellentesque vulputate" shipped intact because it contains none of the markers above. Two or more
 * of these together is lorem; one alone is not enough to risk deleting a real sentence over.
 */
export const LATIN_FILLER_RE =
  /\b(donec|felis|ultricies|pellentesque|vulputate|nulla|vitae|quis|nunc|eget|mauris|elit|cras|curabitur|fringilla|aliquam|malesuada|imperdiet|porttitor|sagittis|euismod|congue|luctus|venenatis|tristique|sodales|convallis|facilisis|blandit|magna|neque|rhoncus|semper|varius|viverra|dapibus|posuere|lacinia|hendrerit|sollicitudin|suscipit|ullamcorper|pharetra|tincidunt)\b/gi;

export function looksLikeLorem(text: string): boolean {
  if (LOREM_RE.test(text)) return true;
  LATIN_FILLER_RE.lastIndex = 0;
  return (text.match(LATIN_FILLER_RE) ?? []).length >= 2;
}

/** A heading in the template author's own first-person voice ("We're a Creative Agency") is
 *  branded marketing copy, not a neutral structural label ("Our Services") — role alone cannot
 *  tell the two apart, so this checks the text itself. Confirmed live: a real Arup `features`
 *  section headline read this way and survived every other pass untouched. */
export const SELF_REFERENTIAL_HEADING_RE = /\b(we'?re|we are|our (team|company|story|mission|studio|agency)|who we are)\b/i;
/** House number + street type, with or without a trailing city/state/zip. The number allows a
 *  short unit/building letter prefix ("E44", "B12") and a following comma before the street name
 *  — confirmed live: a template's topbar address "E44, Design Street, Web Corner Melbourne."
 *  shipped unfixed on a real customer site because the old digit-only, comma-blind pattern never
 *  matched it — a fake, specific-looking street address is a worse leak than generic filler text. */
export const STREET_ADDRESS_RE = /\b[A-Za-z]{0,2}\d{1,5}[\s,]+[A-Za-z0-9.'-]+(\s+[A-Za-z0-9.'-]+){0,3}\s+(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|suite|ste|way|court|ct|plaza|pkwy)\b/i;
// The trailing `\b` used to sit outside the whole group, so it had to match right after "©" too —
// but `\b` needs a word char on exactly one side, and "©" followed by a space (the overwhelmingly
// common real pattern, "© 2026 Company") has non-word on both sides. It never matched. Confirmed
// live: a template's own "© 2026 Mediplace By Scriptfusions" footer credit shipped unchanged on
// every generated site — the symbol case was silently dead code from the start.
export const COPYRIGHT_RE = /(©|&copy;|\bcopyrights?\b)/i;

export const INLINE_TAGS = new Set([
  "br", "span", "b", "i", "em", "strong", "small", "a", "u", "sup", "sub", "mark", "abbr", "wbr",
]);

/** True when an element holds one run of copy — text plus at most inline formatting. */
export function isTextLeaf($: cheerio.CheerioAPI, el: cheerio.Cheerio<DomElement>): boolean {
  const children = el.children().toArray();
  if (children.length === 0) return true;
  return children.every((child) => {
    const tag = (child as { tagName?: string }).tagName?.toLowerCase() ?? "";
    return INLINE_TAGS.has(tag) && $(child).children().length === 0;
  });
}

export function elementSelector($: cheerio.CheerioAPI, node: unknown): string {
  const el = $(node as never);
  const id = el.attr("id");
  if (id) return `#${id}`;
  const tag = (node as { tagName?: string }).tagName?.toLowerCase() ?? "*";
  const cls = (el.attr("class") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
  return cls ? `${tag}.${cls}` : tag;
}

export interface FillerLeak {
  /** Which pattern matched — mirrors the `filler:*` change kinds `copy-slots.ts` records when it
   *  catches the same shape at compose time. */
  code: "lorem" | "copyright" | "selfReferentialHeading" | "streetAddress" | "rawJson";
  selector: string;
  sample: string;
}

const LEAK_SELECTOR = "p, span, li, div, h1, h2, h3, h4, h5, h6, blockquote, td, address";

/**
 * Non-mutating scan of already-final HTML for the same placeholder/filler shapes
 * `neutralizeTemplateFiller` rewrites at compose time — a true "did clean copy actually ship" gate
 * that doesn't depend on which compose-time pass should have caught it or in what order. Only the
 * context-free checks run here (no brief/role available at this call site): the narrative- and
 * long-heading catch-alls in `copy-slots.ts` need a business name and a section role to judge
 * safely and stay there.
 *
 * `businessName`, when given, is used for exactly one thing: telling a genuinely leaked copyright
 * credit apart from `neutralizeTemplateFiller`'s own correctly-substituted one. That rewrite always
 * produces `© <businessName>. All rights reserved.` — text that still matches `COPYRIGHT_RE` (it
 * still contains a `©`) — so without this, every single generated page's own correctly-fixed footer
 * copyright line was permanently, unconditionally flagged as a "leak," on 100% of generations
 * regardless of actual quality. Confirmed live: every real generation's QA output showed this exact
 * false positive on every page.
 */
export function scanHtmlForFillerLeaks(html: string, businessName?: string): FillerLeak[] {
  const $ = cheerio.load(html, null, false);
  const leaks: FillerLeak[] = [];
  const nameLower = businessName?.trim().toLowerCase();

  $(LEAK_SELECTOR).each((_, node) => {
    const el = $(node);
    if (!isTextLeaf($, el)) {
      // Mirrors `neutralizeTemplateFiller`'s own mixed-content lorem check (`copy-slots.ts`) — a
      // container mixing a direct text run with a nested block (a real footer-widget shape:
      // `<div>Lorem ipsum...<ul><li>real item</li></ul></div>`) is invisible to every check below,
      // which all require a leaf, so this is the QA-side safety net for the exact same gap.
      const domNode = el.get(0) as unknown as { children?: Array<{ type: string; data?: string }> } | undefined;
      const direct = (domNode?.children ?? [])
        .filter((child) => child.type === "text")
        .map((child) => child.data ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (direct && looksLikeLorem(direct)) {
        leaks.push({ code: "lorem", selector: elementSelector($, node), sample: direct.slice(0, 80) });
      }
      return;
    }
    const text = el.text().replace(/\s+/g, " ").trim();
    if (!text) return;

    if (looksLikeLorem(text)) {
      leaks.push({ code: "lorem", selector: elementSelector($, node), sample: text.slice(0, 80) });
      return;
    }
    // The literal live-site symptom that motivated this check: an LLM copy step's raw
    // `{"headline":"...","body":"..."}` (or a malformed retry's error prose it never should have
    // spliced) landing straight in a heading or paragraph because whatever validated it upstream
    // only checked "is this a string", not "does this actually read like copy". Catches any JSON
    // shape, not just one specific block-envelope regex.
    if (looksLikeRawJson(text)) {
      leaks.push({ code: "rawJson", selector: elementSelector($, node), sample: text.slice(0, 80) });
      return;
    }
    if (COPYRIGHT_RE.test(text)) {
      if (nameLower && text.toLowerCase().includes(nameLower)) return; // already this site's own credit
      leaks.push({ code: "copyright", selector: elementSelector($, node), sample: text.slice(0, 80) });
      return;
    }
    const isHeadingTag = /^h[1-6]$/i.test((node as { tagName?: string }).tagName ?? "");
    if (isHeadingTag && SELF_REFERENTIAL_HEADING_RE.test(text)) {
      leaks.push({ code: "selfReferentialHeading", selector: elementSelector($, node), sample: text.slice(0, 80) });
      return;
    }
    if (STREET_ADDRESS_RE.test(text) && text.length < 160) {
      leaks.push({ code: "streetAddress", selector: elementSelector($, node), sample: text.slice(0, 80) });
    }
  });

  return leaks;
}
