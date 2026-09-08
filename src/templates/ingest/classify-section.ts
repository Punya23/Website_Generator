/**
 * Section role + copy-slot classification.
 *
 * Deterministic first, model second — the same "measured beats guessed" split the GitHub ingest
 * mapper already uses (`src/admin/llm-map-recipe.ts`). At 1000+ templates × ~10 sections the LLM
 * has to be the exception, not the rule, so it is only consulted when tag/id/class/heading
 * evidence leaves the role genuinely unresolved.
 *
 * Copy slots are located deterministically (mailto:/tel: links, logo text, the first heading, CTA
 * buttons, repeated service cards). A model is never asked to write markup, and any selector it
 * suggests is validated against the section before being trusted.
 */
import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";
import { llm } from "../../llm/client.js";
import { inferLandmark } from "../../admin/extract-outline.js";
import { templateClassifyModel, templateClassifyUseLlm } from "../config.js";
import { SECTION_ROLES, type SectionRole, type SlotLocator } from "../types.js";
import type { RawSection } from "./extract-sections.js";

export interface SectionClassification {
  role: SectionRole;
  confidence: number;
  source: "heuristic" | "llm";
  slots: SlotLocator[];
}

const ROLE_FROM_LANDMARK: Record<string, SectionRole> = {
  hero: "hero",
  features: "features",
  story: "story",
  gallery: "gallery",
  testimonials: "testimonials",
  pricing: "pricing",
  faq: "faq",
  cta: "cta",
  contact: "contact",
  team: "team",
  stats: "stats",
  other: "other",
};

/** Direct id/class evidence beats heading text — template authors name the wrapper for what it is. */
const ID_CLASS_RULES: Array<{ role: SectionRole; re: RegExp }> = [
  { role: "hero", re: /\b(hero|banner|masthead|jumbotron|slider|intro-area)\b/i },
  { role: "features", re: /\b(service|feature|offer|what-we|solution|expertise|skill)\b/i },
  { role: "story", re: /\b(about|story|process|how-it-works|why-us|resume|experience)\b/i },
  { role: "gallery", re: /\b(gallery|portfolio|project|work|case-stud|showcase)\b/i },
  { role: "testimonials", re: /\b(testimonial|review|feedback|client-say)\b/i },
  { role: "pricing", re: /\b(pricing|price|plan|package)\b/i },
  { role: "faq", re: /\b(faq|question|accordion)\b/i },
  { role: "team", re: /\b(team|staff|member|people)\b/i },
  { role: "stats", re: /\b(counter|stat|fact|achievement|number)\b/i },
  { role: "contact", re: /\b(contact|enquiry|get-in-touch|appointment|book)\b/i },
  { role: "cta", re: /\b(cta|subscribe|newsletter|call-to-action|get-started)\b/i },
];

export function classifyRoleHeuristically(section: RawSection): { role: SectionRole; confidence: number } {
  if (section.tag === "footer") return { role: "footer", confidence: 0.95 };
  if (section.tag === "nav") return { role: "nav", confidence: 0.95 };
  if (section.tag === "header") {
    // A <header> holding the site nav is chrome; one holding a headline is the hero. Real
    // templates name this wrapper many ways — confirmed live against the actual corpus, two common
    // ones slipped through the original word-list check entirely:
    //   - Bootstrap's own canonical nav class, "navbar", is glued to "nav" with no separator, so
    //     `\bnav\b` never matches it (a huge miss: "navbar" is one of the most common nav class
    //     names in the wild).
    //   - an underscore-joined prefix like "site_header"/"ak-site_header" ("_" is a `\w` character,
    //     so `\bheader\b` finds no word boundary immediately before "header" in "site_header").
    // Both left a template's real, usable nav bar classified as an extra "hero" section instead of
    // "nav" — which made the template ineligible to ever anchor a site at all (an anchor needs
    // nav+hero+footer coverage, see select.ts's `fullyCoversRequired`) even though a real nav
    // existed on disk the whole time. Normalized the same way `ID_CLASS_RULES` below already does.
    const idClass = `${section.id} ${section.className}`.replace(/[_]+/g, "-");
    const looksLikeNav = /\b(nav|navbar|menu|header)\b/i.test(idClass);
    return { role: looksLikeNav ? "nav" : "hero", confidence: looksLikeNav ? 0.9 : 0.6 };
  }

  const idClass = `${section.id} ${section.className}`.replace(/[_]+/g, "-");
  for (const rule of ID_CLASS_RULES) {
    if (rule.re.test(idClass)) return { role: rule.role, confidence: 0.85 };
  }

  const fromHeading = ROLE_FROM_LANDMARK[inferLandmark(section.headingText)] ?? "other";
  if (fromHeading !== "other") return { role: fromHeading, confidence: 0.6 };

  const fromText = ROLE_FROM_LANDMARK[inferLandmark(section.text.slice(0, 200))] ?? "other";
  if (fromText !== "other") return { role: fromText, confidence: 0.45 };

  return { role: "other", confidence: 0.2 };
}

