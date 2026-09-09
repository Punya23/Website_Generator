/**
 * The orchestration half of the placements pipeline: takes a page's already-extracted
 * `PagePlacements` plus resolved values and writes them into that page's real HTML — the one place
 * in this module allowed to touch markup, and the one place that enforces every `TextConstraints`
 * before a character reaches the DOM. A model (or a human, or a data feed) supplying a value never
 * means that value ships unchecked: too long is truncated at a word boundary, too short is rejected
 * outright and the template's own original copy is kept instead. This is what makes "never pass the
 * HTML to an LLM" safe in practice, not just true in principle — a well-behaved model's output is
 * respected, a misbehaving one cannot corrupt a page it never saw.
 *
 * `fixed`-sourced placements are never written, even if a caller's `llmValues` happens to carry a
 * value for that id — enforced here, not just by convention upstream.
 */
import * as cheerio from "cheerio";
import type { BriefField, ImagePlacement, PagePlacements, TextConstraints, TextPlacement } from "./schema.js";

export type PlacementBrief = Partial<Record<BriefField, string>>;

/** Resolves one `data`-sourced placement (a real listing fact, an agent's name, a customer
 *  testimonial) to a value, or `null` when no real record exists yet — `applyPlacements` then
 *  leaves the template's own (clearly fictional) demo value in place rather than inventing one.
 *  Async because a real implementation typically reads from the business's own database/CRM. */
export type DataResolver = (placement: TextPlacement | ImagePlacement) => string | null | Promise<string | null>;

export interface ApplyPlacementsOptions {
  brief: PlacementBrief;
  resolveData?: DataResolver;
  /** Model output (and/or human overrides), keyed by placement id. For an `llm` text placement
   *  this is the finished copy. For an `llmQuery` image placement this must ALREADY be a resolved
   *  photo URL — `fill.ts` does not itself talk to a stock-photo provider; resolve the model's
   *  search query (see `ImagePlacement.subject`) through your own provider first. */
  llmValues?: Record<string, string>;
  /** The TEMPLATE's own fictional business name (`PlacementsFile.templateName`, e.g. "Prestige
   *  Realty") — set this so a `data` placement with nothing real to resolve to at least stops
   *  naming a different company. A demo testimonial ("Prestige Realty found us a home...") is
   *  otherwise still literally correct output — the customer/quote is honestly fictional, exactly
   *  as designed — but it names the TEMPLATE's brand, not this site's, on every one of the four
   *  templates (confirmed live: all four name their own demo brand inside their fallback
   *  testimonial). Only a literal substring swap of this exact name, never a rewrite of anything
   *  else in the fallback text — the customer's name, quote and location stay the template's own
   *  fiction, same as always. */
  templateBusinessName?: string;
  /** Last-resort fallback for a `data` placement (after `resolveData` and the brand-name swap both
   *  come up empty) or a `brief` placement whose field has no value at all (`address`/`hours` only
   *  — see below) — a plausible, brief-consistent EXAMPLE value, explicitly not verified real data.
   *  `fill.ts` applies whatever this returns through the same constraint check as anything else;
   *  deciding what's safe to ask for is entirely the caller's call. It should never be asked for
   *  (and generate-real-site.ts's own use of this never asks for) a real person's name, photo, or
   *  quote — testimonials and agent identity stay `data`-locked with no illustrative fallback,
   *  same protection this project already gives the scraped-template corpus. */
  illustrativeFill?: DataResolver;
}

/** Unmistakably a placeholder, never a number that could ring an actual stranger — a plausible-
 *  looking fake phone number is a real-world harm a fake price or fake address is not. Same shape
 *  as this project's other pipeline's own placeholder (`copy-slots.ts`'s `resolveContact`). */
const PLACEHOLDER_PHONE = "+1 (000) 000-0000";

function slugifyBusinessName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
}

/** `hello@<business-slug>.com` — deterministic, not LLM-invented, for the same reason as the phone
 *  placeholder above: unlike a fake price or fake address, an invented email could plausibly exist
 *  and receive real mail meant for the actual business. */
function placeholderEmail(businessName: string | undefined): string {
  return `hello@${slugifyBusinessName(businessName ?? "business")}.com`;
}

/** `brief` fields `illustrativeFill` may be asked to invent an example for. Deliberately excludes
 *  `phone`/`email` (see `withPlaceholderContact` — those get a deterministic non-dialable/non-
 *  mailable placeholder instead, never an LLM-plausible one that could coincide with a real
 *  stranger's) and `licenseNumber` (a professional registration number is exactly the kind of
 *  official-looking credential that should never be plausibly fabricated — left as the template's
 *  own obviously-fake demo value, same as when nothing here is configured at all). */
