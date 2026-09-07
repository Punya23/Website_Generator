/**
 * Substitute the business's own copy into a verbatim section, by locator.
 *
 * A model never writes or rewrites markup here: ingest recorded which node holds which kind of
 * copy (`src/templates/ingest/classify-section.ts`), and this only swaps that node's text for a
 * value derived from the brief. Same tag, same classes, same position, same styling.
 *
 * Contact details are a deliberate special case. A template ships its author's real email and
 * phone number; shipping those on a generated customer site would publish a stranger's contact
 * details, so they are always replaced — with details found in the brief when it has them, and
 * with an obvious placeholder when it does not.
 */
import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";
import type { ExpandedBrief } from "../types.js";
import type { PhotoSlot, SectionRole, SlotLocator } from "./types.js";
import { LAZY_SRC_ATTRS } from "./ingest/photo-slots.js";
import {
  COPYRIGHT_RE,
  elementSelector,
  isTextLeaf,
  looksLikeLorem,
  SELF_REFERENTIAL_HEADING_RE,
  STREET_ADDRESS_RE,
} from "./filler-patterns.js";

const EMAIL_IN_BRIEF = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const PHONE_IN_BRIEF = /(\+?\d[\d\s().-]{7,}\d)/;

export interface CopyContext {
  brief: ExpandedBrief;
  /** Raw brief text — contact details usually live here rather than in the structured fields. */
  rawBrief: string;
  role: SectionRole;
  /** The business's own uploaded logo, if any (`ctx.logoSrc` — same field the rest of the app
   *  already populates from an uploaded file). When present, an image-logo slot keeps its `<img>`
   *  and just repoints `src` at it, preserving the template's own logo sizing/placement CSS.
   *  Absent, it falls back to a text wordmark rather than shipping the template author's mark. */
  logoSrc?: string;
  /** Shared across every section composed onto the SAME page, so a heading/narrative fallback
   *  never writes a string this page has already used elsewhere. Omit for an isolated call (each
   *  unit test gets its own fresh state, matching the old always-first-candidate behavior); a
   *  real page composition threads one instance through every section it places — see
   *  `createCopyRunState()` and its use in `compose.ts`. */
  runState?: CopyRunState;
}

/** Cross-section, page-scoped memory for fallback copy: which fallback strings have already been
 *  written onto this page, and where the rotation through the brief's sentence pool last left off.
 *  Fixes the collapse where every unclaimed heading and every filler paragraph independently
 *  defaulted to the same first candidate (`brief.tagline`, or `sentences[0]`) — confirmed live: one
 *  real generation wrote the identical sentence into a sectionHeading, a sectionBody, a
 *  filler:narrative AND a filler:longHeading, all within reach of one page. */
export interface CopyRunState {
  usedStrings: Set<string>;
  cursor: number;
}

export function createCopyRunState(): CopyRunState {
  return { usedStrings: new Set(), cursor: 0 };
}

/** Walk `pool` starting from the shared cursor, returning the first candidate this page has not
 *  already used. Every pool is small (a handful of sentences/headings), so a full pass costs
 *  nothing. When the whole pool is already spoken for, a repeat is still better than emitting
 *  nothing — text still has to go in that slot. */
function nextFreshText(pool: string[], state: CopyRunState, fallback: string): string {
  if (pool.length === 0) {
    state.usedStrings.add(fallback);
    return fallback;
  }
  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const candidate = pool[state.cursor % pool.length]!;
    state.cursor += 1;
    if (!state.usedStrings.has(candidate)) {
      state.usedStrings.add(candidate);
      return candidate;
    }
  }
  const repeat = pool[state.cursor % pool.length]!;
  state.cursor += 1;
  return repeat;
}

/** Candidates for a heading-shaped fallback (a template's own marketing headline the site cannot
 *  keep) — the tagline first since it is the shortest, most heading-like real copy the brief has,
 *  then the same rotating sentence pool `neutralizeTemplateFiller` draws narrative fallbacks from,
 *  deduped so the tagline is not offered twice if it happens to also appear as a full sentence. */
