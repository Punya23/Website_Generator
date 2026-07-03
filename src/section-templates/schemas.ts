import { z } from "zod";
import { LayoutVariantSchema } from "../types.js";
import {
  coerceToString,
  coerceToStringArray,
  normalizeCopyProps,
} from "../llm/normalize-llm-output.js";
import { repairTemplateProps } from "./repair-props.js";

const layoutFields = {
  layoutVariant: LayoutVariantSchema.optional(),
  density: z.enum(["airy", "normal", "compact"]).optional(),
  mediaPosition: z.enum(["background", "left", "right"]).optional(),
};

/** LLMs sometimes return imageQuery as an array of keywords — coerce to one search string. */
export function coerceImageQuery(val: unknown): string | undefined {
  return coerceToString(val);
}

/** LLMs often return image as a plain search string instead of { imageQuery }. */
export function coerceImageField(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    const q = coerceToString(val);
    return q ? { imageQuery: q } : {};
  }
  if (typeof val === "object" && !Array.isArray(val)) return val;
  return val;
}

const zStr = z.preprocess((v) => coerceToString(v) ?? "", z.string());
const zStrOpt = z.preprocess(coerceToString, z.string().optional());
const zStrArr = z.preprocess(
  (v) => coerceToStringArray(v) ?? [],
  z.array(z.string())
);

const ctaField = z.object({
  label: zStr,
  href: z.string().optional(),
});

const statItem = z.object({
  value: zStr,
  label: zStr,
});

const imageObjectSchema = z.object({
  src: z.string().optional(),
  imageQuery: z.preprocess(coerceImageQuery, z.string().optional()),
  alt: z.string().optional(),
});

const imageField = z.preprocess(coerceImageField, imageObjectSchema);

const galleryImageField = z.preprocess(
  coerceImageField,
  imageObjectSchema.extend({ caption: z.string().optional() })
);

export const HeroEditorialPropsSchema = z.object({
  label: zStrOpt,
  headline: zStr,
  subcopy: zStrOpt,
  image: imageField,
  cta: ctaField.optional(),
  ...layoutFields,
});

export const HeroSplitCinematicPropsSchema = z.object({
  label: zStrOpt,
  headline: zStr,
  subcopy: zStrOpt,
  body: zStrOpt,
  image: imageField,
  cta: ctaField.optional(),
  ...layoutFields,
});

export const IntroStatementPropsSchema = z.object({
  label: zStrOpt,
  headline: zStr,
  body: zStr,
});

export const StatsMarqueePropsSchema = z.object({
  label: z.string().optional(),
  stats: z.array(statItem).min(2).max(6),
});

export const ServicesShowcasePropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string(),
  paragraphs: z.preprocess(
    (v) => coerceToStringArray(v) ?? [],
    z.array(z.string()).min(1).max(3)
  ),
  image: imageField.optional(),
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
  label: z.string().optional(),
  headline: z.string(),
  subcopy: z.string().optional(),
  cta: ctaField,
  ...layoutFields,
});

export const TextMarqueePropsSchema = z.object({
  label: z.string().optional(),
  phrases: z.array(z.string()).min(2).max(8),
  speed: z.enum(["slow", "normal", "fast"]).optional(),
});

export const FooterCtaPropsSchema = z.object({
  headline: z.string(),
  subcopy: z.string().optional(),
  cta: ctaField,
  secondaryCta: ctaField.optional(),
  ...layoutFields,
});

export const ContactSplitPropsSchema = z.object({
  label: z.string().optional(),
  headline: zStr,
  subcopy: zStrOpt,
  email: zStrOpt,
  phone: zStrOpt,
  address: zStrOpt,
  hours: zStrOpt,
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
  images: z.array(galleryImageField).min(3).max(12),
});

export const HeroVideoPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string(),
  subcopy: z.string().optional(),
  video: z
    .object({
      src: z.string().optional(),
      poster: imageField.optional(),
    })
    .optional(),
  cta: ctaField.optional(),
  ...layoutFields,
});

export const TestimonialCarouselPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  items: z
    .array(
      z.object({
        quote: z.string(),
        author: z.string(),
        role: z.string().optional(),
        avatar: imageField.optional(),
      })
    )
    .min(2)
    .max(8),
});

export const PortfolioCarouselPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  slides: z
    .array(
      z.object({
        title: z.string(),
        category: z.string().optional(),
        image: imageField.optional(),
      })
    )
    .min(3)
    .max(10),
});

export const BeforeAfterPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  before: imageField,
  after: imageField,
  caption: z.string().optional(),
});

export const PricingTogglePropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  monthlyLabel: z.string().optional(),
  yearlyLabel: z.string().optional(),
  tiers: z
    .array(
      z.object({
        name: z.string(),
        monthlyPrice: z.string(),
        yearlyPrice: z.string(),
        description: z.string().optional(),
        features: z.array(z.string()).optional(),
        highlighted: z.boolean().optional(),
        cta: ctaField.optional(),
      })
    )
    .min(1)
    .max(4),
});

export const StatsAnimatedPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  stats: z.array(statItem).min(2).max(6),
});

export const NewsletterBandPropsSchema = z.object({
  headline: z.string(),
  subcopy: z.string().optional(),
  placeholder: z.string().optional(),
  buttonLabel: z.string().optional(),
});

export const HeroSpotlightPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string(),
  subcopy: z.string().optional(),
  image: imageField,
  cta: ctaField.optional(),
  ...layoutFields,
});

