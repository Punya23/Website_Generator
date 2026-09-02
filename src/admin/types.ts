import { z } from "zod";
import {
  IndustrySchema,
  SiteArchetypeSchema,
  SiteSkinSchema,
  SkinVisualFamilySchema,
  type SkinCategory,
  type SiteSkin,
} from "../skins/schema.js";
import { NavShapeSchema } from "../types.js";

export const SOURCE_KINDS = ["github", "demo", "moodboard"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const CANDIDATE_STATUSES = [
  "queued",
  "ingesting",
  "verifying",
  "needs_review",
  "approved",
  "rejected",
  "blocked",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const PERMISSIVE_LICENSES = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "CC0-1.0",
  "Unlicense",
] as const;
export type PermissiveLicense = (typeof PERMISSIVE_LICENSES)[number];

export const HeadingSchema = z.object({
  level: z.number().min(1).max(6),
  text: z.string(),
});

export const LandmarkSchema = z.enum([
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
  "other",
]);
export type Landmark = z.infer<typeof LandmarkSchema>;

export const PageOutlineSchema = z.object({
  title: z.string(),
  headings: z.array(HeadingSchema),
  landmarks: z.array(LandmarkSchema),
  url: z.string().optional(),
});

export type PageOutline = z.infer<typeof PageOutlineSchema>;

export const MappedSectionSchema = z.object({
  templateId: z.string(),
  intent: z.string(),
  landmark: LandmarkSchema.optional(),
});
export type MappedSection = z.infer<typeof MappedSectionSchema>;

export const MappedRecipeSchema = z.object({
  home: z.array(MappedSectionSchema).min(1),
  notes: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export type MappedRecipe = z.infer<typeof MappedRecipeSchema>;

export const IngestSourceSchema = z.object({
  id: z.string(),
  name: z.string().min(2),
  kind: z.enum(SOURCE_KINDS),
  originUrl: z.string().url(),
  demoUrl: z.string().url().optional(),
  expectedLicense: z.enum(PERMISSIVE_LICENSES).default("MIT"),
  defaultCategory: z.enum(["local-service", "hospitality", "professional", "creative"]).default("creative"),
  industry: IndustrySchema.optional(),
  archetype: SiteArchetypeSchema.optional(),
  stars: z.number().optional(),
  status: z.enum(["active", "paused", "blocked"]).default("active"),
  notes: z.string().optional(),
  lastFetchedAt: z.number().optional(),
  lastError: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type IngestSource = z.infer<typeof IngestSourceSchema>;

export const CandidateEventSchema = z.object({
  at: z.number(),
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
});

/** Deterministic visual measurements taken from one render of a template demo. */
export const ThemeFeaturesSchema = z.object({
  capturedAt: z.number(),
  sourceUrl: z.string(),
  /** Repo-local path of the internal review thumbnail, when one was written. */
  thumbnailPath: z.string().optional(),
  visualFamily: SkinVisualFamilySchema,
  navShape: NavShapeSchema,
  footerLayout: z.enum(["two-column", "centered", "cta-heavy"]),
  density: z.enum(["airy", "normal", "compact"]),
  backgroundHex: z.string().optional(),
  accentHex: z.string().optional(),
  dark: z.boolean(),
  serifHeadings: z.boolean(),
  headingFont: z.string().optional(),
  bodyFont: z.string().optional(),
  headingCount: z.number(),
  imageCount: z.number(),
  /** Every attribute the ingest LLM would otherwise guess was measured, so it can be skipped. */
  conclusive: z.boolean(),
});

export type ThemeFeatures = z.infer<typeof ThemeFeaturesSchema>;

export const IngestCandidateSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  title: z.string(),
  originUrl: z.string(),
  demoUrl: z.string().optional(),
  licenseDetected: z.string().optional(),
  licenseOk: z.boolean().default(false),
  status: z.enum(CANDIDATE_STATUSES),
  blockedReason: z.string().optional(),
  reviewNote: z.string().optional(),
  outline: PageOutlineSchema.optional(),
  pageOutlines: z.record(PageOutlineSchema).optional(),
  recipe: MappedRecipeSchema.optional(),
  features: ThemeFeaturesSchema.optional(),
  featuresSkipped: z.string().optional(),
  /** Which mapper decided this candidate's visual attributes — the ingest cost signal. */
  mappedWith: z.enum(["llm", "features", "heuristic"]).optional(),
  draftSkin: SiteSkinSchema.optional(),
  events: z.array(CandidateEventSchema).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
  reviewedAt: z.number().optional(),
});

export type IngestCandidate = z.infer<typeof IngestCandidateSchema>;

export const IngestRunSchema = z.object({
  id: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  status: z.enum(["running", "succeeded", "failed"]),
  sourceId: z.string().optional(),
  stats: z.object({
    ingested: z.number().default(0),
    verified: z.number().default(0),
    needsReview: z.number().default(0),
    approved: z.number().default(0),
    rejected: z.number().default(0),
    blocked: z.number().default(0),
    discovered: z.number().default(0),
    skippedDup: z.number().default(0),
    autoApproved: z.number().default(0),
    scraped: z.number().default(0),
    mapped: z.number().default(0),
    captured: z.number().default(0),
    llmMapped: z.number().default(0),
  }),
  error: z.string().optional(),
});

export type IngestRun = z.infer<typeof IngestRunSchema>;

export const IngestStoreSchema = z.object({
  sources: z.array(IngestSourceSchema).default([]),
  candidates: z.array(IngestCandidateSchema).default([]),
  runs: z.array(IngestRunSchema).default([]),
});

export type IngestStoreData = z.infer<typeof IngestStoreSchema>;

export type SkinCategoryDefault = SkinCategory;
export type { SiteSkin };