function headingFallbackPool(brief: ExpandedBrief): string[] {
  return [...new Set([brief.tagline, ...briefSentences(brief)])];
}

export interface BusinessContact {
  email: string;
  phone: string;
  emailFromBrief: boolean;
  phoneFromBrief: boolean;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function businessSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
}

export function resolveContact(brief: ExpandedBrief, rawBrief: string): BusinessContact {
  const email = rawBrief.match(EMAIL_IN_BRIEF)?.[0];
  const phoneRaw = rawBrief.match(PHONE_IN_BRIEF)?.[0];
  const phone = phoneRaw && phoneRaw.replace(/\D/g, "").length >= 7 ? phoneRaw.trim() : undefined;
  return {
    email: email ?? `hello@${businessSlug(brief.businessName)}.com`,
    phone: phone ?? "+1 (000) 000-0000",
    emailFromBrief: Boolean(email),
    phoneFromBrief: Boolean(phone),
  };
}

/** The one role whose body prose must never be swapped for brief copy: a testimonial quote has no
 *  legitimate source in the brief, so fabricating one attributed as a real customer's words is a
 *  fake-reviews problem, not a copy-slot-filling one — carved out deliberately, not an oversight.
 *  Every other role's leftover paragraph-length prose is the template author's own filler about
 *  their fictional company/product (confirmed live across "features", "stats", and "story"
 *  sections alike — a nonprofit's "We Are An Organization Engaged In Tree Planting…" survived
 *  under a numbered-steps "features" section because the old allowlist only covered
 *  hero/story/cta/contact), so this is a denylist now, not an allowlist. */
const NO_NARRATIVE_SUBSTITUTION_ROLES = new Set<SectionRole>(["testimonials"]);

/**
 * `nextFreshText`'s dedup only ever sees text THROUGH it — a slot resolved directly to a fixed
 * brief field (tagline, elevatorPitch) never registers as "used," so a later unclaimed heading in
 * the SAME section can independently fall back onto the exact same string a sibling slot already
 * placed a few nodes away. Confirmed live: a hero with both a `tagline` slot and an unclaimed
 * long heading showed the identical sentence twice, back to back — for a brief with no distinctly
 * written tagline, `expandBriefFromInput` derives `tagline` from the same source clause
 * `elevatorPitch` does, so even cross-field collisions are real, not just same-pool reuse. Marking
 * a directly-resolved value used the moment it is placed closes that gap without touching the
 * rotation pools themselves.
 */
function markUsed(context: CopyContext, value: string): string {
  context.runState?.usedStrings.add(value);
  return value;
}

function valueForSlot(slot: SlotLocator, context: CopyContext, contact: BusinessContact): string | null {
  const { brief, role } = context;
  const index = slot.groupIndex ?? 0;

  switch (slot.kind) {
    case "businessName":
      return brief.businessName;
    case "tagline":
      return markUsed(context, brief.tagline);
    case "email":
      return contact.email;
    case "phone":
      return contact.phone;
    case "primaryCta":
      return brief.primaryCta;
    case "pageTitle":
      return `${brief.businessName} — ${brief.tagline}`;
    case "serviceItemTitle":
      // Cycle rather than clamp: a template with 6 service cards and a brief with 2 services used
      // to leave cards 3-6 with the template author's own demo service names untouched (a `null`
      // here is a silent skip, not "nothing to say" — see `applyCopySlots`). Repeating the brief's
      // real services is a real business's own copy on every card; a stranger's is not.
      return brief.services.length > 0 ? brief.services[index % brief.services.length]! : null;
    case "serviceItemBody":
      // Same cycling fix — a differentiator is real business copy and reads correctly under a
      // service heading, repeated is still better than a leftover template demo description.
      return brief.differentiators.length > 0
        ? brief.differentiators[index % brief.differentiators.length]!
        : null;
    case "sectionBody":
      // Denylist, not allowlist — matches `neutralizeTemplateFiller`'s own narrative-substitution
      // rule below. This used to be a 5-role allowlist (hero/story/cta/contact/features), so a
      // sectionBody slot CLASSIFIED (not just left alone) in a pricing/faq/team/stats/gallery
      // section returned null here — skipped by this pass entirely, relying on the second-pass
      // filler sweep to still catch it (which it usually does, but only for text over 60 chars; a
      // short classified sectionBody could fall through both). Only testimonials — no legitimate
      // brief-sourced substitute for a customer's own words — stays carved out.
      return NO_NARRATIVE_SUBSTITUTION_ROLES.has(role) ? null : markUsed(context, brief.elevatorPitch);
    case "address":
      // Never invent a street address, and never keep the template author's.
      return null;
    case "sectionHeading": {
      // A genuine structural label ("Our Services", "FAQ", "Working Hours", "Getting Here") is
      // short — 1-3 words, no real section label runs a full clause. A longer heading is almost
      // always the template author's own marketing headline instead (confirmed live: a
      // "features" section's own "Comprehensive Pool Cleaning Service" (4 words) and "Medical
      // Goods Are Your Devoted Partners" (6 words) — both third-person, so the self-referential
      // check below never caught them). Word count is an imperfect but safe proxy: it has
      // produced no false match against this codebase's own short-label vocabulary.
      const words = slot.originalText.trim().split(/\s+/).filter(Boolean).length;
      if (words < 4) return null;
      const state = context.runState ?? createCopyRunState();
      return nextFreshText(headingFallbackPool(brief), state, brief.tagline);
    }
    default:
      return null;
  }
}

