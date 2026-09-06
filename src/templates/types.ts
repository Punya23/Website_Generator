/**
 * Verbatim template pipeline — data shapes for locally-ingested third-party HTML templates.
 *
 * Deliberately NOT built on top of `src/skins/schema.ts`: that system's `SkinSection.templateId`
 * is a closed zod enum over the app's own 34 internal section templates, and its whole design
 * point (see `SkinProvenanceSchema` there) is that no third-party HTML/CSS is ever vendored.
 * This module vendors it on purpose — the user's explicit request — so it needs its own shapes.
 */
import { z } from "zod";
import { SKIN_CATEGORIES, INDUSTRIES, SITE_ARCHETYPES } from "../skins/taxonomy.js";

/** Section role. Extends the admin ingest system's `Landmark` set (`src/admin/types.ts`) with
 *  `nav`/`footer`, which are real top-level sections in a verbatim template, not synthesized. */
export const SECTION_ROLES = [
  "nav",
  "hero",
  "features",
  "story",
  "gallery",
  "testimonials",
  "pricing",
  "faq",
  "cta",
  "contact",
  "team",
  "stats",
  "footer",
  "other",
] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

/** A well-known text slot inside a section's markup, located at ingest time so composition can
 *  substitute business copy without an LLM ever touching the markup itself. */
export const SLOT_KINDS = [
  "businessName",
  "tagline",
  "phone",
  "email",
  "address",
  "primaryCta",
  "pageTitle",
  "serviceItemTitle",
  "serviceItemBody",
  "sectionHeading",
  "sectionBody",
] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

/** Locates one substitutable text node inside a section's cached HTML. `selector` must resolve to
 *  exactly one element via cheerio against the section's root; `groupIndex` disambiguates repeated
 *  slots (e.g. the Nth service-list item) so substitution and later revision target the same node. */
/** A content-photo location inside a section — hero banners, gallery/portfolio shots, team and
 *  about-page photography. Populated at ingest from real pixel dimensions (decorative shapes and
 *  icons are excluded by size + path keyword, see `ingest/photo-slots.ts`), resolved at compose
 *  time to the business's own uploaded photo, or a stock photo when none was uploaded — never left
 *  as the template author's own demo photography on a generated customer site. */
export const PhotoSlotSchema = z.object({
  selector: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string().optional(),
  /** `img` rewrites the element's `src`; `background` rewrites the `url(...)` inside its own
   *  inline `style="background-image:..."` — full-bleed hero/feature photography is commonly
   *  marked up this way rather than as an `<img>`, confirmed live in this repo's own bundle
   *  (35 sections in the Arup sample use inline background-image for exactly this). */
  kind: z.enum(["img", "background"]).default("img"),
});
export type PhotoSlot = z.infer<typeof PhotoSlotSchema>;

export const SlotLocatorSchema = z.object({
  kind: z.enum(SLOT_KINDS),
  selector: z.string().min(1),
  groupIndex: z.number().int().min(0).optional(),
  /** Set when the substitutable copy lives in an attribute (an image logo's `alt`) rather than
   *  in a text node. */
  attr: z.string().optional(),
  originalText: z.string(),
});
export type SlotLocator = z.infer<typeof SlotLocatorSchema>;

export const AssetManifestEntrySchema = z.object({
  /** Path inside the cached template directory, relative to the template's extracted root. */
  cachedRelPath: z.string(),
  /** Path this asset is rewritten to inside any generated page, e.g. `_tpl-assets/tpl_xxx/img/logo.png`. */
  outputRelPath: z.string(),
});
export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;

