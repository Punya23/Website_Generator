import type { ExpandedBrief } from "../types.js";
import type { BlueprintSection } from "./page-composer-agent.js";
import type { VerticalDesignProfile } from "../design/vertical-profiles.js";

export function mockCopyForProfile(
  templateId: string,
  profile: VerticalDesignProfile,
  section: BlueprintSection,
  brief: ExpandedBrief,
  pageSlug: string
): Record<string, unknown> {
  const props = mockPropsForTemplate(templateId, section, brief, pageSlug);
  const primaryLabel = profile.ctaPatterns?.[0] ?? brief.primaryCta;
  const secondaryLabel = brief.secondaryCta ?? profile.ctaPatterns?.[1] ?? "Learn more";

  if (props.cta && typeof props.cta === "object") {
  if (templateId === "footer_cta") {
      (props.cta as Record<string, unknown>).label = secondaryLabel;
    } else {
      (props.cta as Record<string, unknown>).label = primaryLabel;
    }
  }
  if (templateId === "cta_band") {
    props.headline = primaryLabel;
    if (!props.subcopy) props.subcopy = brief.tagline;
  }
  if (templateId === "footer_cta") {
    props.headline = `Ready to ${secondaryLabel.toLowerCase()}?`;
    if (!props.subcopy) props.subcopy = brief.tagline;
    if (props.secondaryCta && typeof props.secondaryCta === "object") {
      (props.secondaryCta as Record<string, unknown>).label = primaryLabel;
    }
  }
  if (templateId === "contact_split") {
    const slug = brief.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    props.email = `hello@${slug || "studio"}.com`;
  }
  if (templateId === "team_grid" && Array.isArray(props.members)) {
    props.members = (props.members as Record<string, unknown>[]).map((m, i) => ({
      ...m,
      name: i === 0 ? `${brief.businessName} lead` : `${profile.industryFamily} specialist`,
      bio: brief.differentiators[i] ?? String(m.bio ?? ""),
    }));
  }
  if (
    (templateId === "stats_marquee" || templateId === "stats_animated") &&
    Array.isArray(props.stats)
  ) {
    props.stats = [
      { value: "98%", label: "Client satisfaction" },
      { value: "15+", label: "Years experience" },
      { value: "1k+", label: `${profile.industryFamily} clients` },
    ];
  }
  if (templateId === "testimonial_featured") {
    props.author = brief.targetAudience || "A trusted client";
  }
  return props;
}

