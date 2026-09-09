/**
 * Data shapes for the "placements" pipeline — a per-template content map that stands in for the
 * HTML whenever a model needs to write copy or pick photos.
 *
 * The problem this exists to solve: an LLM asked to edit real markup either has to receive the
 * whole HTML file (risking a corrupted/truncated/hallucinated-tag rewrite — exactly what "never
 * pass the HTML to the LLM" is guarding against) or receive nothing and have its output pasted in
 * blind (risking a 40-character hero headline landing in a box the template's designer sized for
 * 18). Neither is acceptable. The fix is the same shape `src/templates/types.ts`'s `SlotLocator` /
 * `PhotoSlot` already use for the scraped-template corpus — locate every substitutable spot once,
 * deterministically, then let the model fill VALUES against that map — extended with the one thing
 * that system does not carry: hard length/word/line budgets per spot, derived from the box's own
 * typography and width, so a model's answer can be validated and clamped before it ever reaches
 * the DOM. `fill.ts` is the enforcement point: it never trusts a value just because a model
 * returned it.
 *
 * This module is intentionally independent of `src/templates/types.ts` — that system indexes an
 * ingested, scraped, arbitrary-markup corpus (~900 templates of unknown structure); this one
 * describes a small number of hand-built, structurally-identical templates (see
 * `real-estate-map.ts`) where every selector is known up front and can be authored once instead of
 * discovered heuristically.
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

/**
 * Who/what a placement's value is allowed to come from — the core safety mechanism. Only `"llm"`
 * and `"llmQuery"` placements are ever sent to a model; everything else is resolved from data this
 * system already has, and a model's output for a non-llm placement is ignored even if supplied
 * (see `fill.ts`'s `applyPlacements`).
 *
 * - `fixed`   — universal UI chrome (nav labels, form field labels, "Search"/"Filter" buttons).
 *               Never substituted, by anyone, ever. Ships exactly as the template wrote it.
 * - `brief`   — comes verbatim from the business's own profile (name, phone, email, address,
 *               license/registration number, tagline, business hours). Never invented.
 * - `data`    — a real, specific, structured fact about the business (a listing's price and
 *               street address, an agent's name and headshot, a stat, a genuine customer
 *               testimonial). Resolved from the business's own data feed when one exists; when it
 *               doesn't, orchestration falls back to the template's own demo value rather than
 *               have a model invent a fake price, a fake street address, or a fake customer —
 *               the same "no legitimate source" line `copy-slots.ts` already draws around
 *               testimonials and team photos, generalized to every specific factual claim a real
 *               estate site makes.
 * - `llm`     — genuine marketing prose (headlines, section copy, service descriptions, a plausible
 *               property description when no real listing feed exists yet). The model may write
 *               this from the business's brief, bounded by `TextConstraints`.
 * - `llmQuery`— a photo slot with no real photo available. The model supplies a short stock-photo
 *               search query (never a URL, never pixels) — mirrors `verbatim-media-agent.ts`'s
 *               existing pattern for the scraped-template corpus.
 */
export const TEXT_FILL_SOURCES = ["fixed", "brief", "data", "llm"] as const;
export type TextFillSource = (typeof TEXT_FILL_SOURCES)[number];

export const IMAGE_FILL_SOURCES = ["fixed", "data", "llmQuery"] as const;
export type ImageFillSource = (typeof IMAGE_FILL_SOURCES)[number];

/** Business-profile fields a `brief`-sourced placement reads from. Deliberately smaller and
 *  real-estate-agnostic-plus-a-few-verticals rather than importing `ExpandedBrief`: this module
 *  does not depend on the rest of the generation pipeline, so it can be exercised (and re-used for
 *  a future vertical's own hand-built template set) on its own. */
export const BRIEF_FIELDS = [
  "businessName",
  "tagline",
  "phone",
  "email",
  "address",
  "licenseNumber",
  "hours",
] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];

/** One of `fill.ts`'s hand-written composition rules, selected instead of a plain substitution —
 *  for the handful of spots where the visible text is a template LITERAL plus a business fact
 *  ("© 2026 Prestige Realty", "Call (415) 555-0101"), or needs two brief fields joined ("(415)
 *  555-0182 / hello@prestigerealty.com"), not one field substituted verbatim. See `fill.ts`. */
