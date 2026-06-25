import { z } from "zod";

const imageField = z.object({
  src: z.string().optional(),
  imageQuery: z.string().optional(),
  alt: z.string().optional(),
});

const ctaField = z.object({
  label: z.string(),
  href: z.string().optional(),
});

const statItem = z.object({
  value: z.string(),
  label: z.string(),
});

export const HeroEditorialPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string(),
  subcopy: z.string().optional(),
  image: imageField,
  cta: ctaField.optional(),
});

export const HeroSplitCinematicPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string(),
  subcopy: z.string().optional(),
  body: z.string().optional(),
  image: imageField,
  cta: ctaField.optional(),
});

export const IntroStatementPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string(),
  body: z.string(),
});

export const StatsMarqueePropsSchema = z.object({
  label: z.string().optional(),
  stats: z.array(statItem).min(2).max(6),
});

export const ServicesShowcasePropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string(),
  paragraphs: z.array(z.string()).min(1).max(3),
  image: imageField,
  cta: ctaField.optional(),
});

export const FeatureBentoPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  items: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        image: imageField.optional(),
        span: z.enum(["normal", "wide", "tall", "large"]).optional(),
      })
    )
    .min(2)
    .max(6),
});

export const PortfolioStripPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  projects: z
    .array(
      z.object({
        title: z.string(),
        category: z.string().optional(),
        year: z.string().optional(),
        image: imageField.optional(),
      })
    )
    .min(2)
    .max(8),
});

export const TestimonialFeaturedPropsSchema = z.object({
  label: z.string().optional(),
  quote: z.string(),
  author: z.string(),
  role: z.string().optional(),
});

export const PricingTiersPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  tiers: z
    .array(
      z.object({
        name: z.string(),
        price: z.string(),
        period: z.string().optional(),
        description: z.string().optional(),
        features: z.array(z.string()).optional(),
        highlighted: z.boolean().optional(),
        cta: ctaField.optional(),
      })
    )
    .min(1)
    .max(4),
});

export const FaqAccordionPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  items: z.array(z.object({ question: z.string(), answer: z.string() })).min(2).max(8),
});

export const CtaBandPropsSchema = z.object({
  headline: z.string(),
  subcopy: z.string().optional(),
  cta: ctaField,
});

export const ContactSplitPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string(),
  subcopy: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  hours: z.string().optional(),
  formFields: z
    .array(
      z.object({
        label: z.string(),
        type: z.enum(["text", "email", "tel", "textarea", "select"]),
        required: z.boolean().optional(),
        options: z.array(z.string()).optional(),
      })
    )
    .optional(),
  submitLabel: z.string().optional(),
});

export const LogoMarqueePropsSchema = z.object({
  label: z.string().optional(),
  logos: z.array(z.object({ name: z.string(), src: z.string().optional() })).min(3).max(12),
});

export const TeamGridPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  members: z
    .array(
      z.object({
        name: z.string(),
        role: z.string(),
        bio: z.string().optional(),
        image: imageField.optional(),
      })
    )
    .min(2)
    .max(8),
});

export const GalleryMasonryPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  images: z.array(imageField.extend({ caption: z.string().optional() })).min(3).max(12),
});

export const TEMPLATE_PROP_SCHEMAS = {
  hero_editorial: HeroEditorialPropsSchema,
  hero_split_cinematic: HeroSplitCinematicPropsSchema,
  intro_statement: IntroStatementPropsSchema,
  stats_marquee: StatsMarqueePropsSchema,
  services_showcase: ServicesShowcasePropsSchema,
  feature_bento: FeatureBentoPropsSchema,
  portfolio_strip: PortfolioStripPropsSchema,
  testimonial_featured: TestimonialFeaturedPropsSchema,
  pricing_tiers: PricingTiersPropsSchema,
  faq_accordion: FaqAccordionPropsSchema,
  cta_band: CtaBandPropsSchema,
  contact_split: ContactSplitPropsSchema,
  logo_marquee: LogoMarqueePropsSchema,
  team_grid: TeamGridPropsSchema,
  gallery_masonry: GalleryMasonryPropsSchema,
} as const;

export type TemplateId = keyof typeof TEMPLATE_PROP_SCHEMAS;