const BRIEF_ILLUSTRATIVE_FIELDS = new Set<BriefField>(["address", "hours"]);

/** `brief` with phone/email defaulted to an obvious placeholder when the caller's own brief didn't
 *  supply one — computed once so every placement that reads phone/email (the plain `brief`
 *  placements, and the `callButton`/`phoneAndEmail` compositions below) sees the same value. */
function withPlaceholderContact(brief: PlacementBrief): PlacementBrief {
  return {
    ...brief,
    phone: brief.phone || PLACEHOLDER_PHONE,
    email: brief.email || placeholderEmail(brief.businessName),
  };
}

export interface ClampNote {
  id: string;
  reason: string;
}

export interface FillResult {
  html: string;
  appliedText: number;
  appliedImages: number;
  /** Placement ids whose selector no longer resolved against this HTML — markup drift since this
   *  placements file was generated, not "nothing to fill". */
  skipped: string[];
  /** Every value that was truncated or rejected for violating its own constraints. */
  clamped: ClampNote[];
  /** `fixed` placements a caller supplied a value for anyway — recorded, never applied. */
  rejectedFixed: string[];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Cuts `text` to at most `max` characters at a word boundary (never mid-word) and marks the cut
 *  with an ellipsis. Falls back to a hard character cut only when the last word boundary is too
 *  close to the start to leave anything meaningful (a pathologically long single "word"). */
function truncateAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, Math.max(0, max - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.4 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/** `null` means "reject this value outright, keep the template's original" — either it was too
 *  thin to trust (see `TextConstraints.minChars`'s own doc comment) or empty after trimming. */
function clampToConstraints(raw: string, constraints: TextConstraints, id: string, clamped: ClampNote[]): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length < constraints.minChars) {
    clamped.push({ id, reason: `rejected: ${trimmed.length} chars is under minChars ${constraints.minChars} — kept original` });
    return null;
  }
  if (trimmed.length > constraints.maxChars) {
    const truncated = truncateAtWordBoundary(trimmed, constraints.maxChars);
    clamped.push({ id, reason: `truncated ${trimmed.length} -> ${truncated.length} chars (maxChars ${constraints.maxChars})` });
    return truncated;
  }
  return trimmed;
}

/** The one substitution allowed on a `data` placement with nothing real to resolve to: replace a
 *  literal mention of the TEMPLATE's own fictional brand with this site's real one, changing
 *  nothing else about the fallback text. `null` when there is nothing to swap (no
 *  `templateBusinessName`/`brief.businessName` configured, or the original doesn't name it) — the
 *  caller's existing "nothing resolved, keep the original" behavior applies unchanged. */
function swapTemplateBrandName(original: string, options: ApplyPlacementsOptions): string | null {
  const from = options.templateBusinessName;
  const to = options.brief.businessName;
  if (!from || !to || !original.includes(from)) return null;
  return original.split(from).join(to);
}

/** `© <year> <businessName>. All rights reserved.` / `Call <phone>` / the leading text of the
 *  license line — the handful of spots where the visible text is a template LITERAL plus one
 *  business fact, not the fact alone. `phoneAndEmail` is handled separately in `applyPlacements`
 *  (it needs a `<br>` between two fields, which is markup, not plain text). */
function composedValue(compose: TextPlacement["compose"], brief: PlacementBrief): string | null {
  switch (compose) {
    case "footerCopyright":
      return brief.businessName ? `© ${new Date().getFullYear()} ${brief.businessName}. All rights reserved.` : null;
    case "footerLicense":
      // Reproduces the original's own " · " separator so the two preserved <a> links (Privacy
      // Policy, Terms) that follow this text node keep reading correctly — see `preserveChildren`.
      return brief.licenseNumber ? `${brief.licenseNumber} · ` : null;
    case "callButton":
      return brief.phone ? `Call ${brief.phone}` : null;
    default:
      return null;
  }
}

/** Writes `value` into the element `selector` resolves to. `preserveChildren` replaces only the
 *  element's own direct text node(s) (a functional link, a decorative icon glyph, both untouched);
 *  otherwise every child is cleared and `value` becomes the element's entire plain-text content —
 *  correct by construction for any LLM-sourced value, which never carries markup to begin with. */
