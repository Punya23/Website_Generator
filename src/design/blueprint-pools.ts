import type { ExpandedBrief, PageBlueprint, PagePlan } from "../types.js";
import type { VerticalProfileId } from "./vertical-profiles.js";
import { pickFrom } from "./variation.js";

type SectionPick = { templateId: string; intent: string };

function pick(
  slug: string,
  templateId: string,
  intent: string,
  index: number
): PageBlueprint["sections"][number] {
  return { id: `${slug}_s${index}_${templateId.replace(/_/g, "")}`, templateId, intent };
}

function buildSections(
  slug: string,
  page: PagePlan,
  brief: ExpandedBrief,
  sequence: SectionPick[]
): PageBlueprint["sections"] {
  return sequence.map((s, i) =>
    pick(slug, s.templateId, s.intent || page.goal || brief.tagline, i)
  );
}

const HOME_POOLS: Record<VerticalProfileId, SectionPick[][]> = {
  "luxury-dark": [
    [
      { templateId: "hero_spotlight", intent: "Immersive opening" },
      { templateId: "intro_statement", intent: "Brand story" },
      { templateId: "text_marquee", intent: "Brand mantra" },
      { templateId: "gallery_masonry", intent: "Portfolio atmosphere" },
      { templateId: "testimonial_carousel", intent: "Client stories" },
      { templateId: "feature_bento", intent: "Signature offerings" },
      { templateId: "footer_cta", intent: "Pre-footer conversion" },
      { templateId: "cta_band", intent: "Close" },
    ],
    [
      { templateId: "hero_video", intent: "Cinematic reveal" },
      { templateId: "scroll_showcase", intent: "Craft narrative" },
      { templateId: "stats_animated", intent: "Social proof" },
      { templateId: "portfolio_carousel", intent: "Selected work" },
      { templateId: "logo_marquee", intent: "Trusted by" },
      { templateId: "newsletter_band", intent: "Stay connected" },
      { templateId: "cta_band", intent: "Book now" },
    ],
    [
      { templateId: "hero_spotlight", intent: "Spotlight hero" },
      { templateId: "horizontal_gallery", intent: "Visual rhythm" },
      { templateId: "intro_statement", intent: "Philosophy" },
      { templateId: "before_after", intent: "Transformations" },
      { templateId: "testimonial_featured", intent: "Featured voice" },
      { templateId: "footer_cta", intent: "Reserve" },
      { templateId: "cta_band", intent: "Primary CTA" },
    ],
    [
      { templateId: "hero_spotlight", intent: "Immersive mid-page open" },
      { templateId: "gallery_masonry", intent: "Portfolio atmosphere" },
      { templateId: "testimonial_carousel", intent: "Client stories" },
      { templateId: "feature_bento", intent: "Signature offerings" },
      { templateId: "footer_cta", intent: "Reserve experience" },
    ],
    [
      { templateId: "hero_video", intent: "Cinematic proof-led open" },
      { templateId: "stats_animated", intent: "Credibility" },
      { templateId: "scroll_showcase", intent: "Craft narrative" },
      { templateId: "testimonial_featured", intent: "Featured voice" },
      { templateId: "cta_band", intent: "Book now" },
    ],
  ],
  "clinical-light": [
    [
      { templateId: "hero_split_cinematic", intent: "Trust-forward hero" },
      { templateId: "stats_animated", intent: "Credentials" },
      { templateId: "intro_statement", intent: "Patient promise" },
      { templateId: "services_showcase", intent: "Core care" },
      { templateId: "before_after", intent: "Results" },
      { templateId: "testimonial_carousel", intent: "Patient stories" },
      { templateId: "faq_accordion", intent: "Common questions" },
      { templateId: "cta_band", intent: "Book appointment" },
    ],
    [
      { templateId: "hero_editorial", intent: "Welcoming hero" },
      { templateId: "feature_bento", intent: "Care pathways" },
      { templateId: "stats_marquee", intent: "By the numbers" },
      { templateId: "team_grid", intent: "Meet the team" },
      { templateId: "testimonial_featured", intent: "Featured review" },
      { templateId: "footer_cta", intent: "Schedule visit" },
      { templateId: "cta_band", intent: "Contact" },
    ],
    [
      { templateId: "hero_split_cinematic", intent: "Clinical clarity" },
      { templateId: "scroll_showcase", intent: "Treatment journey" },
      { templateId: "services_showcase", intent: "Specialties" },
      { templateId: "pricing_toggle", intent: "Transparent plans" },
      { templateId: "logo_marquee", intent: "Accreditations" },
      { templateId: "newsletter_band", intent: "Health tips" },
      { templateId: "cta_band", intent: "Get started" },
    ],
    [
      { templateId: "hero_split_cinematic", intent: "Trust-forward hero" },
      { templateId: "services_showcase", intent: "Core care" },
      { templateId: "before_after", intent: "Results" },
      { templateId: "testimonial_carousel", intent: "Patient stories" },
      { templateId: "cta_band", intent: "Book appointment" },
    ],
    [
      { templateId: "hero_editorial", intent: "Welcoming hero" },
      { templateId: "stats_marquee", intent: "By the numbers" },
      { templateId: "team_grid", intent: "Meet the team" },
      { templateId: "faq_accordion", intent: "Common questions" },
      { templateId: "cta_band", intent: "Schedule visit" },
    ],
  ],
  "corporate-light": [
    [
      { templateId: "hero_editorial", intent: "Assured opening" },
      { templateId: "intro_statement", intent: "Value proposition" },
      { templateId: "stats_animated", intent: "Track record" },
      { templateId: "feature_bento", intent: "Capabilities" },
      { templateId: "logo_marquee", intent: "Partners" },
      { templateId: "testimonial_carousel", intent: "Client proof" },
      { templateId: "footer_cta", intent: "Consultation" },
      { templateId: "cta_band", intent: "Talk to us" },
    ],
    [
      { templateId: "hero_split_cinematic", intent: "Professional hero" },
      { templateId: "services_showcase", intent: "Solutions" },
      { templateId: "pricing_tiers", intent: "Engagement models" },
      { templateId: "team_grid", intent: "Leadership" },
      { templateId: "faq_accordion", intent: "FAQ" },
      { templateId: "cta_band", intent: "Request demo" },
    ],
    [
      { templateId: "hero_editorial", intent: "Assured opening" },
      { templateId: "intro_statement", intent: "Value proposition" },
      { templateId: "feature_bento", intent: "Capabilities" },
      { templateId: "testimonial_carousel", intent: "Client proof" },
      { templateId: "cta_band", intent: "Talk to us" },
    ],
    [
      { templateId: "hero_split_cinematic", intent: "Professional hero" },
      { templateId: "services_showcase", intent: "Solutions" },
      { templateId: "logo_marquee", intent: "Partners" },
      { templateId: "faq_accordion", intent: "FAQ" },
      { templateId: "cta_band", intent: "Request demo" },
    ],
    [
      { templateId: "hero_editorial", intent: "Leadership story" },
      { templateId: "stats_animated", intent: "Track record" },
      { templateId: "team_grid", intent: "Leadership" },
      { templateId: "testimonial_featured", intent: "Client quote" },
      { templateId: "footer_cta", intent: "Consultation" },
    ],
  ],
  "editorial-light": [
    [
      { templateId: "hero_spotlight", intent: "Editorial hero" },
      { templateId: "text_marquee", intent: "Manifesto" },
      { templateId: "horizontal_gallery", intent: "Visual essay" },
      { templateId: "intro_statement", intent: "Studio story" },
      { templateId: "portfolio_carousel", intent: "Recent work" },
      { templateId: "testimonial_featured", intent: "Client quote" },
      { templateId: "footer_cta", intent: "Start a project" },
      { templateId: "cta_band", intent: "Get in touch" },
    ],
    [
      { templateId: "hero_editorial", intent: "Full-bleed statement" },
      { templateId: "scroll_showcase", intent: "Process narrative" },
      { templateId: "gallery_masonry", intent: "Mood board" },
      { templateId: "feature_bento", intent: "Disciplines" },
      { templateId: "newsletter_band", intent: "Journal signup" },
      { templateId: "cta_band", intent: "Collaborate" },
    ],
    [
      { templateId: "hero_spotlight", intent: "Editorial hero" },
      { templateId: "horizontal_gallery", intent: "Visual essay" },
      { templateId: "intro_statement", intent: "Studio story" },
      { templateId: "portfolio_carousel", intent: "Recent work" },
      { templateId: "footer_cta", intent: "Start a project" },
    ],
    [
      { templateId: "hero_editorial", intent: "Full-bleed statement" },
      { templateId: "scroll_showcase", intent: "Process narrative" },
      { templateId: "feature_bento", intent: "Disciplines" },
      { templateId: "testimonial_featured", intent: "Client quote" },
      { templateId: "cta_band", intent: "Collaborate" },
    ],
  ],
  "warm-consumer": [
    [
      { templateId: "hero_video", intent: "Energetic opener" },
      { templateId: "intro_statement", intent: "Welcome" },
      { templateId: "stats_animated", intent: "Community proof" },
      { templateId: "feature_bento", intent: "Highlights" },
      { templateId: "portfolio_carousel", intent: "Moments" },
      { templateId: "testimonial_carousel", intent: "Reviews" },
      { templateId: "newsletter_band", intent: "Offers" },
      { templateId: "cta_band", intent: "Join us" },
    ],
    [
      { templateId: "hero_spotlight", intent: "Warm spotlight" },
      { templateId: "text_marquee", intent: "Vibe" },
      { templateId: "services_showcase", intent: "What we do" },
      { templateId: "before_after", intent: "Results" },
      { templateId: "pricing_toggle", intent: "Membership" },
      { templateId: "footer_cta", intent: "Visit today" },
      { templateId: "cta_band", intent: "Sign up" },
    ],
    [
      { templateId: "hero_spotlight", intent: "Warm spotlight" },
      { templateId: "services_showcase", intent: "What we offer" },
      { templateId: "testimonial_carousel", intent: "Reviews" },
      { templateId: "feature_bento", intent: "Highlights" },
      { templateId: "cta_band", intent: "Order now" },
    ],
    [
      { templateId: "hero_video", intent: "Energetic opener" },
      { templateId: "intro_statement", intent: "Welcome" },
      { templateId: "stats_animated", intent: "Community proof" },
      { templateId: "portfolio_carousel", intent: "Moments" },
      { templateId: "footer_cta", intent: "Visit today" },
    ],
  ],
};

