import type { z } from "zod";
import { TEMPLATE_PROP_SCHEMAS, type TemplateId } from "./schemas.js";
import { repairTemplateProps } from "./repair-props.js";

export type SectionMode = "bleed" | "contained" | "editorial" | "band";

export interface SectionTemplateDef {
  id: TemplateId;
  name: string;
  description: string;
  sectionMode: SectionMode;
  defaultMotion: "slide-up" | "stagger" | "parallax" | "fade";
  componentName: string;
  propsSchema: z.ZodTypeAny;
  pages: Array<"home" | "about" | "services" | "contact" | "any">;
}

export const SECTION_TEMPLATES: SectionTemplateDef[] = [
  {
    id: "hero_editorial",
    name: "Editorial Hero",
    description: "Full-bleed image with display headline and mono label",
    sectionMode: "bleed",
    defaultMotion: "parallax",
    componentName: "HeroEditorial",
    propsSchema: TEMPLATE_PROP_SCHEMAS.hero_editorial,
    pages: ["home", "any"],
  },
  {
    id: "hero_split_cinematic",
    name: "Split Cinematic Hero",
    description: "50/50 text and media split",
    sectionMode: "bleed",
    defaultMotion: "slide-up",
    componentName: "HeroSplitCinematic",
    propsSchema: TEMPLATE_PROP_SCHEMAS.hero_split_cinematic,
    pages: ["home", "about", "any"],
  },
  {
    id: "intro_statement",
    name: "Intro Statement",
    description: "Typography-only editorial statement, no card chrome",
    sectionMode: "editorial",
    defaultMotion: "slide-up",
    componentName: "IntroStatement",
    propsSchema: TEMPLATE_PROP_SCHEMAS.intro_statement,
    pages: ["any"],
  },
  {
    id: "stats_marquee",
    name: "Stats Marquee",
    description: "Horizontal stat band with accent lines",
    sectionMode: "band",
    defaultMotion: "stagger",
    componentName: "StatsMarquee",
    propsSchema: TEMPLATE_PROP_SCHEMAS.stats_marquee,
    pages: ["home", "about", "any"],
  },
  {
    id: "services_showcase",
    name: "Services Showcase",
    description: "Asymmetric image + stacked copy columns",
    sectionMode: "contained",
    defaultMotion: "slide-up",
    componentName: "ServicesShowcase",
    propsSchema: TEMPLATE_PROP_SCHEMAS.services_showcase,
    pages: ["services", "home", "any"],
  },
  {
    id: "feature_bento",
    name: "Feature Bento",
    description: "Mixed-size feature cells",
    sectionMode: "contained",
    defaultMotion: "stagger",
    componentName: "FeatureBento",
    propsSchema: TEMPLATE_PROP_SCHEMAS.feature_bento,
    pages: ["home", "services", "any"],
  },
  {
    id: "portfolio_strip",
    name: "Portfolio Strip",
    description: "Numbered project cards in a horizontal strip",
    sectionMode: "contained",
    defaultMotion: "stagger",
    componentName: "PortfolioStrip",
    propsSchema: TEMPLATE_PROP_SCHEMAS.portfolio_strip,
    pages: ["home", "about", "any"],
  },
  {
    id: "testimonial_featured",
    name: "Featured Testimonial",
    description: "Large editorial quote",
    sectionMode: "editorial",
    defaultMotion: "slide-up",
    componentName: "TestimonialFeatured",
    propsSchema: TEMPLATE_PROP_SCHEMAS.testimonial_featured,
    pages: ["home", "about", "any"],
  },
  {
    id: "pricing_tiers",
    name: "Pricing Tiers",
    description: "2-3 pricing tiers with featured highlight",
    sectionMode: "contained",
    defaultMotion: "stagger",
    componentName: "PricingTiers",
    propsSchema: TEMPLATE_PROP_SCHEMAS.pricing_tiers,
    pages: ["services", "any"],
  },
  {
    id: "faq_accordion",
    name: "FAQ Accordion",
    description: "Interactive expand/collapse FAQ",
    sectionMode: "contained",
    defaultMotion: "slide-up",
    componentName: "FaqAccordion",
    propsSchema: TEMPLATE_PROP_SCHEMAS.faq_accordion,
    pages: ["contact", "services", "any"],
  },
  {
    id: "cta_band",
    name: "CTA Band",
    description: "Full-width gradient conversion band",
    sectionMode: "band",
    defaultMotion: "slide-up",
    componentName: "CtaBand",
    propsSchema: TEMPLATE_PROP_SCHEMAS.cta_band,
    pages: ["any"],
  },
  {
    id: "text_marquee",
    name: "Text Marquee",
    description: "Scrolling headline phrases for editorial rhythm",
    sectionMode: "band",
    defaultMotion: "fade",
    componentName: "TextMarquee",
    propsSchema: TEMPLATE_PROP_SCHEMAS.text_marquee,
    pages: ["home", "about", "any"],
  },
  {
    id: "footer_cta",
    name: "Footer CTA Strip",
    description: "Full-width pre-footer conversion strip before page close",
    sectionMode: "band",
    defaultMotion: "slide-up",
    componentName: "FooterCta",
    propsSchema: TEMPLATE_PROP_SCHEMAS.footer_cta,
    pages: ["home", "about", "services", "any"],
  },
  {
    id: "contact_split",
    name: "Contact Split",
    description: "Form and contact info side by side",
    sectionMode: "contained",
    defaultMotion: "slide-up",
    componentName: "ContactSplit",
    propsSchema: TEMPLATE_PROP_SCHEMAS.contact_split,
    pages: ["contact", "any"],
  },
  {
    id: "logo_marquee",
    name: "Logo Marquee",
    description: "Scrolling partner logos",
    sectionMode: "band",
    defaultMotion: "fade",
    componentName: "LogoMarquee",
    propsSchema: TEMPLATE_PROP_SCHEMAS.logo_marquee,
    pages: ["home", "about", "any"],
  },
  {
    id: "team_grid",
    name: "Team Grid",
    description: "Team members with photos and roles",
    sectionMode: "contained",
    defaultMotion: "stagger",
    componentName: "TeamGrid",
    propsSchema: TEMPLATE_PROP_SCHEMAS.team_grid,
    pages: ["about", "any"],
  },
  {
    id: "gallery_masonry",
    name: "Gallery Masonry",
    description: "Fashion/product imagery grid",
    sectionMode: "bleed",
    defaultMotion: "stagger",
    componentName: "GalleryMasonry",
    propsSchema: TEMPLATE_PROP_SCHEMAS.gallery_masonry,
    pages: ["home", "services", "any"],
  },
  {
    id: "hero_video",
    name: "Video Hero",
    description: "Muted loop video hero with poster fallback and split headline reveal",
    sectionMode: "bleed",
    defaultMotion: "parallax",
    componentName: "HeroVideo",
    propsSchema: TEMPLATE_PROP_SCHEMAS.hero_video,
    pages: ["home", "any"],
  },
  {
    id: "testimonial_carousel",
    name: "Testimonial Carousel",
    description: "Embla slider with avatars and quotes",
    sectionMode: "contained",
    defaultMotion: "stagger",
    componentName: "TestimonialCarousel",
    propsSchema: TEMPLATE_PROP_SCHEMAS.testimonial_carousel,
    pages: ["home", "about", "any"],
  },
  {
    id: "portfolio_carousel",
    name: "Portfolio Carousel",
    description: "Horizontal blur-edge project carousel",
    sectionMode: "bleed",
    defaultMotion: "stagger",
    componentName: "PortfolioCarousel",
    propsSchema: TEMPLATE_PROP_SCHEMAS.portfolio_carousel,
    pages: ["home", "about", "services", "any"],
  },
  {
    id: "before_after",
    name: "Before / After",
    description: "Drag slider comparing transformation results",
    sectionMode: "contained",
    defaultMotion: "slide-up",
    componentName: "BeforeAfter",
    propsSchema: TEMPLATE_PROP_SCHEMAS.before_after,
    pages: ["home", "services", "any"],
  },
  {
    id: "pricing_toggle",
    name: "Pricing Toggle",
    description: "Monthly/yearly pricing with magnetic CTAs",
    sectionMode: "contained",
    defaultMotion: "stagger",
    componentName: "PricingToggle",
    propsSchema: TEMPLATE_PROP_SCHEMAS.pricing_toggle,
    pages: ["services", "any"],
  },
  {
    id: "stats_animated",
    name: "Animated Stats",
    description: "Scroll-triggered number counters",
    sectionMode: "band",
    defaultMotion: "stagger",
    componentName: "StatsAnimated",
    propsSchema: TEMPLATE_PROP_SCHEMAS.stats_animated,
    pages: ["home", "about", "any"],
  },
  {
    id: "newsletter_band",
    name: "Newsletter Band",
    description: "Email capture strip with editorial typography",
    sectionMode: "band",
    defaultMotion: "slide-up",
    componentName: "NewsletterBand",
    propsSchema: TEMPLATE_PROP_SCHEMAS.newsletter_band,
    pages: ["home", "about", "any"],
  },
  {
    id: "hero_spotlight",
    name: "Spotlight Hero",
    description: "Cursor-reactive radial spotlight with split headline and magnetic CTA",
    sectionMode: "bleed",
    defaultMotion: "parallax",
    componentName: "HeroSpotlight",
    propsSchema: TEMPLATE_PROP_SCHEMAS.hero_spotlight,
    pages: ["home", "any"],
  },
  {
    id: "scroll_showcase",
    name: "Scroll Showcase",
    description: "Pinned scroll narrative with glass step cards",
    sectionMode: "contained",
    defaultMotion: "slide-up",
    componentName: "ScrollShowcase",
    propsSchema: TEMPLATE_PROP_SCHEMAS.scroll_showcase,
    pages: ["home", "about", "services", "any"],
  },
  {
    id: "horizontal_gallery",
    name: "Horizontal Gallery",
    description: "Scroll-snap portfolio strip in viewport",
    sectionMode: "bleed",
    defaultMotion: "stagger",
    componentName: "HorizontalGallery",
    propsSchema: TEMPLATE_PROP_SCHEMAS.horizontal_gallery,
    pages: ["home", "about", "services", "any"],
  },
];

