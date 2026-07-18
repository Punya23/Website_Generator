import { z } from "zod";
import { coerceToString } from "./llm/normalize-llm-output.js";

export const ThemeLayoutSchema = z.object({
  maxWidth: z.string(),
  gridColumns: z.coerce.number().min(1).max(6),
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

export const SectionEntranceSchema = z.enum([
  "reveal",
  "stagger",
  "scale-in",
  "slide-left",
  "none",
]);

export const SectionMotionConfigSchema = z.object({
  entrance: SectionEntranceSchema,
  staggerDelay: z.number().min(0).max(0.5).optional(),
  parallax: z.boolean().optional(),
  marquee: z.boolean().optional(),
  presetOverride: MotionPresetSchema.optional(),
});

export type SectionMotionConfig = z.infer<typeof SectionMotionConfigSchema>;

export const ChromeNavSpecSchema = z.object({
  compactOnScroll: z.boolean(),
  shadowOnScroll: z.boolean().optional(),
});

export const ChromeFooterSpecSchema = z.object({
  layout: z.enum(["two-column", "centered", "cta-heavy"]),
  tagline: z.string().optional(),
  linkGroups: z
    .array(z.object({ label: z.string(), slugs: z.array(z.string()) }))
    .optional(),
  ctaLabel: z.string(),
  ctaHref: z.string(),
  showMood: z.boolean(),
  surface: z.enum(["none", "subtle", "elevated", "bordered"]).optional(),
  divider: z.enum(["none", "line", "fade", "angle"]).optional(),
});

export const ChromeSpecSchema = z.object({
  footer: ChromeFooterSpecSchema,
  /** @deprecated Nav scroll behavior lives on SiteMotionPlan.chrome.nav — sole runtime owner. */
  nav: ChromeNavSpecSchema.optional(),
  announcement: z
    .object({
      message: z.string(),
      href: z.string().optional(),
      /** Solid accent strip, subtle surface, or plain. */
      bandFill: z.enum(["plain", "subtle", "accent"]).optional(),
    })
    .optional(),
  stickyMobileCta: z
    .object({
      label: z.string(),
      href: z.string(),
      panel: z.enum(["flat", "bordered", "elevated", "glass"]).optional(),
    })
    .optional(),
  newsletter: z
    .object({
      headline: z.string(),
      subcopy: z.string().optional(),
      placeholder: z.string().optional(),
      buttonLabel: z.string().optional(),
    })
    .optional(),
  immersive: z
    .object({
      smoothScroll: z.boolean().optional(),
      grainOverlay: z.boolean().optional(),
    })
    .optional(),
});

export type ChromeSpec = z.infer<typeof ChromeSpecSchema>;

export const MotionTimingSchema = z.object({
  durationMs: z.number().min(300).max(1000).optional(),
  staggerMs: z.number().min(40).max(150).optional(),
  ease: z.enum(["out-expo", "out-quart", "linear"]).optional(),
});

export const SiteMotionPlanSchema = z.object({
  globalPreset: MotionPresetSchema,
  /** respect = honor OS reduced-motion; minimal = always static. */
  reducedMotion: z.enum(["respect", "minimal"]),
  /** @deprecated Derived from chrome.nav — kept for backward-compatible plans. */
  navScrollEnhance: z.boolean().optional(),
  timing: MotionTimingSchema.optional(),
  sections: z.record(z.string(), SectionMotionConfigSchema),
  chrome: z.object({
    footer: SectionMotionConfigSchema,
    /** Sole runtime owner of nav scroll compact/shadow behavior. */
    nav: ChromeNavSpecSchema,
  }),
});

export type SiteMotionPlan = z.infer<typeof SiteMotionPlanSchema>;

export const LayoutVariantSchema = z.enum([
  "default",
  "full-bleed-left",
  "centered-stack",
  "split-offset",
  "band-compact",
  "band-wide",
]);

export type LayoutVariant = z.infer<typeof LayoutVariantSchema>;

export const SectionLayoutSpecSchema = z.object({
  variant: LayoutVariantSchema,
  density: z.enum(["airy", "normal", "compact"]).optional(),
  mediaPosition: z.enum(["background", "left", "right"]).optional(),
});

export type SectionLayoutSpec = z.infer<typeof SectionLayoutSpecSchema>;

export const SiteLayoutPlanSchema = z.object({
  sections: z.record(z.string(), SectionLayoutSpecSchema),
});

export type SiteLayoutPlan = z.infer<typeof SiteLayoutPlanSchema>;

export const TypographyScaleSchema = z.object({
  display: z.string().optional(),
  heading: z.string().optional(),
  body: z.string().optional(),
  label: z.string().optional(),
  mono: z.string().optional(),
});

/** Closed surface vocabulary — components consume these, never free-form strings. */
export const SurfaceModeSchema = z.enum(["none", "subtle", "elevated", "bordered"]);
export const SurfaceModesSchema = z.object({
  default: SurfaceModeSchema.optional(),
  elevated: SurfaceModeSchema.optional(),
  none: SurfaceModeSchema.optional(),
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

export const CustomSectionCodegenSchema = z.object({
  componentName: z.string(),
  fileName: z.string(),
  source: z.string(),
});

export type CustomSectionCodegen = z.infer<typeof CustomSectionCodegenSchema>;

export const SectionInstanceSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  intent: z.string(),
  props: z.record(z.unknown()),
  fullBleed: z.boolean().optional(),
  motion: z.string().optional(),
  motionConfig: SectionMotionConfigSchema.optional(),
  layoutSpec: SectionLayoutSpecSchema.optional(),
  customCodegen: CustomSectionCodegenSchema.optional(),
});

export type SectionInstance = z.infer<typeof SectionInstanceSchema>;

export const ReactPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  navLabel: z.string().optional(),
  sections: z.array(SectionInstanceSchema),
});

