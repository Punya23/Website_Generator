import { z } from "zod";

export const ThemeLayoutSchema = z.object({
  maxWidth: z.string(),
  gridColumns: z.number().min(1).max(6),
  sectionGap: z.string(),
  cardMinHeight: z.string(),
});

export const MotionPresetSchema = z.enum([
  "fade-up",
  "stagger",
  "scale-in",
  "slide-left",
  "parallax-hero",
  "none",
]);

export type MotionPreset = z.infer<typeof MotionPresetSchema>;

export const TypographyScaleSchema = z.object({
  display: z.string().optional(),
  heading: z.string().optional(),
  body: z.string().optional(),
  label: z.string().optional(),
  mono: z.string().optional(),
});

export const SurfaceModesSchema = z.object({
  default: z.string().optional(),
  elevated: z.string().optional(),
  none: z.string().optional(),
});

export const BlueprintSectionSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  intent: z.string(),
});

export const PageBlueprintSchema = z.object({
  slug: z.string(),
  rhythm: z.string(),
  sections: z.array(BlueprintSectionSchema).min(2).max(8),
});

export type PageBlueprint = z.infer<typeof PageBlueprintSchema>;

export const SectionInstanceSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  intent: z.string(),
  props: z.record(z.unknown()),
  fullBleed: z.boolean().optional(),
  motion: z.string().optional(),
});

export type SectionInstance = z.infer<typeof SectionInstanceSchema>;

export const ReactPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  navLabel: z.string().optional(),
  sections: z.array(SectionInstanceSchema),
});

export type ReactPage = z.infer<typeof ReactPageSchema>;

export const SiteThemeSchema = z.object({
  vertical: z.string(),
  mood: z.string(),
  fontHeading: z.string(),
  fontBody: z.string(),
  motionStyle: z.string().optional(),
  motionPreset: MotionPresetSchema.optional(),
  layout: ThemeLayoutSchema.optional(),
  typography: TypographyScaleSchema.optional(),
  surfaces: SurfaceModesSchema.optional(),
  sectionGapMode: z.enum(["tight", "normal", "airy"]).optional(),
  colors: z.object({
    bg: z.string(),
    surface: z.string(),
    text: z.string(),
    muted: z.string(),
    accent: z.string(),
    accentSoft: z.string(),
    gradientFrom: z.string(),
    gradientTo: z.string(),
    navBg: z.string(),
    navText: z.string().optional(),
    navMuted: z.string().optional(),
    navActiveBg: z.string().optional(),
    navActiveText: z.string().optional(),
  }),
});

export type SiteTheme = z.infer<typeof SiteThemeSchema>;

export const ExpandedBriefSchema = z.object({
  businessName: z.string(),
  tagline: z.string(),
  elevatorPitch: z.string(),
  expandedBrief: z.string(),
  targetAudience: z.string(),
  services: z.array(z.string()).min(3),
  differentiators: z.array(z.string()).min(3),
  tone: z.string(),
  primaryCta: z.string(),
  secondaryCta: z.string().optional(),
});

export type ExpandedBrief = z.infer<typeof ExpandedBriefSchema>;

export const SectionPlanSchema = z.object({
  id: z.string(),
  intent: z.string(),
  blockTypes: z.array(z.string()).min(1),
  archetype: z
    .enum([
      "split_hero",
      "logo_wall",
      "pricing_table",
      "bento_grid",
      "stats_row",
      "feature_grid",
      "testimonial_band",
      "cta_band",
    ])
    .optional(),
});

export type SectionPlan = z.infer<typeof SectionPlanSchema>;

export const PagePlanSchema = z.object({
  slug: z.string(),
  title: z.string(),
  navLabel: z.string().optional(),
  goal: z.string(),
  minBlocks: z.number().min(1),
  layoutHint: z.string(),
  contentFocus: z.array(z.string()),
  sections: z.array(SectionPlanSchema).min(1).optional(),
});

export const SitePlanSchema = z.object({
  pages: z.array(PagePlanSchema).min(4),
  compositionStrategy: z.string(),
  avoidPatterns: z.array(z.string()),
  visualArchetype: z.string().optional(),
  motionStyle: z.string().optional(),
});

export type PagePlan = z.infer<typeof PagePlanSchema>;
export type SitePlan = z.infer<typeof SitePlanSchema>;

export const ContentBlockSchema = z.object({
  id: z.string(),
  type: z.string(),
}).passthrough();

export type ContentBlock = z.infer<typeof ContentBlockSchema> & Record<string, unknown>;