const ABOUT_POOLS: Record<VerticalProfileId, SectionPick[][]> = {
  "luxury-dark": [
    [
      { templateId: "hero_split_cinematic", intent: "Our story" },
      { templateId: "intro_statement", intent: "Philosophy" },
      { templateId: "team_grid", intent: "Artisans" },
      { templateId: "testimonial_carousel", intent: "Voices" },
      { templateId: "footer_cta", intent: "Experience" },
      { templateId: "cta_band", intent: "Visit" },
    ],
  ],
  "clinical-light": [
    [
      { templateId: "intro_statement", intent: "Mission" },
      { templateId: "stats_animated", intent: "Credentials" },
      { templateId: "team_grid", intent: "Practitioners" },
      { templateId: "testimonial_featured", intent: "Patient trust" },
      { templateId: "cta_band", intent: "Book" },
    ],
  ],
  "corporate-light": [
    [
      { templateId: "hero_editorial", intent: "Who we are" },
      { templateId: "intro_statement", intent: "Purpose" },
      { templateId: "stats_marquee", intent: "Impact" },
      { templateId: "team_grid", intent: "Leadership" },
      { templateId: "cta_band", intent: "Partner" },
    ],
  ],
  "editorial-light": [
    [
      { templateId: "hero_editorial", intent: "Studio" },
      { templateId: "scroll_showcase", intent: "Process" },
      { templateId: "team_grid", intent: "Collective" },
      { templateId: "footer_cta", intent: "Collaborate" },
      { templateId: "cta_band", intent: "Brief us" },
    ],
  ],
  "warm-consumer": [
    [
      { templateId: "intro_statement", intent: "Our why" },
      { templateId: "team_grid", intent: "The crew" },
      { templateId: "testimonial_carousel", intent: "Community" },
      { templateId: "newsletter_band", intent: "Stay close" },
      { templateId: "cta_band", intent: "Join" },
    ],
  ],
};

