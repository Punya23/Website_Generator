import {
  SECTION_TEMPLATES,
  PREMIUM_TEMPLATE_IDS,
  IMMERSIVE_TEMPLATE_IDS,
  type SectionTemplateDef,
} from "../section-templates/registry.js";

const PREMIUM_IDS = new Set<string>(PREMIUM_TEMPLATE_IDS);
const IMMERSIVE_IDS = new Set<string>(IMMERSIVE_TEMPLATE_IDS);

export interface ComponentManifestEntry {
  componentName: string;
  templateId: string;
  purpose: string;
  whenToUse: string;
  exampleProps: string;
}

const WHEN_TO_USE: Partial<Record<string, string>> = {
  HeroSpotlight:
    "Optional interactive hero — only when the brief wants motion/spotlight FX. Prefer HeroEditorial or HeroSplitCinematic for most brands.",
  HeroEditorial:
    "Editorial hero with optional side image. Prefer as the default for studios, agencies, fashion, wellness.",
  HeroSplitCinematic:
    "Split hero with headline + body copy and cinematic media. Strong default for services and B2B.",
  HeroVideo:
    "Video or poster hero for immersive brands with motion-forward storytelling.",
  IntroStatement:
    "Typography-only statement — use sparingly (once per page max) for editorial breathing room.",
  StatsMarquee: "Horizontal stat band — credibility numbers after the hero.",
  StatsAnimated: "Animated stat counters — social proof with motion.",
  ServicesShowcase: "Asymmetric services block with image and stacked copy columns.",
  FeatureBento: "Card grid of features/benefits — ideal for 3–6 items with titles and short descriptions.",
  PortfolioStrip: "Horizontal project strip with thumbnails.",
  TestimonialFeatured: "Single large testimonial quote with author.",
  TestimonialCarousel: "Multiple testimonials in a carousel.",
  PricingTiers: "Static pricing table with tiers.",
  PricingToggle: "Monthly/annual pricing toggle with plan cards.",
  FaqAccordion: "FAQ accordion — great for contact or services pages.",
  CtaBand: "Gradient conversion band — use as the ONE page closer when you want a bold CTA.",
  FooterCta:
    "Subtle surface-toned closer — alternative to CtaBand; pick one closer per page, not both.",
  NewsletterBand: "In-page newsletter signup — only when email capture is core to the business.",
  ContactSplit: "Contact form + details split layout.",
  TextMarquee: "Scrolling phrase marquee for brand voice.",
  LogoMarquee: "Client/partner logo strip.",
  TeamGrid: "Team member grid with portraits.",
  GalleryMasonry: "Masonry image gallery.",
  ScrollShowcase: "Pinned scroll storytelling section with steps.",
  HorizontalGallery: "Horizontal scrolling image gallery.",
  BeforeAfter: "Before/after comparison slider.",
  PortfolioCarousel: "Portfolio slides carousel.",
};