export const TEXT_COMPOSE_KINDS = ["footerCopyright", "footerLicense", "callButton", "phoneAndEmail"] as const;
export type TextComposeKind = (typeof TEXT_COMPOSE_KINDS)[number];

export const TextConstraintsSchema = z.object({
  minChars: z.number().int().min(0),
  maxChars: z.number().int().min(1),
  minWords: z.number().int().min(0),
  maxWords: z.number().int().min(1),
  /** How many visual lines the box was designed for — informational for a human/LLM reading the
   *  file; `maxChars` is what `fill.ts` actually enforces, since line count depends on the exact
   *  characters typed, not just their count. */
  maxLines: z.number().int().min(1),
});
export type TextConstraints = z.infer<typeof TextConstraintsSchema>;

export const TextPlacementSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("text"),
  /** Page file this placement lives on, or `"chrome"` for the nav/topbar/footer shared verbatim
   *  across every page. */
  page: z.string().min(1),
  /** CSS selector, unique against that page's full DOM (`extract.ts` asserts this at build time —
   *  a selector that resolves to 0 or 2+ elements fails the build loudly rather than shipping a
   *  placements file that silently targets the wrong node, or every node). */
  selector: z.string().min(1),
  tag: z.string().min(1),
  /** Which visual block this placement belongs to (`"hero"`, `"featuredListings"`, `"nav"`, ...) —
   *  see `real-estate-map.ts`'s `sectionForId`. This is what `llm-view.ts` groups by so a whole
   *  section ("nav") can read as "never needs anything" without inspecting every field in it. */
  section: z.string().min(1),
  /** Free-form but drawn from `TEXT_ROLES` below — semantic label, not a CSS/DOM detail, so a
   *  consumer can group/prompt by meaning ("every hero headline across pages") without re-deriving
   *  it from `selector`. */
  role: z.string().min(1),
  fillSource: z.enum(TEXT_FILL_SOURCES),
  /** The copy shipped in the source template. Kept as a style/length reference (and as the safe
   *  fallback `fill.ts` uses when a `data` placement has nothing real to resolve to) — never
   *  presented to a model as "the answer", and never a real customer's or business's information. */
  original: z.string(),
  constraints: TextConstraintsSchema,
  /** Which `BRIEF_FIELDS` entry this resolves from — set only when `fillSource === "brief"`. */
  briefField: z.enum(BRIEF_FIELDS).optional(),
  /** When set, `fill.ts` replaces only this element's own direct text node(s) and leaves every
   *  element child untouched (a functional link, an accordion's icon glyph). Unset/false: the
   *  whole element's content is replaced with plain text, which is what any filled-in value is
   *  anyway (an LLM's answer never carries markup) — the accepted cost is that a purely decorative
   *  inline accent (e.g. the emphasized word in a hero headline) does not survive a rewrite. */
  preserveChildren: z.boolean().optional(),
  /** Selects one of `fill.ts`'s hand-written composition rules — see `TEXT_COMPOSE_KINDS`. */
  compose: z.enum(TEXT_COMPOSE_KINDS).optional(),
  /** One-line guidance for whoever fills this in — a model's prompt, or a human editing the file
   *  by hand. Not enforced by `fill.ts`; `constraints` is what's enforced. */
  notes: z.string().optional(),
});
export type TextPlacement = z.infer<typeof TextPlacementSchema>;

export const ImageConstraintsSchema = z.object({
  /** `"16:9"`, `"1:1"`, etc — the box's own shape. A resolved photo should be cropped/selected to
   *  roughly this ratio; `fill.ts` does not itself crop, it only swaps `src`/`background-image`. */
  aspectRatio: z.string().min(1),
  minWidthPx: z.number().int().positive(),
  minHeightPx: z.number().int().positive(),
});
export type ImageConstraints = z.infer<typeof ImageConstraintsSchema>;