const SERVICES_POOLS: Record<VerticalProfileId, SectionPick[][]> = {
  "luxury-dark": [
    [
      { templateId: "intro_statement", intent: "Offerings" },
      { templateId: "services_showcase", intent: "Signature" },
      { templateId: "gallery_masonry", intent: "Lookbook" },
      { templateId: "pricing_tiers", intent: "Experiences" },
      { templateId: "cta_band", intent: "Reserve" },
    ],
  ],
  "clinical-light": [
    [
      { templateId: "hero_split_cinematic", intent: "Care menu" },
      { templateId: "services_showcase", intent: "Treatments" },
      { templateId: "before_after", intent: "Outcomes" },
      { templateId: "pricing_toggle", intent: "Plans" },
      { templateId: "faq_accordion", intent: "Questions" },
      { templateId: "cta_band", intent: "Schedule" },
    ],
  ],
  "corporate-light": [
    [
      { templateId: "intro_statement", intent: "Solutions" },
      { templateId: "feature_bento", intent: "Capabilities" },
      { templateId: "pricing_tiers", intent: "Engagement" },
      { templateId: "cta_band", intent: "Consult" },
    ],
  ],
  "editorial-light": [
    [
      { templateId: "intro_statement", intent: "Disciplines" },
      { templateId: "portfolio_carousel", intent: "Case studies" },
      { templateId: "services_showcase", intent: "Retainers" },
      { templateId: "cta_band", intent: "Start project" },
    ],
  ],
  "warm-consumer": [
    [
      { templateId: "services_showcase", intent: "Menu" },
      { templateId: "feature_bento", intent: "Highlights" },
      { templateId: "before_after", intent: "Results" },
      { templateId: "pricing_toggle", intent: "Membership" },
      { templateId: "cta_band", intent: "Sign up" },
    ],
  ],
};