function writeText($: cheerio.CheerioAPI, selector: string, value: string, preserveChildren?: boolean, attr?: string): boolean {
  const el = $(selector).first();
  if (el.length === 0) return false;
  if (attr) {
    el.attr(attr, value);
    return true;
  }
  if (preserveChildren) {
    const node = el.get(0) as unknown as { children?: Array<{ type: string; data?: string }> } | undefined;
    const textNodes = (node?.children ?? []).filter((child) => child.type === "text");
    if (textNodes.length === 0) {
      el.prepend(value);
      return true;
    }
    textNodes[0]!.data = value;
    for (const extra of textNodes.slice(1)) extra.data = "";
    return true;
  }
  el.text(value);
  return true;
}

function writeImage($: cheerio.CheerioAPI, image: ImagePlacement, url: string): boolean {
  const el = $(image.selector).first();
  if (el.length === 0) return false;
  if (image.domKind === "background") {
    const style = el.attr("style") ?? "";
    const rewritten = /background-image\s*:\s*url\(/i.test(style)
      ? style.replace(/background-image\s*:\s*url\([^)]*\)/i, `background-image: url(${url})`)
      : `${style};background-image: url(${url})`.replace(/^;/, "");
    el.attr("style", rewritten);
  } else {
    el.attr("src", url);
    el.removeAttr("srcset");
  }
  return true;
}

/**
 * Applies every placement in `page` to `html`. Safe to call with a subset of `llmValues` (only
 * `llm`/`llmQuery` placements need one) and no `resolveData` at all (every `data` placement then
 * simply keeps the template's own demo value — a legitimate, deliberate default, not a degraded
 * mode: see `real-estate-map.ts`'s `fillSource` policy).
 */
export async function applyPlacements(html: string, page: PagePlacements, options: ApplyPlacementsOptions): Promise<FillResult> {
  const $ = cheerio.load(html, null, false);
  const clamped: ClampNote[] = [];
  const skipped: string[] = [];
  const rejectedFixed: string[] = [];
  let appliedText = 0;
  let appliedImages = 0;
  // Phone/email specifically default to an obvious, deterministic placeholder rather than falling
  // through to `illustrativeFill` — see `withPlaceholderContact`'s own doc comment on why those two
  // are a different risk tier from a fake price or fake address.
  const brief = withPlaceholderContact(options.brief);

  for (const placement of page.text) {
    if (placement.fillSource === "fixed") {
      if (options.llmValues?.[placement.id] !== undefined) rejectedFixed.push(placement.id);
      continue;
    }

    if (placement.compose === "phoneAndEmail") {
      const el = $(placement.selector).first();
      if (el.length === 0) {
        skipped.push(placement.id);
        continue;
      }
      el.html([brief.phone, brief.email].filter((value): value is string => Boolean(value)).map(escapeHtml).join("<br>"));
      appliedText += 1;
      continue;
    }

    let raw: string | null;
    if (placement.compose) {
      raw = composedValue(placement.compose, brief);
    } else if (placement.fillSource === "brief") {
      raw = (placement.briefField && brief[placement.briefField]) || null;
      if (!raw && placement.briefField && BRIEF_ILLUSTRATIVE_FIELDS.has(placement.briefField) && options.illustrativeFill) {
        raw = await options.illustrativeFill(placement);
      }
    } else if (placement.fillSource === "data") {
      raw = options.resolveData ? await options.resolveData(placement) : null;
      if (!raw) raw = swapTemplateBrandName(placement.original, options);
      if (!raw && options.illustrativeFill) raw = await options.illustrativeFill(placement);
    } else {
      raw = options.llmValues?.[placement.id] ?? null;
    }
    if (!raw) continue; // nothing resolved — the template's own original copy is the safe default

    // Composed values are already short and shape-controlled (a business name, a phone number);
    // only a free-form value (brief/data/llm) needs the character-budget check.
    const value = placement.compose ? raw : clampToConstraints(raw, placement.constraints, placement.id, clamped);
    if (value === null) continue;

    if (writeText($, placement.selector, value, placement.preserveChildren, placement.attr)) appliedText += 1;
    else skipped.push(placement.id);
  }

  for (const image of page.images) {
    if (image.fillSource === "fixed") continue;
    const url =
      image.fillSource === "data"
        ? options.resolveData
          ? await options.resolveData(image)
          : null
        : (options.llmValues?.[image.id] ?? null);
    if (!url) continue;
    if (writeImage($, image, url)) appliedImages += 1;
    else skipped.push(image.id);
  }

  return { html: $.html(), appliedText, appliedImages, skipped, clamped, rejectedFixed };
}