const CTA_TEXT_RE = /\b(contact|book|call|hire|get in touch|get started|quote|enquir|appointment|order|buy|subscribe|learn more|read more|view more|discover)\b/i;

function firstMatchSelector($: cheerio.CheerioAPI, node: DomElement, root: cheerio.Cheerio<never>): string | null {
  // Prefer a stable, unique-within-section selector: id, then tag+class path, then nth-of-type.
  const id = $(node).attr("id");
  if (id) return `#${cssEscape(id)}`;
  const parts: string[] = [];
  let current: DomElement | null = node;
  for (let depth = 0; current && depth < 4; depth++) {
    const tag = (current as { tagName?: string }).tagName?.toLowerCase() ?? "*";
    const parent: cheerio.Cheerio<DomElement> = $(current).parent();
    const position = parent.children(tag).toArray().indexOf(current);
    // A fragment's own root element has no positional siblings; `:nth-of-type(0)` would match
    // nothing, so the bare tag is used instead.
    parts.unshift(position >= 0 ? `${tag}:nth-of-type(${position + 1})` : tag);
    if (parent.length === 0 || parent.is(root as unknown as string)) break;
    current = parent.get(0) ?? null;
  }
  const selector = parts.join(" > ");
  return selector || null;
}

function cssEscape(value: string): string {
  return value.replace(/([^\w-])/g, "\\$1");
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
/** Template authors name the brand wrapper many ways (`.logo`, `.navbar-brand`,
 *  `.main-menu-wrapper__logo`, `.site-title`), so this matches on substring and the first hit in
 *  a chrome section wins — narrow enough not to catch a client-logo carousel in a content band. */
const LOGO_SELECTOR = "[class*='logo'], [class*='brand'], [id*='logo'], .site-title";
const CTA_SELECTOR = "a.btn, .btn > a, a.button, a.theme-btn, .theme-btn > a, button.btn, a[class*='btn']";
const CARD_SELECTOR = "[class*='card'], [class*='item'], [class*='box'], [class*='service'], [class*='feature'], [class*='col-']";

/**
 * Locate substitutable copy without an LLM. Links carry their own semantics (`mailto:`/`tel:`),
 * headings are positional, and repeated card structures are found by class signature. A model is
 * never asked for a selector, so a slot either resolves against the real markup or is not created.
 */
export function locateSlots(html: string, role: SectionRole): SlotLocator[] {
  const $ = cheerio.load(html, null, false);
  const root = $.root() as unknown as cheerio.Cheerio<never>;
  const slots: SlotLocator[] = [];
  const claimed = new Set<string>();

  const push = (
    kind: SlotLocator["kind"],
    node: DomElement,
    extra?: { groupIndex?: number; attr?: string; fallbackText?: string }
  ): void => {
    const selector = firstMatchSelector($, node, root);
    if (!selector) return;
    const raw = extra?.attr
      ? ($(node).attr(extra.attr) ?? "").trim()
      : $(node).text().replace(/\s+/g, " ").trim();
    const text = raw || (extra?.fallbackText ?? "");
    if (!text || text.length > 400) return;
    const dedupeKey = `${selector}|${extra?.attr ?? ""}`;
    if (claimed.has(dedupeKey)) return;
    claimed.add(dedupeKey);
    slots.push({
      kind,
      selector,
      originalText: text,
      ...(extra?.groupIndex === undefined ? {} : { groupIndex: extra.groupIndex }),
      ...(extra?.attr ? { attr: extra.attr } : {}),
    });
  };

  // Contact details, wherever they appear.
  $("a[href^='mailto:']").each((_, node) => push("email", node));
  $("a[href^='tel:']").each((_, node) => push("phone", node));
  $("p, span, li, h4, h5, h6, div").each((_, node) => {
    const el = $(node);
    if (el.children().length > 0) return; // leaf text nodes only
    const text = el.text().replace(/\s+/g, " ").trim();
    if (!text || text.length > 120) return;
    if (EMAIL_RE.test(text)) push("email", node);
    else if (PHONE_RE.test(text) && /\d{7}/.test(text.replace(/\D/g, ""))) push("phone", node);
  });

  // Brand name: a text logo, or an image logo. An image logo is the template author's wordmark
  // rendered as pixels, so it is slotted even without an `alt` — composition swaps it for the
  // business's own name rather than shipping another brand's mark. Only chrome sections carry a
  // brand mark; elsewhere a "logo"-classed element is usually a client/partner strip.
  if (role === "nav" || role === "footer" || role === "hero") {
    const brand = $(LOGO_SELECTOR).first();
    const brandNode = brand.get(0);
    if (brandNode) {
      const img = brand.find("img").first();
      const imgNode = img.get(0) ?? (brand.is("img") ? brandNode : undefined);
      if (imgNode) push("businessName", imgNode, { attr: "alt", fallbackText: img.attr("alt") || "logo" });
      else if (brand.text().trim()) push("businessName", brandNode);
    }
  }

  // Every section gets its own heading/lead-paragraph slots — this is what makes broad copy
  // substitution possible without a model ever rewriting markup.
  const heading = $("h1, h2, h3").first().get(0);
  if (heading) push(role === "hero" ? "tagline" : "sectionHeading", heading);
  const lead = $("p").filter((_, node) => $(node).text().trim().length > 40).first().get(0);
  if (lead) push("sectionBody", lead);

  // A hero's main button is the site's primary action whatever the template author labelled it
  // ("Digital Agency"); elsewhere only recognisably action-shaped labels are claimed.
  const ctaCandidates = $(CTA_SELECTOR).filter((_, node) => {
    const label = $(node).text().replace(/\s+/g, " ").trim();
    return label.length > 1 && label.length < 40;
  });
  const cta =
    ctaCandidates.filter((_, node) => CTA_TEXT_RE.test($(node).text())).first().get(0) ??
    (role === "hero" || role === "cta" ? ctaCandidates.first().get(0) : undefined);
  if (cta) push("primaryCta", cta);

  // Repeated card structures: group candidates by class signature, take the largest group.
  const groups = new Map<string, DomElement[]>();
  $(CARD_SELECTOR).each((_, node) => {
    const el = $(node);
    const cardHeading = el.find("h2, h3, h4, h5, h6").first();
    if (cardHeading.length === 0) return;
    const key = (el.attr("class") ?? "").split(/\s+/).sort().join(" ");
    if (!key) return;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  });
  const cards = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (cards && cards.length >= 2) {
    cards.forEach((card, index) => {
      const titleNode = $(card).find("h2, h3, h4, h5, h6").first().get(0);
      if (titleNode) push("serviceItemTitle", titleNode, { groupIndex: index });
      const bodyNode = $(card)
        .find("p")
        .filter((_, node) => $(node).text().trim().length > 15)
        .first()
        .get(0);
      if (bodyNode) push("serviceItemBody", bodyNode, { groupIndex: index });
    });
  }

  if (role === "contact" || role === "footer") {
    const address = $("address").first().get(0);
    if (address) push("address", address);
  }

  return slots;
}

const CLASSIFY_SYSTEM = `You label sections of an existing HTML website template.
Return JSON only: {"role": "<one of the allowed roles>", "confidence": 0-1}
Allowed roles: ${SECTION_ROLES.join(", ")}
You never write, rewrite, or copy HTML or CSS. You only choose a label.`;

/** Model fallback used only when the deterministic pass could not resolve the role. */
async function classifyRoleWithLlm(section: RawSection): Promise<{ role: SectionRole; confidence: number } | null> {
  if (!templateClassifyUseLlm() || !llm.isAvailable) return null;
  try {
    const raw = await llm.chat(
      CLASSIFY_SYSTEM,
      JSON.stringify({
        tag: section.tag,
        id: section.id,
        class: section.className,
        heading: section.headingText,
        text: section.text.slice(0, 400),
      }),
      { jsonMode: true, temperature: 0.2, tokenRole: "composition", model: templateClassifyModel() }
    );
    const parsed = JSON.parse(raw) as { role?: string; confidence?: number };
    const role = SECTION_ROLES.includes(parsed.role as SectionRole) ? (parsed.role as SectionRole) : null;
    if (!role) return null;
    const confidence = typeof parsed.confidence === "number" ? Math.min(0.9, Math.max(0.3, parsed.confidence)) : 0.6;
    return { role, confidence };
  } catch {
    return null;
  }
}

export async function classifySection(section: RawSection, html: string): Promise<SectionClassification> {
  const heuristic = classifyRoleHeuristically(section);
  if (heuristic.confidence >= 0.6) {
    return { ...heuristic, source: "heuristic", slots: locateSlots(html, heuristic.role) };
  }

  const fromLlm = await classifyRoleWithLlm(section);
  const resolved = fromLlm ?? heuristic;
  return {
    role: resolved.role,
    confidence: resolved.confidence,
    source: fromLlm ? "llm" : "heuristic",
    slots: locateSlots(html, resolved.role),
  };
}