const CONTACT_POOLS: Record<VerticalProfileId, SectionPick[][]> = {
  "luxury-dark": [
    [
      { templateId: "intro_statement", intent: "Reach out" },
      { templateId: "contact_split", intent: "Book" },
      { templateId: "faq_accordion", intent: "FAQ" },
      { templateId: "cta_band", intent: "Confirm" },
    ],
  ],
  "clinical-light": [
    [
      { templateId: "intro_statement", intent: "Appointments" },
      { templateId: "contact_split", intent: "Contact" },
      { templateId: "faq_accordion", intent: "Patient FAQ" },
      { templateId: "cta_band", intent: "Book now" },
    ],
  ],
  "corporate-light": [
    [
      { templateId: "contact_split", intent: "Get in touch" },
      { templateId: "faq_accordion", intent: "FAQ" },
      { templateId: "cta_band", intent: "Request call" },
    ],
  ],
  "editorial-light": [
    [
      { templateId: "intro_statement", intent: "Start a brief" },
      { templateId: "contact_split", intent: "Contact" },
      { templateId: "cta_band", intent: "Say hello" },
    ],
  ],
  "warm-consumer": [
    [
      { templateId: "contact_split", intent: "Visit us" },
      { templateId: "faq_accordion", intent: "Questions" },
      { templateId: "cta_band", intent: "Join today" },
    ],
  ],
};

const TEAM_POOLS: Record<VerticalProfileId, SectionPick[][]> = {
  "luxury-dark": [
    [
      { templateId: "hero_split_cinematic", intent: "Meet the artisans" },
      { templateId: "team_grid", intent: "Our stylists" },
      { templateId: "testimonial_carousel", intent: "Client voices" },
      { templateId: "cta_band", intent: "Book with us" },
    ],
  ],
  "clinical-light": [
    [
      { templateId: "intro_statement", intent: "Our practitioners" },
      { templateId: "team_grid", intent: "Clinical team" },
      { templateId: "stats_animated", intent: "Credentials" },
      { templateId: "cta_band", intent: "Schedule" },
    ],
  ],
  "corporate-light": [
    [
      { templateId: "hero_editorial", intent: "Leadership" },
      { templateId: "team_grid", intent: "Our experts" },
      { templateId: "cta_band", intent: "Connect" },
    ],
  ],
  "editorial-light": [
    [
      { templateId: "intro_statement", intent: "The collective" },
      { templateId: "team_grid", intent: "Studio team" },
      { templateId: "footer_cta", intent: "Collaborate" },
      { templateId: "cta_band", intent: "Brief us" },
    ],
  ],
  "warm-consumer": [
    [
      { templateId: "team_grid", intent: "Meet the crew" },
      { templateId: "testimonial_carousel", intent: "Community" },
      { templateId: "cta_band", intent: "Join" },
    ],
  ],
};