export const TEMPLATE_IDS = SECTION_TEMPLATES.map((t) => t.id);

export function getTemplate(id: string): SectionTemplateDef | undefined {
  return SECTION_TEMPLATES.find((t) => t.id === id);
}

export function validateTemplateProps(
  templateId: string,
  props: unknown
): Record<string, unknown> {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  const repaired = repairTemplateProps(
    templateId,
    (props ?? {}) as Record<string, unknown>
  );
  return template.propsSchema.parse(repaired) as Record<string, unknown>;
}

export { validateCopyProps } from "./schemas.js";

/** Framer-grade templates — architect should prefer these on home */
export const PREMIUM_TEMPLATE_IDS = [
  "hero_spotlight",
  "hero_editorial",
  "hero_split_cinematic",
  "hero_video",
  "scroll_showcase",
  "horizontal_gallery",
  "testimonial_carousel",
  "portfolio_carousel",
  "stats_animated",
  "before_after",
  "pricing_toggle",
  "text_marquee",
] as const;

export const IMMERSIVE_TEMPLATE_IDS = [
  "hero_video",
  "testimonial_carousel",
  "portfolio_carousel",
  "before_after",
  "stats_animated",
  "newsletter_band",
] as const;

export function templateCatalogForPrompt(): string {
  const premium = new Set<string>(PREMIUM_TEMPLATE_IDS);
  const lines = SECTION_TEMPLATES.map((t) => {
    const tag = premium.has(t.id) ? " [premium]" : "";
    return `- ${t.id}: ${t.description} (mode: ${t.sectionMode}, component: ${t.componentName})${tag}`;
  });
  return `PREMIUM (use 3+ on home when relevant): ${PREMIUM_TEMPLATE_IDS.join(", ")}

CATALOG:
${lines.join("\n")}`;
}