/** Replace an element's visible text without destroying its child markup (icons, links, spans). */
function setText(
  $: cheerio.CheerioAPI,
  selector: string,
  value: string,
  attr?: string,
  logoSrc?: string
): boolean {
  const el = $(selector).first();
  if (el.length === 0) return false;

  if (attr) {
    // An image logo is the template author's brand rendered as pixels. With a real uploaded logo
    // to point at, the `<img>` stays an `<img>` — just repointed — so the template's own logo
    // sizing/placement CSS keeps applying. Without one, rewriting `alt` alone still leaves another
    // company's mark rendered in pixels, so it becomes the business's name as text instead.
    if (attr === "alt" && (el.get(0) as { tagName?: string } | undefined)?.tagName?.toLowerCase() === "img") {
      if (logoSrc) {
        el.attr("src", logoSrc);
        el.removeAttr("srcset");
        el.attr("alt", value);
        return true;
      }
      el.replaceWith(`<span class="${el.attr("class") ?? ""} tpl-wordmark">${escapeText(value)}</span>`);
      return true;
    }
    el.attr(attr, value);
    return true;
  }

  const inner = el.find("a, span, strong, em, h1, h2, h3, h4, h5, h6, p").filter((_, node) => {
    const child = $(node);
    return child.children().length === 0 && child.text().trim().length > 0;
  });

  if (el.children().length === 0) {
    el.text(value);
    return true;
  }
  if (inner.length > 0) {
    inner.first().text(value);
    return true;
  }
  // Mixed content: replace only the element's own direct text nodes, leaving children intact.
  const node = el.get(0) as unknown as { children?: Array<{ type: string; data?: string }> };
  const textNodes = (node.children ?? []).filter((child) => child.type === "text" && (child.data ?? "").trim());
  if (textNodes.length > 0) {
    textNodes[0]!.data = value;
    for (const extra of textNodes.slice(1)) extra.data = "";
    return true;
  }
  el.text(value);
  return true;
}

/** Sentences from the brief, cycled through placeholder paragraphs. Deterministic — the same
 *  section always gets the same replacement, which keeps regenerations stable. */
function briefSentences(brief: ExpandedBrief): string[] {
  const fromBrief = brief.expandedBrief
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 30);
  return [brief.elevatorPitch, ...fromBrief, ...brief.differentiators, brief.targetAudience].filter(
    (line) => line && line.length > 12
  );
}

/** One substitution the site's generation record can show verbatim — "here is exactly what
 *  changed, from what, to what" — the answer to "what was changed" for a stored generation. */