export const ImagePlacementSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("image"),
  page: z.string().min(1),
  selector: z.string().min(1),
  /** `img` rewrites `src`; `background` rewrites the `url(...)` inside an inline
   *  `style="background-image:..."` — same distinction as `PhotoSlot.kind` in
   *  `src/templates/types.ts`, for the same reason (hero/page-banner photography here is marked up
   *  as a CSS background, not an `<img>`). */
  domKind: z.enum(["img", "background"]),
  /** See `TextPlacementSchema.section`. */
  section: z.string().min(1),
  role: z.string().min(1),
  fillSource: z.enum(IMAGE_FILL_SOURCES),
  /** The template's own placeholder photo URL. Reference only — never re-shipped on a real site
   *  (it is stock photography licensed for the template demo, not for a customer's business). */
  original: z.string(),
  constraints: ImageConstraintsSchema,
  /** What the photo should show — e.g. "exterior of a mid-size suburban family home", "professional
   *  headshot, front-facing, neutral background". Doubles as the seed for an `llmQuery` search
   *  query and as a caption for a human choosing a real photo. */
  subject: z.string().min(1),
  notes: z.string().optional(),
});
export type ImagePlacement = z.infer<typeof ImagePlacementSchema>;

export const PlacementSchema = z.discriminatedUnion("kind", [TextPlacementSchema, ImagePlacementSchema]);
export type Placement = z.infer<typeof PlacementSchema>;

export const PagePlacementsSchema = z.object({
  /** The page file this covers (`"index.html"`, …) or `"chrome"`. */
  page: z.string().min(1),
  /** `<title>` of the page this was extracted from — omitted for `"chrome"`. */
  title: z.string().optional(),
  text: z.array(TextPlacementSchema),
  images: z.array(ImagePlacementSchema),
});
export type PagePlacements = z.infer<typeof PagePlacementsSchema>;

export const PlacementsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  vertical: z.string().min(1),
  /** The template's own folder name, e.g. `"real-estate-agency"` — stable identity across
   *  regenerations of this file. */
  templateId: z.string().min(1),
  templateName: z.string().min(1),
  generatedAt: z.string(),
  /** Real page files, in the order a nav would list them. `"chrome"` is not included here — it is
   *  always present in `pages` and is not a page a site visitor navigates "to". */
  pageOrder: z.array(z.string()),
  pages: z.record(z.string(), PagePlacementsSchema),
});
export type PlacementsFile = z.infer<typeof PlacementsFileSchema>;

/** Every text-placement role used by `real-estate-map.ts`, purely for editor autocomplete/doc
 *  purposes — `TextPlacement.role` is a plain string precisely so a new vertical's map can invent
 *  its own roles without a schema change. */
export const TEXT_ROLES = [
  "brandName", "navLink", "navCta", "topbarAddress", "topbarPhone", "topbarEmail",
  "heroEyebrow", "heroTitle", "heroSubtitle", "heroCta",
  "pageBannerTitle", "breadcrumbCurrent",
  "sectionEyebrow", "sectionTitle", "sectionSubtitle", "sectionLinkCta",
  "propertyBadge", "propertyPrice", "propertyLocation", "propertyTitle", "propertyMeta",
  "statNumber", "statLabel",
  "serviceTitle", "serviceText",
  "processTitle", "processText",
  "testimonialQuote", "testimonialAuthorName", "testimonialAuthorRole",
  "ctaHeading", "ctaBody", "ctaButtonLabel",
  "footerAbout", "footerColHeading", "footerLink", "footerNewsletterText",
  "footerCopyright", "footerLicense",
  "agentName", "agentRole", "agentContact",
  "detailBadge", "detailTitle", "detailLocation", "detailPrice",
  "detailSectionHeading", "detailDescription", "amenityItem",
  "keyFactValue", "keyFactLabel",
  "sidebarHeading", "sidebarBlurb",
  "formHeading", "formIntro",
  "infoCardTitle", "infoCardText",
  "faqQuestion", "faqAnswer",
] as const;

export const IMAGE_ROLES = [
  "heroBackground", "pageBannerBackground", "aboutPhoto",
  "propertyPhoto", "agentHeadshot", "testimonialAvatar",
  "galleryMain", "gallerySide", "sidebarAgentPhoto",
] as const;
