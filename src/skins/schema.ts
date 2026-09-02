import { z } from "zod";
import { LayoutVariantSchema, MotionPresetSchema, NavShapeSchema } from "../types.js";
import type { TemplateId } from "../section-templates/schemas.js";
import { TEMPLATE_PROP_SCHEMAS } from "../section-templates/schemas.js";
import { INDUSTRIES, SITE_ARCHETYPES, SKIN_CATEGORIES, type SkinCategory } from "./taxonomy.js";

// The taxonomy owns the category list so ingest-time and runtime classification cannot drift.
export { SKIN_CATEGORIES };
export type { SkinCategory };

export const IndustrySchema = z.enum(INDUSTRIES);
export const SiteArchetypeSchema = z.enum(SITE_ARCHETYPES);

/**
 * Audit trail for an ingested skin. Only ever describes where a composition recipe came from —
 * no template HTML/CSS is vendored, so this exists for license review, not for attribution
 * obligations we would otherwise owe.
 */
export const SkinProvenanceSchema = z.object({
  originUrl: z.string(),
  demoUrl: z.string().optional(),
  license: z.string(),
  /** Commit the license was read at, when the origin is a git forge. */
  commit: z.string().optional(),
  fetchedAt: z.number(),
  /** Repo-local path of an internal-only review thumbnail. Never shipped in generated sites. */
  thumbnailPath: z.string().optional(),
});

export type SkinProvenance = z.infer<typeof SkinProvenanceSchema>;

export const SkinVisualFamilySchema = z.enum([
  "luxury-dark",
  "clinical-light",
  "corporate-light",
  "editorial-light",
  "warm-consumer",
]);

export type SkinVisualFamily = z.infer<typeof SkinVisualFamilySchema>;

export const QuoteUnitSchema = z.enum(["hours", "guests", "rooms", "sessions"]);
export type QuoteUnit = z.infer<typeof QuoteUnitSchema>;

const TEMPLATE_ID_VALUES = Object.keys(TEMPLATE_PROP_SCHEMAS) as [TemplateId, ...TemplateId[]];

export const SkinSectionSchema = z.object({
  templateId: z.enum(TEMPLATE_ID_VALUES),
  intent: z.string().min(4),
  layoutVariant: LayoutVariantSchema.optional(),
  density: z.enum(["airy", "normal", "compact"]).optional(),
  mediaPosition: z.enum(["background", "left", "right"]).optional(),
});

export type SkinSection = z.infer<typeof SkinSectionSchema>;

export const SiteSkinSchema = z.object({
  id: z.string().min(3),
  name: z.string().min(3),
  categories: z.array(z.enum(SKIN_CATEGORIES)).min(1),
  visualFamily: SkinVisualFamilySchema,
  description: z.string(),
  chrome: z.object({
    navShape: NavShapeSchema,
    footerLayout: z.enum(["two-column", "centered", "cta-heavy"]),
    grainOverlay: z.boolean().optional(),
  }),
  motionPreset: MotionPresetSchema,
  widget: z.enum(["quote-calculator", "none"]).default("none"),
  widgetUnit: QuoteUnitSchema.optional(),
  pages: z
    .object({
      home: z.array(SkinSectionSchema).min(3).max(8),
      about: z.array(SkinSectionSchema).min(2).max(6),
      services: z.array(SkinSectionSchema).min(2).max(6),
      contact: z.array(SkinSectionSchema).min(2).max(6),
    })
    .catchall(z.array(SkinSectionSchema).min(2).max(6)),
  inspiredBy: z.string().optional(),
  industries: z.array(IndustrySchema).optional(),
  archetype: SiteArchetypeSchema.optional(),
  provenance: SkinProvenanceSchema.optional(),
});

export type SiteSkin = z.infer<typeof SiteSkinSchema>;

export const SKIN_PAGE_TITLES: Record<string, { title: string; navLabel: string; goal: string }> = {
  home: { title: "Home", navLabel: "Home", goal: "Hook visitors and convert" },
  about: { title: "About", navLabel: "About", goal: "Build trust and tell the story" },
  services: { title: "Services", navLabel: "Services", goal: "Detail offerings" },
  contact: { title: "Contact", navLabel: "Contact", goal: "Capture the lead" },
};

export function skinSectionId(slug: string, index: number, templateId: string): string {
  return `${slug}_${index}_${templateId.replace(/_/g, "")}`;
}