export type ReactPage = z.infer<typeof ReactPageSchema>;

export const PageToneSchema = z.enum(["light", "dark", "warm", "cool"]);
export const NavTreatmentSchema = z.enum(["glass-dark", "glass-light", "solid", "minimal"]);
/**
 * The physical shape/layout of the nav bar. This is an LLM design decision (nav-surface-agent),
 * not a hardcoded rotation — see NAV_SURFACE_PROMPT for the design language given to the model.
 */
export const NavShapeSchema = z.enum([
  "full-width",
  "floating-capsule",
  "floating-panel",
  "split-inline",
]);
export const GradientMoodSchema = z.enum(["subtle", "vivid", "monochrome"]);
export const AccentRoleSchema = z.enum(["sparing", "hero", "editorial"]);
export type AccentRole = z.infer<typeof AccentRoleSchema>;

export const VisualFxSchema = z.enum(["clean", "editorial", "spotlight", "glass"]);
export type VisualFx = z.infer<typeof VisualFxSchema>;

export const PalettePartialSchema = z.object({
  vertical: z.preprocess((v) => coerceToString(v) ?? "", z.string()),
  mood: z.preprocess((v) => coerceToString(v) ?? "", z.string()),
  gradientMood: GradientMoodSchema.optional(),
  accentRole: AccentRoleSchema.optional(),
  colors: z.object({
    bg: z.string(),
    surface: z.string(),
    text: z.string(),
    muted: z.string(),
    accent: z.string(),
    accentSoft: z.string(),
    gradientFrom: z.string(),
    gradientTo: z.string(),
  }),
});

export type PalettePartial = z.infer<typeof PalettePartialSchema>;

export const RadiusScaleSchema = z.enum(["sharp", "soft", "rounded", "pill"]);
export const ShadowDepthSchema = z.enum(["flat", "soft", "elevated", "dramatic"]);
/** Art-director design decisions the LLM commits to per brief (see site-look-agent DesignBrief). */
export const TypeScaleRatioSchema = z.enum(["compact", "balanced", "dramatic"]);
export const MotionIntensitySchema = z.enum(["subtle", "standard", "expressive"]);

export const TypographyPartialSchema = z.object({
  fontHeading: z.string(),
  fontBody: z.string(),
  typography: TypographyScaleSchema.optional(),
  sectionGapMode: z.enum(["tight", "normal", "airy"]).optional(),
  layout: ThemeLayoutSchema.optional(),
  radiusScale: RadiusScaleSchema.optional(),
  shadowDepth: ShadowDepthSchema.optional(),
});

export type TypographyPartial = z.infer<typeof TypographyPartialSchema>;

export const NavSurfacePartialSchema = z.object({
  pageTone: PageToneSchema.optional(),
  navTreatment: NavTreatmentSchema.optional(),
  navShape: NavShapeSchema.optional(),
  surfaces: SurfaceModesSchema.optional(),
  colors: z.object({
    navBg: z.string(),
    navText: z.string().optional(),
    navMuted: z.string().optional(),
    navActiveBg: z.string().optional(),
    navActiveText: z.string().optional(),
  }),
});

export type NavSurfacePartial = z.infer<typeof NavSurfacePartialSchema>;

export const SiteThemeSchema = z.object({
  vertical: z.string(),
  mood: z.string(),
  fontHeading: z.string(),
  fontBody: z.string(),
  motionStyle: z.string().optional(),
  motionPreset: MotionPresetSchema.optional(),
  pageTone: PageToneSchema.optional(),
  navTreatment: NavTreatmentSchema.optional(),
  navShape: NavShapeSchema.optional(),
  gradientMood: GradientMoodSchema.optional(),
  accentRole: AccentRoleSchema.optional(),
  layout: ThemeLayoutSchema.optional(),
  typography: TypographyScaleSchema.optional(),
  surfaces: SurfaceModesSchema.optional(),
  sectionGapMode: z.enum(["tight", "normal", "airy"]).optional(),
  typeScaleRatio: TypeScaleRatioSchema.optional(),
  motionIntensity: MotionIntensitySchema.optional(),
  radiusScale: RadiusScaleSchema.optional(),
  shadowDepth: ShadowDepthSchema.optional(),
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
  industryFamily: z.string().optional(),
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
  motionPlan: SiteMotionPlanSchema.optional(),
  chromeSpec: ChromeSpecSchema.optional(),
  layoutPlan: SiteLayoutPlanSchema.optional(),
  /** Site-wide FX treatment — resolved once, stamped onto sections via visual contract. */
  siteFx: VisualFxSchema.optional(),

  verticalProfile: z
    .object({
      profileId: z.enum([
        "luxury-dark",
        "clinical-light",
        "corporate-light",
        "editorial-light",
        "warm-consumer",
      ]),
      pageTone: PageToneSchema,
      heroBias: z.string(),
      blueprintFamily: z.string(),
      grainOverlay: z.boolean(),
      industryFamily: z.string(),
      copyHints: z.string().optional(),
      imageHints: z.string().optional(),
      ctaPatterns: z.array(z.string()).optional(),
      proofPatterns: z.array(z.string()).optional(),
    })
    .optional(),
  variationSeed: z.number().optional(),
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

export interface QaSummary {
  passed: boolean;
  hardCount: number;
  softCount: number;
  failedChecks: string[];
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
  buildSucceeded?: boolean;
  degraded?: boolean;
  previewSource?: "live-server" | "next-static" | "html-fallback";
  qaSummary?: QaSummary;
  jobId?: string;
  variationSeed?: number;
  verticalProfileId?: string;
  siteSlug?: string;
  publishedUrl?: string;
  outBytes?: number;
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