export interface CopyChange {
  /** A real `SlotKind`, or a `filler:*` label for a second-pass rewrite the locators never
   *  claimed (lorem, copyright credit, a branded heading, a leaked address, narrative prose). */
  kind: string;
  selector: string;
  before: string;
  after: string;
}

/** An element's own direct text-node content, ignoring any nested element children entirely —
 *  the mixed-content counterpart to `el.text()`, which includes every descendant's text too. */
function directOwnText(el: cheerio.Cheerio<DomElement | null>): string {
  const node = el.get(0) as unknown as { children?: Array<{ type: string; data?: string }> } | undefined;
  return (node?.children ?? [])
    .filter((child) => child.type === "text")
    .map((child) => child.data ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Overwrites only `el`'s own direct text nodes with `value`, leaving every element child (a
 *  nested `<ul>`, an icon `<i>`) completely untouched — same shape as `setText`'s own "mixed
 *  content" branch above, extracted here so `neutralizeTemplateFiller`'s filler sweep can rewrite a
 *  container's leftover blurb without wiping the real list/markup sitting next to it. */
function replaceDirectOwnText(el: cheerio.Cheerio<DomElement | null>, value: string): boolean {
  const node = el.get(0) as unknown as { children?: Array<{ type: string; data?: string }> } | undefined;
  const textNodes = (node?.children ?? []).filter((child) => child.type === "text" && (child.data ?? "").trim());
  if (textNodes.length === 0) return false;
  textNodes[0]!.data = value;
  for (const extra of textNodes.slice(1)) extra.data = "";
  return true;
}

/**
 * Second substitution pass over text the slot locators did not claim.
 *
 * Templates are shipped full of the author's filler — lorem ipsum, their own street address, a
 * "Copyrights 2019 Template_mr" credit. None of that should survive onto a customer's site, and
 * the brief carries real copy that fits. Only placeholder-shaped text is touched; genuine
 * structural labels ("Our Services") are left exactly as the template wrote them.
 */
export function neutralizeTemplateFiller(
  $: cheerio.CheerioAPI,
  brief: ExpandedBrief,
  contact: BusinessContact,
  role?: SectionRole,
  runState?: CopyRunState
): { replaced: number; changes: CopyChange[] } {
  const sentences = briefSentences(brief);
  const headings = headingFallbackPool(brief);
  // Own state when the caller has no page-wide one to share (isolated call / unit test) — matches
  // the old behavior of always starting from the first candidate.
  const state = runState ?? createCopyRunState();
  let replaced = 0;
  const changes: CopyChange[] = [];
  const record = (kind: string, node: unknown, before: string, after: string): void => {
    changes.push({ kind: `filler:${kind}`, selector: elementSelector($, node), before, after });
  };

  $("p, span, li, div, h1, h2, h3, h4, h5, h6, blockquote, td, address").each((_, node) => {
    const el = $(node);
    // "Leaf" means no nested block: a paragraph broken by <br> or wrapped in <span>/<strong> is
    // still one run of copy, and template filler very often looks exactly like that.
    if (!isTextLeaf($, el)) {
      // A container mixing a direct text run with a nested block — confirmed live:
      // `<div class="textwidget">Lorem ipsum dolor sit amet...<ul><li>real list item</li></ul>
      // </div>`, a real footer-widget shape — is invisible to every check below, all of which
      // require `isTextLeaf`, so the leftover blurb shipped forever regardless of role or brief.
      // Only the lorem check runs here (the one confirmed-live shape, and the one pattern safe to
      // recognize without also knowing the section's role): the direct text node is rewritten in
      // place, the nested block beneath it is never touched.
      const direct = directOwnText(el);
      if (direct && looksLikeLorem(direct)) {
        const replacement = nextFreshText(sentences, state, brief.elevatorPitch);
        const after = direct.length < 60 ? replacement.slice(0, 90) : replacement;
        if (replaceDirectOwnText(el, after)) {
          replaced += 1;
          record("lorem", node, direct, after);
        }
      }
      return;
    }
    const text = el.text().replace(/\s+/g, " ").trim();
    if (!text) return;

    // This exact run is already the business's own directly-slotted copy (a `tagline` or
    // `sectionBody` slot elsewhere in this section resolved to one of these two fields — see
    // `markUsed` in `valueForSlot`) — never filler, by definition, so none of the checks below may
    // touch it. Without this guard: a tagline short enough to also look like a "long heading" (>=4
    // words, no business name) got re-caught by the longHeading catch-all a few lines down and
    // overwritten AGAIN with a *different* fallback, because marking `tagline` "used" (so a
    // genuinely different sibling heading wouldn't repeat it) made its own home node ineligible to
    // fall back onto itself the way it silently, harmlessly did before that dedup fix existed.
    // Confirmed live via a regression test that failed until this guard was added.
    if (text === brief.tagline || text === brief.elevatorPitch) return;

    if (looksLikeLorem(text)) {
      const replacement = nextFreshText(sentences, state, brief.elevatorPitch);
      const after = text.length < 60 ? replacement.slice(0, 90) : replacement;
      el.text(after);
      replaced += 1;
      record("lorem", node, text, after);
      return;
    }

    if (COPYRIGHT_RE.test(text)) {
      const after = `© ${brief.businessName}. All rights reserved.`;
      el.text(after);
      replaced += 1;
      record("copyright", node, text, after);
      return;
    }

    const isHeadingTag = /^h[1-6]$/i.test((node as { tagName?: string }).tagName ?? "");

    if (SELF_REFERENTIAL_HEADING_RE.test(text) && isHeadingTag) {
      const after = nextFreshText(headings, state, brief.tagline);
      el.text(after);
      replaced += 1;
      record("selfReferentialHeading", node, text, after);
      return;
    }

    // A ≥4-word heading anywhere in a non-testimonial section, missed by every slot locator, is
    // almost always a repeated card's own title — the same signal the `sectionHeading` slot case
    // uses, applied here as a catch-all for cards the locators never found. Confirmed live: a
    // pediatric clinic's "Long Term Care Services" card heading (a bare `<h4>` inside a card class
    // — "single-benefit", "perk-item", endless real naming — that the fixed CARD_SELECTOR keyword
    // list did not recognize) shipped unchanged on a roofing site because no slot ever claimed it.
    if (
      role &&
      role !== "testimonials" &&
      isHeadingTag &&
      text.split(/\s+/).filter(Boolean).length >= 4 &&
      !text.includes(brief.businessName)
    ) {
      const after = nextFreshText(headings, state, brief.tagline);
      el.text(after);
      replaced += 1;
      record("longHeading", node, text, after);
      return;
    }

    // The template author's own postal address must never ship on a customer's site.
    if (STREET_ADDRESS_RE.test(text) && text.length < 160) {
      el.text(brief.businessName);
      replaced += 1;
      record("address", node, text, brief.businessName);
      return;
    }

    // Any email/phone the locators missed still has to stop pointing at the template author.
    if (EMAIL_IN_BRIEF.test(text) && text.length < 120) {
      const after = text.replace(EMAIL_IN_BRIEF, contact.email);
      el.text(after);
      replaced += 1;
      record("email", node, text, after);
      return;
    }

    // Prose in a section that is inherently about the business ("Our creative team is our
    // favorite team…") describes the template author's fictional company, not this one. Only
    // paragraph-length copy in those roles is swapped — headings and labels stay structural.
    //
    // Used to require the element itself be a `<p>` or `<blockquote>` — stricter than the
    // selector this whole pass already runs under (`div`/`span`/`li`/etc. are all in scope, line
    // 341 below), so a genuine leftover marketing paragraph sitting in a `<div>` or `<span>` (very
    // common in card-based templates — confirmed live) was never caught here even though every
    // other check in this pass already applies to it. `isTextLeaf` already guarantees "one run of
    // copy" by this point, so any leaf tag qualifies, not just `p`/`blockquote`.
    if (
      role &&
      !NO_NARRATIVE_SUBSTITUTION_ROLES.has(role) &&
      text.length > 60 &&
      !text.includes(brief.businessName)
    ) {
      const after = nextFreshText(sentences, state, brief.elevatorPitch);
      el.text(after);
      replaced += 1;
      record("narrative", node, text, after);
    }
  });

  return { replaced, changes };
}

export interface SubstitutionResult {
  html: string;
  applied: number;
  skipped: number;
  /** Placeholder/filler nodes rewritten by the second pass. */
  filler: number;
  /** Of `skipped`, how many were a slot's own selector throwing when resolved against this
   *  section's cached HTML — markup drift since ingest, not "the brief had nothing to say here".
   *  Folded into `skipped` too (nothing downstream is gated on this split), but logged separately
   *  so ingest-selector drift is a visible signal instead of hiding inside the same counter as
   *  every other reason a slot went unfilled. */
  selectorErrors: number;
  /** Every substitution actually made, slot-based and filler-pass alike — what a stored
   *  generation record shows for "what was changed" on this section. */
  changes: CopyChange[];
}

export function applyCopySlots(
  html: string,
  slots: SlotLocator[],
  context: CopyContext,
  contact = resolveContact(context.brief, context.rawBrief)
): SubstitutionResult {
  const $ = cheerio.load(html, null, false);
  let applied = 0;
  let skipped = 0;
  let selectorErrors = 0;
  const changes: CopyChange[] = [];
  // One shared runState for every slot AND the filler pass below, so a second unclaimed heading
  // in this same section does not re-collapse onto the first one's fallback text. Callers that
  // compose a whole page pass their own (see `compose.ts`) so the dedup reaches across sections.
  const runState = context.runState ?? createCopyRunState();
  const scopedContext: CopyContext = { ...context, runState };

  for (const slot of slots) {
    const value = valueForSlot(slot, scopedContext, contact);
    if (value === null) {
      // A contact slot with nothing to put in it must still not ship the original — drop the node.
      if (slot.kind === "address") {
        const el = $(slot.selector).first();
        if (el.length > 0) {
          el.text(`${context.brief.businessName}`);
          applied += 1;
          changes.push({ kind: slot.kind, selector: slot.selector, before: slot.originalText, after: context.brief.businessName });
          continue;
        }
      }
      skipped += 1;
      continue;
    }
    try {
      if (setText($, slot.selector, value, slot.attr, context.logoSrc)) {
        applied += 1;
        changes.push({ kind: slot.kind, selector: slot.selector, before: slot.originalText, after: value });
        // Templates capitalize or upper-case decorative copy; applied to a real address that
        // renders "Hello@Cedarandco.Co.Uk". Case matters for these values, so opt them out.
        if (slot.kind === "email" || slot.kind === "phone") {
          const el = $(slot.selector).first();
          el.attr("style", `${el.attr("style") ?? ""};text-transform:none`.replace(/^;/, ""));
        }
      } else skipped += 1;
    } catch {
      // A selector that no longer resolves (markup changed under it) is skipped, never fatal —
      // but counted separately: this is ingest-time drift, not "the brief had nothing to say".
      skipped += 1;
      selectorErrors += 1;
    }
  }

  const filler = neutralizeTemplateFiller($, context.brief, contact, context.role, runState);
  changes.push(...filler.changes);

  // mailto:/tel: hrefs must follow the text, or the page still links the template author.
  $("a[href^='mailto:']").attr("href", `mailto:${contact.email}`);
  $("a[href^='tel:']").attr("href", `tel:${contact.phone.replace(/[^\d+]/g, "")}`);

  return { html: $.html(), applied, skipped, selectorErrors, filler: filler.replaced, changes };
}

/** Elements that hold one run of visible copy. Anything not in this list (a wrapper, a grid cell
 *  with nested blocks) is skipped by `anchorEditableText` — `isTextLeaf` filters the rest. */
const EDITABLE_TAGS =
  "p, span, li, a, button, h1, h2, h3, h4, h5, h6, blockquote, td, th, caption, figcaption, label, strong, em, small, div";

export interface EditAnchorResult {
  html: string;
  /** How many text runs were addressable. */
  anchored: number;
  /** How many carried a saved override that was written back in. */
  applied: number;
}

/**
 * Give every run of visible copy in a section a stable address, and apply any saved edit to it.
 *
 * Slot locators only cover the copy ingest could classify — a live generation showed 154 slot
 * substitutions against 120 second-pass filler rewrites, and neither covers the template text that
 * was left alone deliberately. Editing in the preview has to reach ALL of it, so addressing is by
 * document order within the section (`<sectionKey>#<ordinal>`) rather than by slot kind: the
 * section's markup is a fixed cached artifact and substitution never adds or removes elements, so
 * the same ordinal refers to the same run on every recompose.
 */
export function anchorEditableText(
  html: string,
  sectionKey: string,
  overrides?: Record<string, string>
): EditAnchorResult {
  const $ = cheerio.load(html, null, false);
  let anchored = 0;
  let applied = 0;

  $(EDITABLE_TAGS).each((_, node) => {
    const el = $(node);
    if (!isTextLeaf($, el)) return;
    if (!el.text().replace(/\s+/g, " ").trim()) return;
    const key = `${sectionKey}#${anchored}`;
    anchored += 1;
    el.attr("data-wg-edit", key);
    const override = overrides?.[key];
    if (override !== undefined) {
      el.text(override);
      applied += 1;
    }
  });

  return { html: $.html(), anchored, applied };
}

/** Resolves one photo slot to a final `src`; `null` leaves the template's own image untouched
 *  (e.g. no stock provider configured and no user photo left). */
export type PhotoResolver = (slot: PhotoSlot, index: number) => Promise<string | null>;

export interface PhotoSubstitutionResult {
  html: string;
  applied: number;
  skipped: number;
  changes: CopyChange[];
}

/**
 * Content photography is a mechanical `src` swap, same shape as text substitution, but inherently
 * asynchronous (a stock-provider lookup or a user-uploaded-file read) — kept as a separate pass
 * from `applyCopySlots` rather than folded in, since that one stays synchronous.
 */
export async function applyPhotoSlots(
  html: string,
  photoSlots: PhotoSlot[],
  resolve: PhotoResolver
): Promise<PhotoSubstitutionResult> {
  if (photoSlots.length === 0) return { html, applied: 0, skipped: 0, changes: [] };
  const $ = cheerio.load(html, null, false);
  let applied = 0;
  let skipped = 0;
  const changes: CopyChange[] = [];

  for (const [index, slot] of photoSlots.entries()) {
    const el = $(slot.selector).first();
    if (el.length === 0) {
      skipped += 1;
      continue;
    }
    let url: string | null;
    try {
      url = await resolve(slot, index);
    } catch {
      url = null;
    }
    if (!url) {
      skipped += 1;
      continue;
    }
    if (slot.kind === "background") {
      const style = el.attr("style") ?? "";
      const before = style.match(/background-image\s*:\s*url\(([^)]*)\)/i)?.[1] ?? "(none)";
      const rewritten = /background-image\s*:\s*url\(/i.test(style)
        ? style.replace(/background-image\s*:\s*url\([^)]*\)/i, `background-image: url(${url})`)
        : `${style};background-image: url(${url})`.replace(/^;/, "");
      el.attr("style", rewritten);
      changes.push({ kind: "photo:background", selector: slot.selector, before, after: url });
    } else {
      const before = el.attr("src") ?? "(none)";
      el.attr("src", url);
      el.removeAttr("srcset");
      // Lazy-load attributes (see `ingest/photo-slots.ts`'s `effectiveImgSrc`) are how ingest found
      // this slot's real dimensions in the first place when `src` itself was a blank/placeholder —
      // stripped here so nothing still reads them, and so a dropped source-tree path they held
      // doesn't linger in shipped markup.
      for (const attr of LAZY_SRC_ATTRS) el.removeAttr(attr);
      if (!el.attr("alt")) el.attr("alt", "Photograph");
      changes.push({ kind: "photo:img", selector: slot.selector, before, after: url });
    }
    applied += 1;
  }

  return { html: $.html(), applied, skipped, changes };
}