export const TemplateSectionSchema = z.object({
  /** Stable id within the template, derived from source order + role: `sec_00_hero`. */
  id: z.string(),
  templateId: z.string(),
  role: z.enum(SECTION_ROLES),
  /** Confidence of the role classification (heuristic or LLM), 0-1. */
  roleConfidence: z.number().min(0).max(1),
  roleSource: z.enum(["heuristic", "llm"]),
  /** Cache-relative path to the section's own scoped+recolored HTML fragment file. */
  htmlCachePath: z.string(),
  slots: z.array(SlotLocatorSchema).default([]),
  photoSlots: z.array(PhotoSlotSchema).default([]),
  /** Order this section appeared in the source page — used as an initial-scope tiebreak, not
   *  a hard ordering constraint at composition time. */
  sourceOrder: z.number().int().min(0),
});
export type TemplateSection = z.infer<typeof TemplateSectionSchema>;

/** A template's structural design language — container width, corner radius, spacing rhythm — read
 *  heuristically from its own stylesheet at ingest (`ingest/design-fingerprint.ts`). Distinct from
 *  `theme` (light/dark) and from color entirely (`recolor-css.ts` already unifies color for every
 *  template): this is what lets `select.ts` know whether borrowing a section from a DIFFERENT
 *  template would visually clash with the site's anchor, and what `restyle-css.ts` remaps a
 *  borrowed section's own CSS toward when a mix is accepted. Optional: unset for anything ingested
 *  before this field existed, until `ingest/backfill-design-tokens.ts` or a re-ingest fills it in —
 *  an un-backfilled template simply never qualifies as a cross-template mixing candidate (see
 *  `fingerprintCompatibility`'s "missing fingerprint scores 0" default), not a hard failure. */
export const RADIUS_SCALES = ["sharp", "soft", "rounded", "pill"] as const;
export type RadiusScale = (typeof RADIUS_SCALES)[number];
export const SPACING_SCALES = ["tight", "normal", "loose"] as const;
export type SpacingScale = (typeof SPACING_SCALES)[number];

export const DesignFingerprintSchema = z.object({
  containerMaxWidthPx: z.number().int().positive(),
  radiusPx: z.number().int().min(0),
  radiusScale: z.enum(RADIUS_SCALES),
  spacingScale: z.enum(SPACING_SCALES),
});
export type DesignFingerprint = z.infer<typeof DesignFingerprintSchema>;

