import { z } from "zod";

export const SiteThemeSchema = z.object({
  vertical: z.string(),
  mood: z.string(),
  fontHeading: z.string(),
  fontBody: z.string(),
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

export const PagePlanSchema = z.object({
  slug: z.string(),
  title: z.string(),
  goal: z.string(),
  minBlocks: z.number().min(12),
  layoutHint: z.string(),
  contentFocus: z.array(z.string()),
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
    }),
    z.object({
      type: z.literal("Grid"),
      children: z.array(LayoutChildSchema),
      minColumnWidth: z.number().optional(),
    }),
    z.object({
      type: z.literal("Section"),
      fullBleed: z.boolean().optional(),
      children: z.array(LayoutChildSchema),
    }),
  ])
);

export const LayoutChildSchema: z.ZodType<LayoutChild> = z.union([
  z.string(),
  LayoutNodeSchema,
]);

export type LayoutChild = string | LayoutNode;

export interface LayoutNode {
  type: "Stack" | "Row" | "Grid" | "Section";
  children: LayoutChild[];
  minColumnWidth?: number;
  fullBleed?: boolean;
}

export interface PageSpec {
  slug: string;
  title: string;
  content: ContentBlock[];
  layout: LayoutNode;
}

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
  suggestion?: string;
}

export interface QAResult {
  passed: boolean;
  issues: QAIssue[];
}

export interface GenerationResult {
  site: SiteSpec;
  htmlPages: Record<string, string>;
  qaResults: Record<string, QAResult>;
  timingMs: number;
  visionPolish?: VisionPolishResult;
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
