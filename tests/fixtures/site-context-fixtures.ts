import type { ContentBlock, LayoutNode, PageSection, SiteContext, SiteTheme } from "../src/types.js";

export const FIXTURE_THEME: SiteTheme = {
  vertical: "restaurant",
  mood: "warm editorial",
  fontHeading: "Georgia",
  fontBody: "Inter",
  colors: {
    bg: "#faf8f5",
    surface: "#ffffff",
    text: "#1a1a1a",
    muted: "#5c5c5c",
    accent: "#8b4513",
    accentSoft: "#f3e8dc",
    gradientFrom: "#2c1810",
    gradientTo: "#5c3d2e",
    navBg: "#1a1a1a",
  },
  layout: { gridColumns: 3, cardDensity: "comfortable" },
};

const HOME_BLOCKS: ContentBlock[] = [
  { id: "home_hero_headline", type: "headline", text: "Anna's Kitchen", subtext: "Farm-to-table dining" },
  { id: "home_proof_stat_0", type: "stat", value: "4.9★", label: "Guest rating" },
  { id: "home_proof_stat_1", type: "stat", value: "12yr", label: "In business" },
  { id: "home_proof_stat_2", type: "stat", value: "50+", label: "Local farms" },
  { id: "home_main_feature_0", type: "feature", title: "Seasonal tasting", description: "A rotating menu built from what is freshest this week." },
  { id: "home_main_feature_1", type: "feature", title: "Private dining", description: "Intimate rooms for celebrations and chef-led experiences." },
  { id: "home_main_feature_2", type: "feature", title: "Wine pairings", description: "Sommelier-selected pairings from small producers." },
  { id: "home_close_cta", type: "cta", headline: "Reserve your table", buttonText: "Book now" },
];

const HOME_SECTIONS: PageSection[] = [
  {
    id: "home_hero",
    intent: "Full-bleed hero",
    blocks: [HOME_BLOCKS[0]!],
    layout: { type: "Section", fullBleed: true, children: ["home_hero_headline"] },
  },
  {
    id: "home_proof",
    intent: "Stats row",
    blocks: HOME_BLOCKS.slice(1, 4),
    layout: {
      type: "Section",
      fullBleed: false,
      children: [
        {
          type: "Row",
          columns: 3,
          children: ["home_proof_stat_0", "home_proof_stat_1", "home_proof_stat_2"],
        },
      ],
    },
  },
  {
    id: "home_main",
    intent: "Service cards",
    blocks: HOME_BLOCKS.slice(4, 7),
    layout: {
      type: "Section",
      fullBleed: false,
      children: [
        {
          type: "Grid",
          columns: 3,
          children: ["home_main_feature_0", "home_main_feature_1", "home_main_feature_2"],
        },
      ],
    },
  },
  {
    id: "home_close",
    intent: "CTA",
    blocks: [HOME_BLOCKS[7]!],
    layout: { type: "Section", fullBleed: true, children: ["home_close_cta"] },
  },
];

export function annasKitchenFixture(): SiteContext {
  const layout: LayoutNode = {
    type: "Stack",
    children: HOME_SECTIONS.map((s) => s.layout),
  };

  return {
    businessName: "Anna's Kitchen",
    businessBrief: "Farm-to-table restaurant in Portland",
    expandedBrief: {
      businessName: "Anna's Kitchen",
      tagline: "Seasonal plates, honest ingredients",
      elevatorPitch: "Anna's Kitchen celebrates Pacific Northwest produce with a warm, neighborhood feel.",
      expandedBrief:
        "Anna's Kitchen is a farm-to-table restaurant in Portland serving seasonal menus sourced from local farms.",
      targetAudience: "Food lovers and families",
      services: ["Dinner", "Brunch", "Private events"],
      differentiators: ["Local sourcing", "Chef-driven menu"],
      tone: "warm confident",
      primaryCta: "Reserve",
      secondaryCta: "View menu",
    },
    sitePlan: {
      pages: [
        {
          slug: "home",
          title: "Home",
          navLabel: "Home",
          goal: "Drive reservations",
          minBlocks: 8,
          layoutHint: "Hero, stats, features, CTA",
          contentFocus: ["menu", "proof"],
          sections: HOME_SECTIONS.map((s) => ({
            id: s.id,
            intent: s.intent,
            blockTypes: s.blocks.map((b) => b.type),
          })),
        },
      ],
      compositionStrategy: "Editorial restaurant rhythm",
      avoidPatterns: ["headline beside full image in row"],
      visualArchetype: "warm-editorial",
      motionStyle: "soft reveal",
    },
    designSystem: FIXTURE_THEME,
    pages: {
      home: {
        slug: "home",
        title: "Home",
        navLabel: "Home",
        sections: HOME_SECTIONS,
        content: HOME_BLOCKS,
        layout,
      },
    },
    mediaRegistry: [],
    qaHistory: [],
  };
}

export function salonFixture(): SiteContext {
  const blocks: ContentBlock[] = [
    { id: "home_hero_headline", type: "headline", text: "Lumière Salon", subtext: "Luxury hair in Austin" },
    { id: "home_main_feature_0", type: "feature", title: "Balayage", description: "Hand-painted color with dimension." },
    { id: "home_main_feature_1", type: "feature", title: "Cuts", description: "Precision cuts tailored to your face and lifestyle." },
    { id: "home_close_cta", type: "cta", headline: "Book an appointment", buttonText: "Book" },
  ];

  const sections: PageSection[] = [
    {
      id: "home_hero",
      intent: "Hero",
      blocks: [blocks[0]!],
      layout: { type: "Section", fullBleed: true, children: ["home_hero_headline"] },
    },
    {
      id: "home_main",
      intent: "Services",
      blocks: blocks.slice(1, 3),
      layout: {
        type: "Section",
        fullBleed: false,
        children: [{ type: "Grid", columns: 2, children: ["home_main_feature_0", "home_main_feature_1"] }],
      },
    },
    {
      id: "home_close",
      intent: "CTA",
      blocks: [blocks[3]!],
      layout: { type: "Section", fullBleed: false, children: ["home_close_cta"] },
    },
  ];

  return {
    businessName: "Lumière Salon",
    businessBrief: "Luxury hair salon in Austin",
    expandedBrief: {
      businessName: "Lumière Salon",
      tagline: "Light up your look",
      elevatorPitch: "Austin's destination for color and cut.",
      expandedBrief: "Lumière Salon offers luxury hair services in downtown Austin.",
      targetAudience: "Style-conscious clients",
      services: ["Color", "Cut", "Styling"],
      differentiators: ["Expert colorists"],
      tone: "luxury warm",
      primaryCta: "Book",
      secondaryCta: "Services",
    },
    sitePlan: {
      pages: [
        {
          slug: "home",
          title: "Home",
          navLabel: "Home",
          goal: "Bookings",
          minBlocks: 4,
          layoutHint: "Hero and service grid",
          contentFocus: ["services"],
        },
      ],
      compositionStrategy: "Salon showcase",
      avoidPatterns: [],
      visualArchetype: "salon-luxury",
      motionStyle: "stagger",
    },
    designSystem: {
      ...FIXTURE_THEME,
      vertical: "salon",
      mood: "luxury minimal",
      colors: { ...FIXTURE_THEME.colors, accent: "#c9a87c", navBg: "#111111" },
    },
    pages: {
      home: {
        slug: "home",
        title: "Home",
        navLabel: "Home",
        sections,
        content: blocks,
        layout: { type: "Stack", children: sections.map((s) => s.layout) },
      },
    },
    mediaRegistry: [],
    qaHistory: [],
  };
}
