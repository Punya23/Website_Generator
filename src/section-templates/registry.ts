import type { z } from "zod";
import { TEMPLATE_PROP_SCHEMAS, type TemplateId } from "./schemas.js";

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
  return template.propsSchema.parse(props) as Record<string, unknown>;
}

export function templateCatalogForPrompt(): string {
  return SECTION_TEMPLATES.map(
    (t) => `- ${t.id}: ${t.description} (mode: ${t.sectionMode})`
  ).join("\n");
}