export const TemplateManifestSchema = z.object({
  /** `tpl_<12-hex-sha256-prefix>`, stable across re-ingests of the same source bytes. */
  templateId: z.string(),
  name: z.string(),
  /** Absolute path to the original zip this template was extracted from. */
  sourceZipPath: z.string(),
  /** Path (relative to the outer zip's extraction dir) that the "real template root" heuristic picked. */
  sourceRootRelPath: z.string(),
  status: z.enum(["ingesting", "ready", "needs_review", "failed"]),
  reviewReason: z.string().optional(),
  /** Raw name of the bundle subfolder this template shipped in, e.g. "Restaurants & Cafes" —
   *  captured verbatim so a mis-classification is traceable back to what the operator actually
   *  named the folder. Not itself used for selection; `category`/`industry` below are. */
  sourceCategoryHint: z.string().optional(),
  /** Deterministic classification — same classifier a brief goes through (`src/skins/taxonomy.ts`),
   *  so a "Fitness" folder and a "gym in Austin" brief land on the same industry without any
   *  hand-authored folder-name mapping.
   *
   *  Read from the template itself, not just its folder: hero headline, nav labels, page titles
   *  and headings are weighted evidence alongside the bundle folder and the zip filename — see
   *  `ingest/classify-taxonomy.ts`. A "Multipurpose" folder therefore no longer means "untagged";
   *  the markup still gets to say what the design is for. */
  category: z.enum(SKIN_CATEGORIES).optional(),
  industry: z.enum(INDUSTRIES).optional(),
  /** Page shape the template is built as (portfolio/storefront/booking/long-form/saas), from the
   *  same classification pass. Ranks candidates within a taxonomy tier via `taxonomyAffinity`. */
  archetype: z.enum(SITE_ARCHETYPES).optional(),
  /** Industries that scored within striking distance of the winner, winner included. Selection
   *  treats these as an acceptable near-miss tier, which is what keeps a hard industry lock from
   *  emptying the pool for a brief whose vertical has few templates of its own. */
  industryRunnersUp: z.array(z.enum(INDUSTRIES)).default([]),
  /** 0–1 separation between the winning industry and the runner-up. 0 means nothing matched. */
  industryConfidence: z.number().min(0).max(1).optional(),
  /** Which evidence family produced the classification — `folder` means the markup said nothing
   *  recognisable, `content` means the folder did not (or there was none), `combined` means both
   *  agreed enough to score. Also the marker the taxonomy backfill uses to skip already-done
   *  templates, so it is safe to re-run. */
  taxonomySource: z.enum(["folder", "content", "combined", "none"]).optional(),
  /** Set when the bundle-folder name itself says "fits any business" (`Multipurpose`, `Landing
   *  Pages`, `Generic`) rather than naming a vertical. These mean the opposite of a category
   *  match, so selection keeps them eligible for every brief instead of excluding them once any
   *  other template in the pool has a real industry match — see `rankByTaxonomy` in `select.ts`.
   *  Orthogonal to `industry`: a multipurpose template whose own hero reads "Digital Agency"
   *  still gets tagged `agency-marketing` (so it ranks first for an agency brief) while staying
   *  eligible everywhere else, because the operator said it fits anything. */
  universalFit: z.boolean().default(false),
  /** The template's ORIGINAL background theme, before recolor forces every template onto the same
   *  target palette — `recolorCss` already computes this (mean luminance of the background-role
   *  surface stack) to decide which direction to invert the ramp, it just used to discard it.
   *  Recolor only rewrites color values; it cannot fix a decorative shape/photo with a light or
   *  dark tone baked into its own pixels, or an inline SVG fill CSS never touches — mixing two
   *  templates whose ORIGINAL theme disagrees can still look inconsistent after both are forced
   *  dark. `select.ts` uses this to keep a generated site's mix theme-consistent at the source,
   *  not just color-consistent at the output. Optional: unset for anything ingested before this
   *  field existed, until the backfill (`ingest/backfill-theme.ts`) or a re-ingest fills it in. */
  theme: z.enum(["light", "dark"]).optional(),
  /** See `DesignFingerprintSchema` above. */
  designFingerprint: DesignFingerprintSchema.optional(),
  /** Cache-relative path to this template's scoped+recolored stylesheet (one file, all pages' CSS merged). */
  cssCachePath: z.string().optional(),
  /** Hash of the source CSS text the cached stylesheet was recolored from — cache-invalidation key. */
  sourceCssHash: z.string().optional(),
  paletteId: z.string().optional(),
  assets: z.array(AssetManifestEntrySchema).default([]),
  sections: z.array(TemplateSectionSchema).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

/** One color in a named target palette. Recolor buckets a source template's colors by role and
 *  luminance, then remaps onto this ramp — see `src/templates/ingest/recolor-css.ts`. */
export const RecolorPaletteSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Ordered lightest -> darkest. Background-role colors remap onto this, preserving relative order. */
  backgroundRamp: z.array(z.string()).min(2),
  textOnDark: z.string(),
  textOnLight: z.string(),
  mutedOnDark: z.string(),
  mutedOnLight: z.string(),
  /** Accent hue is preserved from the source; this only bounds how far lightness/saturation clamp. */
  accentMinLightness: z.number().min(0).max(1),
  accentMaxLightness: z.number().min(0).max(1),
  borderOnDark: z.string(),
  borderOnLight: z.string(),
});
export type RecolorPalette = z.infer<typeof RecolorPaletteSchema>;

/** A section actually placed on a generated page — the unit `select.ts`/`compose.ts` work with. */
export interface PlacedSection {
  templateId: string;
  sectionId: string;
  role: SectionRole;
}