const EXAMPLE_PROPS: Partial<Record<string, string>> = {
  HeroSpotlight:
    '{ "headline": "...", "subcopy": "...", "cta": { "label": "...", "href": "/contact" }, "image": { "alt": "..." } }',
  FeatureBento:
    '{ "headline": "...", "items": [{ "title": "...", "description": "..." }] }',
  CtaBand:
    '{ "headline": "...", "subcopy": "...", "cta": { "label": "...", "href": "/contact" } }',
  ServicesShowcase:
    '{ "headline": "...", "paragraphs": ["First service area — short description.", "Second area — another sentence."], "image": { "alt": "..." } }',
  IntroStatement: '{ "headline": "...", "body": "..." }',
  ContactSplit:
    '{ "headline": "...", "email": "hello@studio.com", "phone": "555-0100", "formFields": [{ "label": "Message", "type": "textarea" }] }',
  PortfolioCarousel:
    '{ "headline": "...", "slides": [{ "title": "Project name", "category": "Residential", "image": { "alt": "..." } }] }',
  FaqAccordion:
    '{ "headline": "...", "items": [{ "question": "...", "answer": "..." }] }',
  HeroEditorial:
    '{ "label": "...", "headline": "...", "subcopy": "...", "cta": { "label": "...", "href": "/contact" }, "image": { "alt": "..." } }',
  HeroSplitCinematic:
    '{ "headline": "...", "subcopy": "...", "cta": { "label": "...", "href": "/contact" }, "image": { "alt": "..." } }',
  HeroVideo:
    '{ "headline": "...", "subcopy": "...", "video": { "poster": { "alt": "..." } }, "cta": { "label": "...", "href": "/contact" } }',
  StatsMarquee:
    '{ "stats": [{ "value": "10+", "label": "Years experience" }, { "value": "500+", "label": "Projects delivered" }] }',
  StatsAnimated:
    '{ "headline": "...", "stats": [{ "value": "98%", "label": "Client satisfaction" }] }',
  PortfolioStrip:
    '{ "headline": "...", "projects": [{ "title": "Project name", "category": "Residential", "year": "2024" }] }',
  TestimonialFeatured: '{ "quote": "...", "author": "Jane Doe", "role": "CEO, Client Co." }',
  TestimonialCarousel:
    '{ "headline": "...", "items": [{ "quote": "...", "author": "Jane Doe", "role": "Client" }] }',
  PricingTiers:
    '{ "headline": "...", "tiers": [{ "name": "Starter", "price": "$99", "period": "/mo", "features": ["Feature one", "Feature two"] }] }',
  PricingToggle:
    '{ "headline": "...", "tiers": [{ "name": "Pro", "monthlyPrice": "$49", "yearlyPrice": "$470" }] }',
  TextMarquee: '{ "phrases": ["Crafted", "Considered", "Built to last"] }',
  FooterCta:
    '{ "headline": "...", "subcopy": "...", "cta": { "label": "Book a call", "href": "/contact" } }',
  NewsletterBand: '{ "headline": "...", "subcopy": "...", "buttonLabel": "Subscribe" }',
  LogoMarquee:
    '{ "logos": [{ "name": "Client One" }, { "name": "Client Two" }, { "name": "Client Three" }] }',
  TeamGrid:
    '{ "headline": "...", "members": [{ "name": "Jane Doe", "role": "Founder", "bio": "..." }] }',
  GalleryMasonry:
    '{ "images": [{ "alt": "..." }, { "alt": "..." }, { "alt": "..." }] }',
  BeforeAfter:
    '{ "headline": "...", "before": { "alt": "Before" }, "after": { "alt": "After" }, "caption": "..." }',
  ScrollShowcase:
    '{ "headline": "...", "steps": [{ "title": "Step one", "description": "..." }, { "title": "Step two", "description": "..." }] }',
  HorizontalGallery:
    '{ "headline": "...", "items": [{ "title": "Project one" }, { "title": "Project two" }, { "title": "Project three" }] }',
};

function entryForTemplate(t: SectionTemplateDef): ComponentManifestEntry {
  return {
    componentName: t.componentName,
    templateId: t.id,
    purpose: t.description,
    whenToUse: WHEN_TO_USE[t.componentName] ?? `Use for ${t.description.toLowerCase()}.`,
    exampleProps:
      EXAMPLE_PROPS[t.componentName] ??
      '{ "headline": "..." } — include fields natural to this section type.',
  };
}

export const COMPONENT_MANIFEST: ComponentManifestEntry[] = SECTION_TEMPLATES.map(entryForTemplate);

export const HERO_COMPONENT_NAMES = new Set([
  "HeroEditorial",
  "HeroSplitCinematic",
  "HeroSpotlight",
  "HeroVideo",
]);

export const CONVERSION_COMPONENT_NAMES = new Set(["CtaBand", "FooterCta", "NewsletterBand"]);

export function getManifestEntry(componentName: string): ComponentManifestEntry | undefined {
  return COMPONENT_MANIFEST.find((e) => e.componentName === componentName);
}

export function componentManifestForPrompt(
  pageSlug: string,
  options?: { avoid?: Iterable<string> },
): string {
  const avoid = new Set(options?.avoid ?? []);
  const knownSlugs = new Set(["home", "about", "services", "contact"]);
  return SECTION_TEMPLATES.filter((t) => {
    if (avoid.has(t.componentName)) return false;
    if (pageSlug === "portfolio") {
      return (
        t.pages.includes("any") ||
        t.pages.includes("home") ||
        t.pages.includes("about")
      );
    }
    if (knownSlugs.has(pageSlug)) {
      return (
        t.pages.includes("any") ||
        t.pages.includes(pageSlug as "home" | "about" | "services" | "contact")
      );
    }
    return t.pages.includes("any");
  })
    .map((t) => {
      const tags = [PREMIUM_IDS.has(t.id) ? "[premium]" : "", IMMERSIVE_IDS.has(t.id) ? "[immersive]" : ""]
        .filter(Boolean)
        .join(" ");
      return `- ${t.componentName}: ${t.description}${tags ? ` ${tags}` : ""}`;
    })
    .join("\n");
}
