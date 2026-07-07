import {
  COMPONENT_MANIFEST,
  CONVERSION_COMPONENT_NAMES,
  HERO_COMPONENT_NAMES,
  getManifestEntry,
} from "./component-manifest.js";
import { getTemplateByComponentName } from "../section-templates/registry.js";

export interface PageCodegenSection {
  component: string;
  intent: string;
  props: Record<string, unknown>;
}

export interface PageCodegenPlan {
  sections: PageCodegenSection[];
}

/** Minimal required fields per component — structure only, no regex repair. */
const REQUIRED_PROPS: Record<string, string[]> = {
  HeroEditorial: ["headline"],
  HeroSplitCinematic: ["headline"],
  HeroSpotlight: ["headline"],
  HeroVideo: ["headline"],
  IntroStatement: ["headline", "body"],
  StatsMarquee: ["stats"],
  StatsAnimated: ["stats"],
  ServicesShowcase: ["headline"],
  FeatureBento: ["headline", "items"],
  PortfolioStrip: ["projects"],
  TestimonialFeatured: ["quote", "author"],
  TestimonialCarousel: ["items"],
  PricingTiers: ["tiers"],
  PricingToggle: ["plans"],
  FaqAccordion: ["headline", "items"],
  CtaBand: ["headline", "cta"],
  FooterCta: ["headline", "cta"],
  NewsletterBand: ["headline"],
  ContactSplit: ["headline"],
  TextMarquee: ["phrases"],
  LogoMarquee: ["logos"],
  TeamGrid: ["members"],
  GalleryMasonry: ["images"],
  ScrollShowcase: ["headline", "steps"],
  HorizontalGallery: ["headline", "items"],
  BeforeAfter: ["before", "after"],
  PortfolioCarousel: ["slides"],
};

const KNOWN_COMPONENTS = new Set(COMPONENT_MANIFEST.map((e) => e.componentName));

function hasField(obj: Record<string, unknown>, key: string): boolean {
  const val = obj[key];
  if (val === undefined || val === null) return false;
  if (typeof val === "string") return val.trim().length > 0;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === "object") return Object.keys(val as object).length > 0;
  return true;
}

export function validatePageCodegenPlan(
  plan: PageCodegenPlan,
  pageSlug: string
): string | null {
  if (!Array.isArray(plan.sections) || plan.sections.length === 0) {
    return "sections must be a non-empty array";
  }

  const min = pageSlug === "home" ? 4 : 3;
  const max = pageSlug === "home" ? 7 : 5;
  if (plan.sections.length < min) {
    return `page needs at least ${min} sections, got ${plan.sections.length}`;
  }
  if (plan.sections.length > max) {
    return `page has at most ${max} sections, got ${plan.sections.length}`;
  }

  if (pageSlug === "home" && !plan.sections.some((s) => HERO_COMPONENT_NAMES.has(s.component))) {
    return "home page must start with a hero component (HeroSpotlight, HeroEditorial, HeroSplitCinematic, or HeroVideo)";
  }

  const first = plan.sections[0]!;
  if (pageSlug === "home" && !HERO_COMPONENT_NAMES.has(first.component)) {
    return `home first section must be a hero, got ${first.component}`;
  }

  let conversionCount = 0;
  const seen = new Set<string>();

  for (let i = 0; i < plan.sections.length; i++) {
    const section = plan.sections[i]!;
    const name = section.component?.trim();
    if (!name || !KNOWN_COMPONENTS.has(name)) {
      return `unknown component "${section.component}" — use exact names from the manifest`;
    }
    if (!getTemplateByComponentName(name)) {
      return `component "${name}" is not registered`;
    }
    if (!section.props || typeof section.props !== "object" || Array.isArray(section.props)) {
      return `section ${i} (${name}) props must be an object`;
    }
    if (!section.intent?.trim()) {
      return `section ${i} (${name}) needs a short intent`;
    }

    const required = REQUIRED_PROPS[name] ?? ["headline"];
    for (const field of required) {
      if (!hasField(section.props, field)) {
        return `section ${i} (${name}) missing required prop "${field}"`;
      }
    }

    if (CONVERSION_COMPONENT_NAMES.has(name)) {
      conversionCount++;
    }

    if (seen.has(name) && CONVERSION_COMPONENT_NAMES.has(name)) {
      return `duplicate conversion section "${name}" — only one closer allowed`;
    }
    seen.add(name);
  }

  if (conversionCount > 1) {
    return "at most one conversion section per page (CtaBand, FooterCta, or NewsletterBand)";
  }

  return null;
}

export function parsePageCodegenPlan(raw: unknown): PageCodegenPlan {
  const data = raw as { sections?: Array<{ component?: string; intent?: string; props?: unknown }> };
  if (!data?.sections) {
    throw new Error("Missing sections array");
  }
  return {
    sections: data.sections.map((s, i) => ({
      component: String(s.component ?? "").trim(),
      intent: String(s.intent ?? `Section ${i}`).trim(),
      props: (s.props && typeof s.props === "object" && !Array.isArray(s.props)
        ? s.props
        : {}) as Record<string, unknown>,
    })),
  };
}