const PRICING_POOLS: Record<VerticalProfileId, SectionPick[][]> = {
  "luxury-dark": [
    [
      { templateId: "intro_statement", intent: "Experiences" },
      { templateId: "pricing_tiers", intent: "Signature packages" },
      { templateId: "faq_accordion", intent: "Questions" },
      { templateId: "cta_band", intent: "Reserve" },
    ],
  ],
  "clinical-light": [
    [
      { templateId: "intro_statement", intent: "Transparent care" },
      { templateId: "pricing_toggle", intent: "Treatment plans" },
      { templateId: "faq_accordion", intent: "Billing FAQ" },
      { templateId: "cta_band", intent: "Book" },
    ],
  ],
  "corporate-light": [
    [
      { templateId: "pricing_tiers", intent: "Engagement models" },
      { templateId: "feature_bento", intent: "What's included" },
      { templateId: "cta_band", intent: "Request quote" },
    ],
  ],
  "editorial-light": [
    [
      { templateId: "intro_statement", intent: "Retainers" },
      { templateId: "pricing_tiers", intent: "Project tiers" },
      { templateId: "cta_band", intent: "Start project" },
    ],
  ],
  "warm-consumer": [
    [
      { templateId: "pricing_toggle", intent: "Membership" },
      { templateId: "feature_bento", intent: "Perks" },
      { templateId: "cta_band", intent: "Sign up" },
    ],
  ],
};

const GALLERY_POOLS: Record<VerticalProfileId, SectionPick[][]> = {
  "luxury-dark": [
    [
      { templateId: "hero_spotlight", intent: "Portfolio opener" },
      { templateId: "gallery_masonry", intent: "Lookbook" },
      { templateId: "horizontal_gallery", intent: "Visual rhythm" },
      { templateId: "cta_band", intent: "Book" },
    ],
  ],
  "clinical-light": [
    [
      { templateId: "intro_statement", intent: "Results gallery" },
      { templateId: "before_after", intent: "Transformations" },
      { templateId: "gallery_masonry", intent: "Smiles" },
      { templateId: "cta_band", intent: "Schedule" },
    ],
  ],
  "corporate-light": [
    [
      { templateId: "portfolio_carousel", intent: "Case studies" },
      { templateId: "gallery_masonry", intent: "Work samples" },
      { templateId: "cta_band", intent: "Consult" },
    ],
  ],
  "editorial-light": [
    [
      { templateId: "horizontal_gallery", intent: "Visual essay" },
      { templateId: "gallery_masonry", intent: "Selected work" },
      { templateId: "portfolio_carousel", intent: "Recent projects" },
      { templateId: "cta_band", intent: "Collaborate" },
    ],
  ],
  "warm-consumer": [
    [
      { templateId: "portfolio_carousel", intent: "Moments" },
      { templateId: "gallery_masonry", intent: "Gallery" },
      { templateId: "cta_band", intent: "Visit" },
    ],
  ],
};

const POOLS_BY_SLUG: Record<
  string,
  Record<VerticalProfileId, SectionPick[][]>
> = {
  home: HOME_POOLS,
  about: ABOUT_POOLS,
  services: SERVICES_POOLS,
  contact: CONTACT_POOLS,
  team: TEAM_POOLS,
  pricing: PRICING_POOLS,
  gallery: GALLERY_POOLS,
};

export function pickBlueprintFromPool(
  page: PagePlan,
  brief: ExpandedBrief,
  profileId: VerticalProfileId,
  variationSeed: number
): PageBlueprint {
  const pools = POOLS_BY_SLUG[page.slug]?.[profileId] ?? POOLS_BY_SLUG.home![profileId]!;
  const sequence = pickFrom(variationSeed, `${page.slug}:${profileId}`, pools);
  return {
    slug: page.slug,
    rhythm: profileId.includes("dark") ? "bleed-editorial-band" : "editorial-contained-band",
    sections: buildSections(page.slug, page, brief, sequence),
  };
}
