import { SiteSkinSchema, type SiteSkin, type SkinSection } from "./schema.js";
import type { TemplateId } from "../section-templates/schemas.js";
import { loadApprovedSkins } from "../admin/approved-skins.js";

function s(
  templateId: TemplateId,
  intent: string,
  layout?: Partial<Pick<SkinSection, "layoutVariant" | "density" | "mediaPosition">>
): SkinSection {
  return { templateId, intent, ...layout };
}

const RAW_SKINS: SiteSkin[] = [
  {
    id: "local-service-trades",
    name: "Trades workshop",
    categories: ["local-service"],
    visualFamily: "warm-consumer",
    description:
      "Split hero, numbered offers, alternating job-site stories — plumbers, HVAC, contractors.",
    chrome: { navShape: "full-width", footerLayout: "two-column" },
    motionPreset: "fade-up",
    widget: "quote-calculator",
    widgetUnit: "hours",
    inspiredBy:
      "Start Bootstrap landing page (MIT) — masthead, icon features, flipping showcases, CTA",
    pages: {
      home: [
        s("hero_split_cinematic", "Job-site opening", {
          layoutVariant: "default",
          mediaPosition: "right",
          density: "normal",
        }),
        s("offer_index", "What we fix"),
        s("story_split", "A typical call-out", { mediaPosition: "right", density: "normal" }),
        s("story_split", "How we leave the site", { mediaPosition: "left", density: "normal" }),
        s("cta_band", "Book a visit", { layoutVariant: "band-wide" }),
      ],
      about: [
        s("story_split", "Why this crew", { mediaPosition: "right", density: "airy" }),
        s("hours_location", "When we roll out"),
        s("faq_accordion", "Job-site questions", { layoutVariant: "split-offset" }),
      ],
      services: [
        s("offer_index", "Service menu"),
        s("scroll_showcase", "How a call-out works", { density: "normal" }),
        s("footer_cta", "Request a slot", { layoutVariant: "centered-stack" }),
      ],
      contact: [
        s("contact_split", "Send the job details"),
        s("quote_calculator", "Hours estimate"),
        s("faq_accordion", "Before we arrive", { layoutVariant: "centered-stack" }),
      ],
    },
  },
  {
    id: "local-service-clinic",
    name: "Care clinic",
    categories: ["local-service"],
    visualFamily: "clinical-light",
    description: "Type-led opening, hours, numbered treatments — dental, physio, family care.",
    chrome: { navShape: "floating-capsule", footerLayout: "centered" },
    motionPreset: "fade-up",
    widget: "quote-calculator",
    widgetUnit: "sessions",
    inspiredBy: "HyperUI marketing heroes (MIT) — centered type masthead, no stats strip",
    pages: {
      home: [
        s("hero_statement", "Clinic welcome", { layoutVariant: "centered-stack", density: "airy" }),
        s("hours_location", "When we see patients"),
        s("offer_index", "Treatments offered"),
        s("testimonial_carousel", "Patient voices", { density: "normal" }),
        s("footer_cta", "Book this week", { layoutVariant: "centered-stack" }),
      ],
      about: [
        s("story_split", "Practice philosophy", { mediaPosition: "left", density: "airy" }),
        s("before_after", "Clinical results"),
        s("team_grid", "Clinicians"),
      ],
      services: [
        s("menu_board", "Visit types"),
        s("faq_accordion", "First-visit questions"),
        s("cta_band", "Reserve a chair", { layoutVariant: "band-compact" }),
      ],
      contact: [
        s("contact_split", "Request an appointment"),
        s("quote_calculator", "Session estimate"),
      ],
    },
  },
  {
    id: "local-service-salon",
    name: "Salon house",
    categories: ["local-service"],
    visualFamily: "luxury-dark",
    description: "Video opening, treatment board, chair gallery — salon, spa, grooming.",
    chrome: { navShape: "floating-panel", footerLayout: "cta-heavy", grainOverlay: true },
    motionPreset: "stagger",
    widget: "quote-calculator",
    widgetUnit: "sessions",
    inspiredBy: "Framer community moodboard (screenshot only) — dark beauty house",
    pages: {
      home: [
        s("hero_video", "Atmosphere opening", { layoutVariant: "centered-stack", density: "airy" }),
        s("menu_board", "Chair menu"),
        s("horizontal_gallery", "Chair work"),
        s("testimonial_featured", "Regulars", { layoutVariant: "split-offset" }),
        s("cta_band", "Book the chair", { layoutVariant: "band-wide" }),
      ],
      about: [
        s("story_split", "House story", { mediaPosition: "right", density: "airy" }),
        s("gallery_masonry", "The room"),
        s("text_marquee", "Craft words"),
      ],
      services: [
        s("before_after", "Color and cut"),
        s("pricing_toggle", "Memberships"),
        s("footer_cta", "Hold a time", { layoutVariant: "centered-stack" }),
      ],
      contact: [
        s("contact_split", "Request a time"),
        s("quote_calculator", "Package estimate"),
        s("faq_accordion", "Prep questions"),
      ],
    },
  },
  {
    id: "local-service-fitness",
    name: "Training floor",
    categories: ["local-service"],
    visualFamily: "warm-consumer",
    description: "Type hero, class hours, numbered programs — gyms, yoga, trainers.",
    chrome: { navShape: "full-width", footerLayout: "two-column" },
    motionPreset: "scale-in",
    widget: "quote-calculator",
    widgetUnit: "sessions",
    inspiredBy: "HyperUI banners (MIT) — centered type, then schedule, then offer list",
    pages: {
      home: [
        s("hero_statement", "Floor opening", { layoutVariant: "centered-stack", density: "airy" }),
        s("hours_location", "Class hours"),
        s("offer_index", "Programs"),
        s("testimonial_featured", "Member note", { layoutVariant: "centered-stack" }),
        s("cta_band", "Book a session", { layoutVariant: "band-wide" }),
      ],
      about: [
        s("story_split", "How we coach", { mediaPosition: "left", density: "airy" }),
        s("team_grid", "Coaches"),
        s("faq_accordion", "First class"),
      ],
      services: [
        s("menu_board", "Class packs"),
        s("scroll_showcase", "A week on the floor"),
        s("footer_cta", "Start this week", { layoutVariant: "centered-stack" }),
      ],
      contact: [
        s("contact_split", "Join the floor"),
        s("quote_calculator", "Session estimate"),
      ],
    },
  },
  {
    id: "local-service-shop",
    name: "Neighborhood shop",
    categories: ["local-service"],
    visualFamily: "warm-consumer",
    description: "Editorial hero, priced goods, hours — florists, boutiques, local retail.",
    chrome: { navShape: "split-inline", footerLayout: "two-column" },
    motionPreset: "fade-up",
    widget: "none",
    inspiredBy: "TailGrids Play (MIT) — product board plus visit hours",
    pages: {
      home: [
        s("hero_editorial", "Shop window", {
          layoutVariant: "full-bleed-left",
          mediaPosition: "background",
          density: "airy",
        }),
        s("menu_board", "On the counter"),
        s("gallery_masonry", "The room"),
        s("hours_location", "Open hours"),
        s("cta_band", "Order or visit", { layoutVariant: "band-compact" }),
      ],
      about: [
        s("story_split", "Why this shop", { mediaPosition: "right", density: "airy" }),
        s("team_grid", "Who minds the counter"),
      ],
      services: [
        s("offer_index", "Orders and gifts"),
        s("horizontal_gallery", "Seasonal work"),
        s("footer_cta", "Place an order", { layoutVariant: "centered-stack" }),
      ],
      contact: [
        s("contact_split", "Say hello"),
        s("faq_accordion", "Pickup and delivery"),
      ],
    },
  },
  {
    id: "hospitality-restaurant",
    name: "Dining room",
    categories: ["hospitality"],
    visualFamily: "warm-consumer",
    description: "Food hero, menu board, plates, hours — restaurants.",
    chrome: { navShape: "split-inline", footerLayout: "two-column" },
    motionPreset: "parallax-hero",
    widget: "quote-calculator",
    widgetUnit: "guests",
    inspiredBy: "Astroship landing (MIT) — hospitality closer without a stats strip",
    pages: {
      home: [
        s("hero_editorial", "Tonight's room", {
          layoutVariant: "full-bleed-left",
          mediaPosition: "background",
          density: "airy",
        }),
        s("menu_board", "From the kitchen"),
        s("gallery_masonry", "Plates"),
        s("testimonial_carousel", "Regulars"),
        s("cta_band", "Reserve a table", { layoutVariant: "centered-stack" }),
      ],
      about: [
        s("story_split", "Kitchen story", { mediaPosition: "left", density: "airy" }),
        s("hours_location", "Service hours"),
        s("team_grid", "Chefs and front of house"),
      ],
      services: [
        s("horizontal_gallery", "Menu chapters"),
        s("feature_bento", "Private dining"),
        s("footer_cta", "Book the room", { layoutVariant: "band-wide" }),
      ],
      contact: [
        s("contact_split", "Reservations"),
        s("quote_calculator", "Party size"),
      ],
    },
  },
  {
    id: "hospitality-inn",
    name: "Inn stay",
    categories: ["hospitality"],
    visualFamily: "luxury-dark",
    description: "Arrival split, room reel, house story — inns and boutique hotels.",
    chrome: { navShape: "floating-capsule", footerLayout: "centered", grainOverlay: true },
    motionPreset: "slide-left",
    widget: "quote-calculator",
    widgetUnit: "rooms",
    inspiredBy: "Framer community moodboard (screenshot only) — boutique stay",
    pages: {
      home: [
        s("hero_split_cinematic", "Arrival", {
          layoutVariant: "split-offset",
          mediaPosition: "left",
          density: "airy",
        }),
        s("portfolio_carousel", "Rooms"),
        s("story_split", "A night here", { mediaPosition: "right", density: "airy" }),
        s("testimonial_featured", "Guest note", { layoutVariant: "centered-stack" }),
        s("footer_cta", "Check dates", { layoutVariant: "centered-stack" }),
      ],
      about: [
        s("story_split", "House history", { mediaPosition: "left", density: "airy" }),
        s("gallery_masonry", "Grounds"),
        s("scroll_showcase", "From check-in"),
      ],
      services: [
        s("pricing_tiers", "Room types"),
        s("feature_bento", "Amenities"),
        s("faq_accordion", "Stay questions"),
        s("cta_band", "Hold a room", { layoutVariant: "band-compact" }),
      ],
      contact: [
        s("contact_split", "Enquire about dates"),
        s("quote_calculator", "Room nights"),
      ],
    },
  },
  {
    id: "hospitality-cafe",
    name: "Neighborhood cafe",
    categories: ["hospitality"],
    visualFamily: "warm-consumer",
    description: "Spotlight hero, pastry board, hours — cafes and bakeries.",
    chrome: { navShape: "full-width", footerLayout: "two-column" },
    motionPreset: "stagger",
    widget: "none",
    inspiredBy: "TailGrids Play (MIT) — cafe landing with a board, not a card grid",
    pages: {
      home: [
        s("hero_spotlight", "Morning light", { layoutVariant: "centered-stack", density: "airy" }),
        s("menu_board", "Daily bake"),
        s("hours_location", "Counter hours"),
        s("gallery_masonry", "Counter"),
        s("cta_band", "Order ahead", { layoutVariant: "band-wide" }),
      ],
      about: [
        s("story_split", "Why this corner", { mediaPosition: "right", density: "airy" }),
        s("team_grid", "Baristas"),
      ],
      services: [
        s("offer_index", "Catering and wholesale"),
        s("horizontal_gallery", "Pastry case"),
        s("footer_cta", "Plan an order", { layoutVariant: "centered-stack" }),
      ],
      contact: [
        s("contact_split", "Say hello"),
        s("faq_accordion", "Hours and orders"),
      ],
    },
  },
  {
    id: "professional-counsel",
    name: "Counsel chambers",
    categories: ["professional"],
    visualFamily: "corporate-light",
    description: "Type-led opening, numbered practice areas, chambers story — law firms.",
    chrome: { navShape: "full-width", footerLayout: "two-column" },
    motionPreset: "fade-up",
    widget: "none",
    inspiredBy: "Start Bootstrap landing page (MIT) — type masthead and numbered offers, no bento",
    pages: {
      home: [
        s("hero_statement", "Matter opening", { layoutVariant: "full-bleed-left", density: "airy" }),
        s("offer_index", "Practice areas"),
        s("story_split", "How we practise", { mediaPosition: "right", density: "normal" }),
        s("testimonial_featured", "Client counsel", { layoutVariant: "centered-stack" }),
        s("footer_cta", "Request a consult", { layoutVariant: "centered-stack" }),
      ],
      about: [
        s("story_split", "Chambers note", { mediaPosition: "left", density: "airy" }),
        s("team_grid", "Partners"),
        s("logo_marquee", "Matters of record"),
      ],
      services: [
        s("offer_index", "How we engage"),
        s("faq_accordion", "Engagement questions", { layoutVariant: "split-offset" }),
        s("cta_band", "Speak with counsel", { layoutVariant: "band-compact" }),
      ],
      contact: [
        s("contact_split", "Confidential enquiry"),
        s("faq_accordion", "First meeting"),
      ],
    },
  },
  {
    id: "professional-capital",
    name: "Capital desk",
    categories: ["professional"],
    visualFamily: "corporate-light",
    description: "Editorial hero, numbered mandates, process scroll — finance and advisory.",
    chrome: { navShape: "floating-panel", footerLayout: "centered" },
    motionPreset: "fade-up",
    widget: "none",
    inspiredBy: "HyperUI SaaS sections (MIT) — process after the offer list",
    pages: {
      home: [
        s("hero_editorial", "Capital opening", { layoutVariant: "centered-stack", density: "airy" }),
        s("offer_index", "Mandates"),
        s("scroll_showcase", "How advice works"),
        s("testimonial_carousel", "Client desks"),
        s("cta_band", "Request a review", { layoutVariant: "band-wide" }),
      ],
      about: [
        s("story_split", "Fiduciary stance", { mediaPosition: "right", density: "airy" }),
        s("stats_animated", "Track record"),
        s("team_grid", "Advisors"),
      ],
      services: [
        s("pricing_tiers", "Engagements"),
        s("faq_accordion", "Onboarding"),
        s("footer_cta", "Open a conversation", { layoutVariant: "centered-stack" }),
      ],
      contact: [
        s("contact_split", "Request a call"),
        s("faq_accordion", "Onboarding"),
      ],
    },
  },
  {
    id: "professional-practice",
    name: "Practice studio",
    categories: ["professional"],
    visualFamily: "clinical-light",
    description: "Spotlight hero, logo wall, numbered engagements — consulting practices.",
    chrome: { navShape: "split-inline", footerLayout: "two-column" },
    motionPreset: "scale-in",
    widget: "none",
    inspiredBy: "shadcn landing starters (MIT) — logo proof then editorial offer list",
    pages: {
      home: [
        s("hero_spotlight", "Practice opening", { layoutVariant: "full-bleed-left", density: "normal" }),
        s("logo_marquee", "Operators we support"),
        s("offer_index", "Engagement types"),
        s("testimonial_featured", "Operator quote", { layoutVariant: "split-offset" }),
        s("footer_cta", "Start a sprint", { layoutVariant: "centered-stack" }),
      ],
      about: [
        s("story_split", "How we work", { mediaPosition: "left", density: "airy" }),
        s("scroll_showcase", "A typical sprint"),
        s("team_grid", "Principals"),
      ],
      services: [
        s("pricing_toggle", "Retainers"),
        s("faq_accordion", "Kickoff questions"),
        s("cta_band", "Book a diagnostic", { layoutVariant: "band-compact" }),
      ],
      contact: [
        s("contact_split", "Diagnostic request"),
        s("faq_accordion", "Fit questions"),
      ],
    },
  },
  {
    id: "professional-realty",
    name: "Realty desk",
    categories: ["professional"],
    visualFamily: "corporate-light",
    description: "Split listing hero, property reel, numbered services — real estate.",
    chrome: { navShape: "full-width", footerLayout: "two-column" },
    motionPreset: "slide-left",
    widget: "none",
    inspiredBy: "HyperUI portfolio sections (MIT) — listing carousel instead of a stats band",
    pages: {
      home: [
        s("hero_split_cinematic", "Listing opening", {
          layoutVariant: "default",
          mediaPosition: "right",
          density: "normal",
        }),
        s("portfolio_carousel", "Current listings"),
        s("offer_index", "How we represent"),
        s("cta_band", "Request a viewing", { layoutVariant: "band-compact" }),
      ],
      about: [
        s("story_split", "Neighborhood practice", { mediaPosition: "right", density: "airy" }),
        s("team_grid", "Agents"),
        s("logo_marquee", "Brokerage marks"),
      ],
      services: [
        s("scroll_showcase", "From listing to keys"),
        s("faq_accordion", "Buyer and seller"),
        s("footer_cta", "Talk to an agent", { layoutVariant: "centered-stack" }),
      ],
      contact: [
        s("contact_split", "Property enquiry"),
        s("faq_accordion", "Viewings"),
      ],
    },
  },
  {
    id: "creative-atelier",
    name: "Atelier",
    categories: ["creative"],
    visualFamily: "editorial-light",
    description: "Editorial hero, project strip, studio story — ateliers and studios.",
    chrome: { navShape: "split-inline", footerLayout: "centered" },
    motionPreset: "parallax-hero",
    widget: "none",
    inspiredBy: "Framer community moodboard (screenshot only) — editorial studio",
    pages: {
      home: [
        s("hero_editorial", "Studio opening", {
          layoutVariant: "full-bleed-left",
          mediaPosition: "background",
          density: "airy",
        }),
        s("portfolio_strip", "Selected work"),
        s("story_split", "How we make", { mediaPosition: "right", density: "airy" }),
        s("cta_band", "Start a project", { layoutVariant: "band-wide" }),
      ],
      about: [
        s("story_split", "Studio stance", { mediaPosition: "left", density: "airy" }),
        s("gallery_masonry", "The shop"),
        s("team_grid", "Makers"),
      ],
      services: [
        s("offer_index", "Disciplines"),
        s("horizontal_gallery", "Process stills"),
        s("footer_cta", "Commission", { layoutVariant: "centered-stack" }),
      ],
      contact: [
        s("contact_split", "Project enquiry"),
        s("faq_accordion", "Commissions"),
      ],
    },
  },
  {
    id: "creative-agency",
    name: "Agency reel",
    categories: ["creative"],
    visualFamily: "luxury-dark",
    description: "Video reel, case carousel, numbered capabilities — agencies.",
    chrome: { navShape: "floating-capsule", footerLayout: "cta-heavy", grainOverlay: true },
    motionPreset: "stagger",
    widget: "none",
    inspiredBy: "AstroWind (MIT) + Framer screenshot moodboard — motion agency on dark",
    pages: {
      home: [
        s("hero_metro", "Stills coming up", { layoutVariant: "centered-stack", density: "airy" }),
        s("portfolio_carousel", "Case films"),
        s("offer_index", "Capabilities"),
        s("testimonial_carousel", "Brand partners"),
        s("footer_cta", "Brief us", { layoutVariant: "centered-stack" }),
      ],
      about: [
        s("story_split", "Culture note", { mediaPosition: "right", density: "airy" }),
        s("logo_marquee", "Clients"),
        s("scroll_showcase", "How a brief moves"),
      ],
      services: [
        s("portfolio_strip", "Proof"),
        s("faq_accordion", "Kickoff"),
        s("cta_band", "Send the brief", { layoutVariant: "band-wide" }),
      ],
      contact: [
        s("contact_split", "New business"),
        s("faq_accordion", "Kickoff"),
      ],
    },
  },
  {
    id: "creative-form",
    name: "Form house",
    categories: ["creative"],
    visualFamily: "warm-consumer",
    description: "Split site opening, built-work gallery, practice story — architecture.",
    chrome: { navShape: "full-width", footerLayout: "two-column" },
    motionPreset: "slide-left",
    widget: "none",
    inspiredBy: "HyperUI portfolio sections (MIT) — spatial project grid, no proof stats",
    pages: {
      home: [
        s("hero_split_cinematic", "Site opening", {
          layoutVariant: "split-offset",
          mediaPosition: "left",
          density: "airy",
        }),
        s("horizontal_gallery", "Built work"),
        s("story_split", "How we site a building", { mediaPosition: "right", density: "airy" }),
        s("cta_band", "Discuss a site", { layoutVariant: "band-compact" }),
      ],
      about: [
        s("story_split", "Practice note", { mediaPosition: "left", density: "airy" }),
        s("gallery_masonry", "Models and sites"),
        s("team_grid", "Principals"),
      ],
      services: [
        s("scroll_showcase", "From brief to build"),
        s("portfolio_carousel", "Typologies"),
        s("footer_cta", "Request a visit", { layoutVariant: "centered-stack" }),
      ],
      contact: [
        s("contact_split", "Project enquiry"),
        s("faq_accordion", "Appointments"),
      ],
    },
  },
  {
    id: "creative-fashion",
    name: "House lookbook",
    categories: ["creative"],
    visualFamily: "luxury-dark",
    description: "Type-led lookbook, word marquee, garment strip — fashion houses.",
    chrome: { navShape: "floating-panel", footerLayout: "cta-heavy", grainOverlay: true },
    motionPreset: "parallax-hero",
    widget: "none",
    inspiredBy: "HyperUI banners (MIT) — centered type then a horizontal lookbook",
    pages: {
      home: [
        s("hero_statement", "Season opening", { layoutVariant: "centered-stack", density: "airy" }),
        s("text_marquee", "Collection words"),
        s("horizontal_gallery", "Lookbook"),
        s("portfolio_strip", "Archive"),
        s("cta_band", "Request a viewing", { layoutVariant: "band-wide" }),
      ],
      about: [
        s("story_split", "House note", { mediaPosition: "right", density: "airy" }),
        s("gallery_masonry", "Atelier"),
      ],
      services: [
        s("offer_index", "Atelier services"),
        s("menu_board", "Made-to-order"),
        s("footer_cta", "Commission a piece", { layoutVariant: "centered-stack" }),
      ],
      contact: [
        s("contact_split", "Private appointment"),
        s("faq_accordion", "Fittings"),
      ],
    },
  },
];

export const SITE_SKINS: SiteSkin[] = RAW_SKINS.map((skin) => SiteSkinSchema.parse(skin));

export function allSkins(): SiteSkin[] {
  const seen = new Set(SITE_SKINS.map((skin) => skin.id));
  const extra = loadApprovedSkins().filter((skin) => !seen.has(skin.id));
  return [...SITE_SKINS, ...extra];
}

export function getSkin(id: string): SiteSkin | undefined {
  return allSkins().find((skin) => skin.id === id);
}

export function skinsForCategory(category: SiteSkin["categories"][number]): SiteSkin[] {
  return allSkins().filter((skin) => skin.categories.includes(category));
}

export function listSkinIds(): string[] {
  return allSkins().map((skin) => skin.id);
}