export function mockPropsForTemplate(
  templateId: string,
  section: BlueprintSection,
  brief: ExpandedBrief,
  pageSlug: string,
  profile?: VerticalDesignProfile
): Record<string, unknown> {
  if (profile) {
    return mockCopyForProfile(templateId, profile, section, brief, pageSlug);
  }
  const cta = { label: brief.primaryCta, href: pageSlug === "contact" ? "#" : "/contact" };

  switch (templateId) {
    case "hero_editorial":
      return {
        label: "Welcome",
        headline: brief.businessName,
        subcopy: brief.tagline,
        image: { imageQuery: `${brief.businessName} hero`, alt: brief.businessName },
        cta,
      };
    case "hero_split_cinematic":
      return {
        headline: brief.businessName,
        subcopy: brief.tagline,
        body: brief.elevatorPitch,
        image: { imageQuery: brief.services[0] ?? "studio" },
        cta,
      };
    case "intro_statement":
      return { label: section.intent, headline: section.intent, body: brief.expandedBrief };
    case "stats_marquee":
      return {
        stats: [
          { value: "500+", label: "Happy clients" },
          { value: "98%", label: "Satisfaction" },
          { value: "10+", label: "Years experience" },
        ],
      };
    case "services_showcase":
      return {
        headline: section.intent,
        paragraphs: [brief.elevatorPitch, brief.differentiators.join(". ")],
        image: { imageQuery: section.intent },
        cta,
      };
    case "feature_bento":
      return {
        headline: "What we offer",
        items: brief.services.slice(0, 4).map((s) => ({
          title: s,
          description: `${s} — delivered with care.`,
          span: "normal",
        })),
      };
    case "testimonial_featured":
      return { quote: brief.elevatorPitch, author: "A valued client", role: brief.targetAudience };
    case "cta_band":
      return {
        headline: brief.primaryCta,
        subcopy: brief.tagline,
        cta,
      };
    case "text_marquee":
      return {
        label: "In the details",
        phrases: [
          brief.tagline,
          ...brief.differentiators.slice(0, 3),
          brief.businessName,
        ].filter(Boolean),
        speed: "normal",
      };
    case "footer_cta":
      return {
        headline: `Ready to ${(brief.secondaryCta ?? "get started").toLowerCase()}?`,
        subcopy: brief.tagline,
        cta: { label: brief.secondaryCta ?? "Learn more", href: "/about" },
        secondaryCta: { label: brief.primaryCta, href: "/contact" },
      };
    case "contact_split":
      return {
        headline: "Get in touch",
        subcopy: brief.tagline,
        email: "hello@example.com",
        formFields: [
          { label: "Name", type: "text", required: true },
          { label: "Email", type: "email", required: true },
          { label: "Message", type: "textarea" },
        ],
      };
    case "faq_accordion":
      return {
        headline: "FAQ",
        items: brief.services.slice(0, 3).map((s) => ({
          question: `Do you offer ${s}?`,
          answer: `Yes — ${s} is a core part of our offering.`,
        })),
      };
    case "team_grid":
      return {
        headline: "Our team",
        members: [
          { name: "Alex Morgan", role: "Lead", bio: brief.differentiators[0] },
          { name: "Jordan Lee", role: "Specialist", bio: brief.differentiators[1] },
        ],
      };
    case "gallery_masonry":
      return {
        headline: "Gallery",
        images: brief.services.slice(0, 4).map((s) => ({ imageQuery: s, caption: s })),
      };
    case "portfolio_strip":
      return {
        headline: "Selected work",
        projects: brief.services.slice(0, 3).map((s, i) => ({
          title: s,
          category: brief.businessName,
          year: String(2024 + i),
        })),
      };
    case "pricing_tiers":
      return {
        headline: "Plans",
        tiers: [
          { name: "Starter", price: "$99", period: "mo", features: brief.services.slice(0, 2) },
          { name: "Pro", price: "$299", period: "mo", highlighted: true, features: brief.services },
        ],
      };
    case "logo_marquee":
      return {
        logos: brief.differentiators.map((d) => ({ name: d })),
      };
    case "hero_video":
      return {
        label: "Featured",
        headline: brief.businessName,
        subcopy: brief.tagline,
        video: { poster: { imageQuery: `${brief.businessName} cinematic`, alt: brief.businessName } },
        cta,
      };
    case "testimonial_carousel":
      return {
        headline: "What clients say",
        items: [
          { quote: brief.elevatorPitch, author: "Alex M.", role: brief.targetAudience },
          { quote: brief.differentiators[0] ?? brief.tagline, author: "Jordan L.", role: "Client" },
          { quote: brief.secondaryCta ?? brief.tagline, author: "Sam R.", role: "Partner" },
        ],
      };
    case "portfolio_carousel":
      return {
        headline: "Selected work",
        slides: brief.services.slice(0, 4).map((s) => ({
          title: s,
          category: brief.businessName,
        })),
      };
    case "before_after":
      return {
        headline: "See the difference",
        caption: brief.tagline,
        before: { imageQuery: "before treatment", alt: "Before" },
        after: { imageQuery: "after treatment result", alt: "After" },
      };
    case "pricing_toggle":
      return {
        headline: "Simple pricing",
        monthlyLabel: "Monthly",
        yearlyLabel: "Yearly",
        tiers: [
          {
            name: "Starter",
            monthlyPrice: "$99/mo",
            yearlyPrice: "$990/yr",
            features: brief.services.slice(0, 2),
            cta,
          },
          {
            name: "Pro",
            monthlyPrice: "$199/mo",
            yearlyPrice: "$1,990/yr",
            highlighted: true,
            features: brief.services,
            cta,
          },
        ],
      };
    case "stats_animated":
      return {
        headline: "By the numbers",
        stats: [
          { value: "500+", label: "Happy clients" },
          { value: "98%", label: "Satisfaction" },
          { value: "10+", label: "Years" },
          { value: "24/7", label: "Support" },
        ],
      };
    case "newsletter_band":
      return {
        headline: "Stay in the loop",
        subcopy: brief.tagline,
        placeholder: "you@example.com",
        buttonLabel: "Subscribe",
      };
    case "hero_spotlight":
      return {
        label: "Featured",
        headline: brief.businessName,
        subcopy: brief.tagline,
        image: { imageQuery: `${brief.businessName} luxury hero`, alt: brief.businessName },
        cta,
      };
    case "scroll_showcase":
      return {
        label: "How it works",
        headline: section.intent || "Our process",
        body: brief.elevatorPitch,
        steps: brief.services.slice(0, 3).map((s, i) => ({
          title: s,
          description: brief.differentiators[i] ?? `${s} — crafted with care.`,
        })),
        image: { imageQuery: brief.services[0] ?? "process" },
        cta,
      };
    case "horizontal_gallery":
      return {
        headline: "Gallery",
        items: brief.services.slice(0, 5).map((s) => ({
          title: s,
          subtitle: brief.businessName,
          image: { imageQuery: s },
        })),
      };
    default:
      return { headline: section.intent, body: brief.expandedBrief };
  }
}

const COPY_ARRAY_KEYS = [
  "phrases",
  "members",
  "items",
  "slides",
  "paragraphs",
  "stats",
  "projects",
  "tiers",
  "logos",
  "formFields",
] as const;

/** Merge partial LLM copy with mock defaults for missing required fields. */
export function mergeCopyWithDefaults(
  llmPartial: Record<string, unknown>,
  defaults: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...defaults };

  for (const [key, val] of Object.entries(llmPartial)) {
    if (val === undefined || val === null) continue;
    if (typeof val === "string" && val.trim() === "") continue;
    out[key] = val;
  }

  for (const key of COPY_ARRAY_KEYS) {
    const llmArr = llmPartial[key];
    const defaultArr = defaults[key];
    if (!Array.isArray(llmArr) || llmArr.length === 0) {
      if (Array.isArray(defaultArr)) out[key] = defaultArr;
    }
  }

  if (defaults.cta && typeof defaults.cta === "object") {
    const llmCta = llmPartial.cta;
    out.cta =
      llmCta && typeof llmCta === "object"
        ? { ...(defaults.cta as Record<string, unknown>), ...(llmCta as Record<string, unknown>) }
        : defaults.cta;
  }

  if (defaults.secondaryCta && typeof defaults.secondaryCta === "object") {
    const llmSecondary = llmPartial.secondaryCta;
    out.secondaryCta =
      llmSecondary && typeof llmSecondary === "object"
        ? {
            ...(defaults.secondaryCta as Record<string, unknown>),
            ...(llmSecondary as Record<string, unknown>),
          }
        : defaults.secondaryCta;
  }

  for (const [key, val] of Object.entries(defaults)) {
    if (out[key] === undefined || out[key] === null) {
      out[key] = val;
    }
  }

  return out;
}
