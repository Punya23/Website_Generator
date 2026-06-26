import type {
  ChromeSpec,
  ExpandedBrief,
  PageBlueprint,
  SiteMotionPlan,
  SitePlan,
  SiteTheme,
} from "../../types.js";

export interface PipelineAgentContext {
  verticalProfile?: {
    profileId: string;
    pageTone: string;
    heroBias: string;
    blueprintFamily: string;
    grainOverlay: boolean;
    industryFamily: string;
  };
  variationSeed?: number;
}

/** Immutable read-only views passed to specialist agents. */
export interface DesignCouncilSnapshot {
  businessName: string;
  brief: ExpandedBrief;
  rawBrief?: string;
  verticalProfile?: {
    profileId: string;
    pageTone: string;
    paletteHints: string;
    typographyHints: string;
    heroBias: string;
  };
  sitePlan?: SitePlan;
  variationSeed?: number;
}

export interface CreativeSnapshot extends PipelineAgentContext {
  businessName: string;
  brief: ExpandedBrief;
  sitePlan: SitePlan;
  designSystem: SiteTheme;
}

export interface MotionDirectorSnapshot extends PipelineAgentContext {
  businessName: string;
  sitePlan: SitePlan;
  designSystem: SiteTheme;
  blueprints: PageBlueprint[];
  chromeSpec?: ChromeSpec;
}

export interface ChromeDirectorSnapshot extends PipelineAgentContext {
  businessName: string;
  brief: ExpandedBrief;
  sitePlan: SitePlan;
  designSystem: SiteTheme;
  blueprints: PageBlueprint[];
}

export interface SectionCopySnapshot extends PipelineAgentContext {
  businessName: string;
  brief: ExpandedBrief;
  pageSlug: string;
  section: { id: string; templateId: string; intent: string };
  designMood: string;
  avoidPatterns: string[];
}

export interface SectionMediaSnapshot extends PipelineAgentContext {
  businessName: string;
  brief: ExpandedBrief;
  pageSlug: string;
  section: { id: string; templateId: string; intent: string };
  copyProps: Record<string, unknown>;
  imageHints?: string;
}

export function freezeSnapshot<T extends object>(input: T): Readonly<T> {
  return Object.freeze(structuredClone(input)) as Readonly<T>;
}

export type MotionPlanContext = SiteMotionPlan;
