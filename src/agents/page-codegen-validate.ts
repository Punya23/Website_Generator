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

export interface PageCodegenValidateOptions {
  requiredHero?: string;
  avoidComponents?: string[];
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
  ServicesShowcase: ["headline", "paragraphs"],
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

function isPlaceholderCopy(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  return (
    /^feature \d+$/.test(t) ||
    t === "tailored to your needs." ||
    t === "tailored to your needs" ||
    t === "details coming soon." ||
    t === "details coming soon" ||
    t.includes("lorem ipsum") ||
    t === "learn more"
  );
}

function validateComponentCopy(section: PageCodegenSection): string | null {
  const name = section.component;
  const props = section.props;

  if (name === "FeatureBento" && Array.isArray(props.items)) {
    if (props.items.length < 3) {
      return `FeatureBento needs at least 3 items with specific titles and descriptions, got ${props.items.length}`;
    }
    for (let j = 0; j < props.items.length; j++) {
      const item = props.items[j] as Record<string, unknown>;
      const title = String(item.title ?? "");
      const description = String(item.description ?? "");
      if (isPlaceholderCopy(title) || isPlaceholderCopy(description)) {
        return `FeatureBento item ${j + 1} uses placeholder copy — write specific benefits for this business`;
      }
    }
  }

  if (name === "HorizontalGallery" && Array.isArray(props.items)) {
    if (props.items.length < 3) {
      return `HorizontalGallery needs at least 3 items, got ${props.items.length}`;
    }
  }

  return null;
}

export function validatePageCodegenPlan(
  plan: PageCodegenPlan,
  pageSlug: string,
  options?: PageCodegenValidateOptions
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

  if (options?.requiredHero && first.component !== options.requiredHero) {
    return `first section must be ${options.requiredHero}, got ${first.component}`;
  }

  const avoid = new Set(options?.avoidComponents ?? []);

  let conversionCount = 0;
  const seen = new Set<string>();

  for (let i = 0; i < plan.sections.length; i++) {
    const section = plan.sections[i]!;
    const name = section.component?.trim();
    if (!name || !KNOWN_COMPONENTS.has(name)) {
      return `unknown component "${section.component}" — use exact names from the manifest`;
    }
    if (avoid.has(name)) {
      return `component "${name}" is banned on this page — choose a different section type`;
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

    const copyError = validateComponentCopy(section);
    if (copyError) {
      return `section ${i} (${name}): ${copyError}`;
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