export const LayoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("Stack"),
      children: z.array(LayoutChildSchema),
    }),
    z.object({
      type: z.literal("Row"),
      children: z.array(LayoutChildSchema),
      columns: z.number().min(1).max(6).optional(),
    }),
    z.object({
      type: z.literal("Grid"),
      children: z.array(LayoutChildSchema),
      minColumnWidth: z.number().optional(),
      columns: z.number().min(1).max(6).optional(),
    }),
    z.object({
      type: z.literal("Section"),
      id: z.string().optional(),
      fullBleed: z.boolean().optional(),
      children: z.array(LayoutChildSchema),
    }),
    z.object({
      type: z.literal("Bento"),
      children: z.array(LayoutChildSchema),
      columns: z.number().min(2).max(6).optional(),
    }),
  ])
);

export const LayoutChildSchema: z.ZodType<LayoutChild> = z.union([
  z.string(),
  LayoutNodeSchema,
]);

export type LayoutChild = string | LayoutNode;

export interface LayoutNode {
  type: "Stack" | "Row" | "Grid" | "Section" | "Bento";
  id?: string;
  children: LayoutChild[];
  minColumnWidth?: number;
  columns?: number;
  fullBleed?: boolean;
}

export interface PageSpec {
  slug: string;
  title: string;
  content: ContentBlock[];
  layout: LayoutNode;
  sections?: PageSection[];
}

export const PageSectionSchema = z.object({
  id: z.string(),
  intent: z.string(),
  archetype: SectionPlanSchema.shape.archetype,
  blocks: z.array(ContentBlockSchema),
  layout: LayoutNodeSchema,
});

export type PageSection = z.infer<typeof PageSectionSchema>;

export const MediaRegistryEntrySchema = z.object({
  url: z.string(),
  query: z.string(),
  blockId: z.string(),
  sectionId: z.string().optional(),
  pageSlug: z.string().optional(),
});

export type MediaRegistryEntry = z.infer<typeof MediaRegistryEntrySchema>;

import { CmsCollectionSchema } from "./cms/types.js";

export type { CmsCollection, CmsItem } from "./cms/types.js";
export { CmsCollectionSchema } from "./cms/types.js";

export const SiteContextSchema = z.object({
  businessName: z.string(),
  businessBrief: z.string(),
  expandedBrief: ExpandedBriefSchema,
  sitePlan: SitePlanSchema,
  designSystem: SiteThemeSchema,
  pages: z.record(
    z.string(),
    z.object({
      slug: z.string(),
      title: z.string(),
      navLabel: z.string().optional(),
      sections: z.array(PageSectionSchema),
    })
  ),
  mediaRegistry: z.array(MediaRegistryEntrySchema).default([]),
  cmsCollections: z.array(CmsCollectionSchema).default([]),
  qaHistory: z
    .array(
      z.object({
        pageSlug: z.string(),
        iteration: z.number(),
        issues: z.array(
          z.object({
            severity: z.enum(["hard", "soft"]),
            code: z.string(),
            message: z.string(),
            targetId: z.string().optional(),
            sectionId: z.string().optional(),
            suggestion: z.string().optional(),
          })
        ),
      })
    )
    .default([]),
  reactPages: z.record(z.string(), ReactPageSchema).optional(),
});

export type SiteContext = z.infer<typeof SiteContextSchema>;

export interface SiteSpec {
  businessName: string;
  businessBrief: string;
  expandedBrief: ExpandedBrief;
  sitePlan: SitePlan;
  theme: SiteTheme;
  pages: PageSpec[];
}

export interface QAIssue {
  severity: "hard" | "soft";
  code: string;
  message: string;
  targetId?: string;
  sectionId?: string;
  suggestion?: string;
  metric?: number;
}

export interface QAResult {
  passed: boolean;
  issues: QAIssue[];
}

export interface GenerationResult {
  site: SiteSpec;
  siteContext: SiteContext;
  htmlPages: Record<string, string>;
  qaResults: Record<string, QAResult>;
  timingMs: number;
  visionPolish?: VisionPolishResult;
  reactProjectPath?: string;
  reactStaticOutPath?: string;
  outputMode?: "react" | "html";
}

export interface VisionPolishResult {
  status: "pending" | "complete" | "skipped";
  issues: QAIssue[];
  appliedFixes: string[];
}

export const CORE_PAGE_KINDS = ["home", "about", "services", "contact"] as const;
export const OPTIONAL_PAGE_KINDS = ["team", "pricing", "faq", "gallery"] as const;
export const ALL_PAGE_SLUGS = [...CORE_PAGE_KINDS, ...OPTIONAL_PAGE_KINDS] as const;

export type CorePageKind = (typeof CORE_PAGE_KINDS)[number];
export type OptionalPageKind = (typeof OPTIONAL_PAGE_KINDS)[number];
export type PageKind = CorePageKind | OptionalPageKind;

export const PAGE_KINDS: CorePageKind[] = [...CORE_PAGE_KINDS];