export const ScrollShowcasePropsSchema = z.object({
  label: zStrOpt,
  headline: zStr,
  body: zStrOpt,
  steps: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
      })
    )
    .min(2)
    .max(5)
    .optional(),
  image: imageField.optional(),
  cta: ctaField.optional(),
});

export const HorizontalGalleryPropsSchema = z.object({
  label: z.string().optional(),
  headline: z.string().optional(),
  items: z
    .array(
      z.object({
        title: z.string(),
        subtitle: z.string().optional(),
        image: imageField.optional(),
      })
    )
    .min(3)
    .max(10),
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
  text_marquee: TextMarqueePropsSchema,
  footer_cta: FooterCtaPropsSchema,
  contact_split: ContactSplitPropsSchema,
  logo_marquee: LogoMarqueePropsSchema,
  team_grid: TeamGridPropsSchema,
  gallery_masonry: GalleryMasonryPropsSchema,
  hero_video: HeroVideoPropsSchema,
  testimonial_carousel: TestimonialCarouselPropsSchema,
  portfolio_carousel: PortfolioCarouselPropsSchema,
  before_after: BeforeAfterPropsSchema,
  pricing_toggle: PricingTogglePropsSchema,
  stats_animated: StatsAnimatedPropsSchema,
  newsletter_band: NewsletterBandPropsSchema,
  hero_spotlight: HeroSpotlightPropsSchema,
  scroll_showcase: ScrollShowcasePropsSchema,
  horizontal_gallery: HorizontalGalleryPropsSchema,
} as const;

/** Copy-only props — no required image/media fields (media curator fills those). */
export const COPY_PROP_SCHEMAS = {
  hero_editorial: HeroEditorialPropsSchema.omit({ image: true }),
  hero_split_cinematic: HeroSplitCinematicPropsSchema.omit({ image: true }),
  intro_statement: IntroStatementPropsSchema,
  stats_marquee: StatsMarqueePropsSchema,
  services_showcase: ServicesShowcasePropsSchema.omit({ image: true }),
  feature_bento: z.object({
    label: z.string().optional(),
    headline: z.string().optional(),
    items: z
      .array(
        z.object({
          title: z.string(),
          description: z.string(),
          span: z.enum(["normal", "wide", "tall", "large"]).optional(),
        })
      )
      .min(2)
      .max(6),
  }),
  portfolio_strip: z.object({
    label: z.string().optional(),
    headline: z.string().optional(),
    projects: z
      .array(
        z.object({
          title: z.string(),
          category: z.string().optional(),
          year: z.string().optional(),
        })
      )
      .min(2)
      .max(8),
  }),
  testimonial_featured: TestimonialFeaturedPropsSchema,
  pricing_tiers: PricingTiersPropsSchema,
  faq_accordion: FaqAccordionPropsSchema,
  cta_band: CtaBandPropsSchema,
  text_marquee: TextMarqueePropsSchema,
  footer_cta: FooterCtaPropsSchema,
  contact_split: ContactSplitPropsSchema,
  logo_marquee: LogoMarqueePropsSchema,
  team_grid: z.object({
    label: z.string().optional(),
    headline: z.string().optional(),
    members: z
      .array(
        z.object({
          name: z.string(),
          role: z.string(),
          bio: z.string().optional(),
        })
      )
      .min(2)
      .max(8),
  }),
  gallery_masonry: z.object({
    label: z.string().optional(),
    headline: z.string().optional(),
  }),
  hero_video: HeroVideoPropsSchema.omit({ video: true }).extend({
    video: z.object({ poster: imageField.optional() }).optional(),
  }),
  testimonial_carousel: z.object({
    label: z.string().optional(),
    headline: z.string().optional(),
    items: z
      .array(
        z.object({
          quote: z.string(),
          author: z.string(),
          role: z.string().optional(),
        })
      )
      .min(2)
      .max(8),
  }),
  portfolio_carousel: z.object({
    label: z.string().optional(),
    headline: z.string().optional(),
    slides: z
      .array(
        z.object({
          title: z.string(),
          category: z.string().optional(),
        })
      )
      .min(3)
      .max(10),
  }),
  before_after: z.object({
    label: z.string().optional(),
    headline: z.string().optional(),
    caption: z.string().optional(),
  }),
  pricing_toggle: PricingTogglePropsSchema,
  stats_animated: StatsAnimatedPropsSchema,
  newsletter_band: NewsletterBandPropsSchema,
  hero_spotlight: HeroSpotlightPropsSchema.omit({ image: true }),
  scroll_showcase: z.object({
    label: z.string().optional(),
    headline: z.string(),
    body: z.string().optional(),
    steps: z
      .array(
        z.object({
          title: z.string(),
          description: z.string(),
        })
      )
      .min(2)
      .max(5)
      .optional(),
    cta: ctaField.optional(),
  }),
  horizontal_gallery: z.object({
    label: z.string().optional(),
    headline: z.string().optional(),
    items: z
      .array(
        z.object({
          title: z.string(),
          subtitle: z.string().optional(),
        })
      )
      .min(3)
      .max(10),
  }),
} as const satisfies Record<keyof typeof TEMPLATE_PROP_SCHEMAS, z.ZodTypeAny>;

export function validateCopyProps(templateId: string, props: unknown): Record<string, unknown> {
  const schema = COPY_PROP_SCHEMAS[templateId as TemplateId];
  if (!schema) throw new Error(`Unknown template: ${templateId}`);
  const repaired = repairTemplateProps(
    templateId,
    (props ?? {}) as Record<string, unknown>
  );
  return schema.parse(repaired) as Record<string, unknown>;
}

export type TemplateId = keyof typeof TEMPLATE_PROP_SCHEMAS;
