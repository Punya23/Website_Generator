/** Component library catalog for raw LLM page codegen prompts. */
export const COMPONENT_LIBRARY_CATALOG = `
IMPORT ONLY FROM:
- "@/components/sections" — section components below
- "@/components/primitives" — Container, Reveal, Stagger, StaggerItem, DisplayHeading, MonoTag, SectionLabel, PrimaryButton, MagneticButton, SplitRevealHeading, SectionDivider, Media

SECTION COMPONENTS (import by name, pass props inline):

Heroes (pick ONE per page — vary across pages):
- HeroSpotlight: { id?, label?, headline, subcopy?, image?: { src, alt? }, cta?: { label, href? }, layoutVariant?, density?, mediaPosition? }
- HeroEditorial: { id?, label?, headline, subcopy?, image?, cta?, layoutVariant?, density?, mediaPosition? }
- HeroSplitCinematic: { id?, label?, headline, subcopy?, body?, image?, cta?, layoutVariant?, mediaPosition? "left"|"right" }
- HeroVideo: { id?, headline, subcopy?, video?: { poster?: { src, alt? } }, cta? }

Content / layout:
- IntroStatement: { id?, label?, headline, body }
- FeatureBento: { id?, label?, headline?, items: [{ title, description, image?: { src, alt? }, span?: "normal"|"wide"|"tall"|"large" }] } — USE span for visual rhythm (at least one "wide" or "large")
- ServicesShowcase: { id?, label?, headline, paragraphs: string[], image?, cta? }
- ScrollShowcase: { id?, label?, headline, body?, image?, steps?: [{ title, description }] }
- StatsMarquee: { id?, label?, stats: [{ value, label }] }
- StatsAnimated: { id?, label?, headline?, stats: [{ value, label }] }
- TeamGrid: { id?, label?, headline?, members: [{ name, role, bio?, image?: { src, alt? } }] }
- GalleryMasonry: { id?, label?, headline?, images: [{ src, alt?, caption? }] }
- HorizontalGallery: { id?, label?, headline?, items: [{ title, image?: { src, alt? } }] }
- PortfolioStrip: { id?, label?, headline?, projects: [{ title, category?, year?, image?: { src, alt? } }] }
- PortfolioCarousel: { id?, label?, headline?, slides: [{ title, description?, image?: { src, alt? } }] }

Social proof:
- TestimonialFeatured: { id?, quote, author, role? }
- TestimonialCarousel: { id?, label?, headline?, items: [{ quote, author, role?, avatar?: { src, alt? } }] }
- LogoMarquee: { id?, label?, logos: [{ name, src? }] }
- BeforeAfter: { id?, label?, headline?, before: { src, alt? }, after: { src, alt? } }

Conversion:
- PricingTiers: { id?, label?, headline?, tiers: [{ name, price, period?, features: string[], cta?: { label, href? }, highlighted? }] }
- PricingToggle: { id?, label?, headline?, monthlyTiers, annualTiers, ... }
- FaqAccordion: { id?, label?, headline?, items: [{ question, answer }] }
- CtaBand: { id?, label?, headline, subcopy?, cta?: { label, href? } }
- FooterCta: { id?, label?, headline, subcopy?, cta? }
- ContactSplit: { id?, label?, headline, subcopy?, formFields?, submitLabel?, contactInfo? }
- NewsletterBand: { id?, headline, subcopy?, placeholder?, buttonLabel? }
- TextMarquee: { id?, phrases: string[] }

RULES:
- Each section needs a unique id string (e.g. "home-hero", "home-bento")
- Use real image src URLs from the provided IMAGE URLS list only
- Write specific copy for THIS business — no lorem ipsum, no generic filler
- Vary section order and hero choice across pages
- Layout is built into components — never try to control placement with extra props
- ONE hero per page; max ONE FeatureBento; no consecutive card-grid sections
- Hero layoutVariant: "full-bleed-left" or "centered-stack" only
- Do NOT create custom components or inline large JSX blocks — compose library components only
- Do NOT import from @/components/custom
`.trim();

export const CREATIVE_MANDATES = [
  "Open with HeroEditorial full-bleed parallax — follow with FeatureBento using mixed spans (wide + large tiles)",
  "Use HeroSplitCinematic with mediaPosition right — pair with ScrollShowcase and TestimonialCarousel",
  "Lead with HeroSpotlight on a dark scrim — use StatsAnimated and PortfolioCarousel for proof",
  "Skip traditional hero: IntroStatement + HorizontalGallery first, then HeroVideo lower on page",
  "HeroVideo with poster image — StatsMarquee band + PricingTiers or FaqAccordion",
  "Asymmetric HeroEditorial split-offset — FeatureBento as primary story grid with 4+ varied spans",
  "HeroSplitCinematic left media — ServicesShowcase + TeamGrid + CtaBand",
  "Minimal HeroSpotlight centered-stack — GalleryMasonry + TestimonialFeatured editorial close",
] as const;
