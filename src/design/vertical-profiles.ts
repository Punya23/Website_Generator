import type { ExpandedBrief, SitePlan } from "../types.js";
import type { MotionPreset } from "../types.js";
import { slugifyIndustry } from "../agents/theme-agent.js";

export type VerticalProfileId =
  | "luxury-dark"
  | "clinical-light"
  | "corporate-light"
  | "editorial-light"
  | "warm-consumer";

export type NavShapeHint = "full-width" | "floating-capsule" | "floating-panel" | "split-inline";

export interface VerticalDesignProfile {
  profileId: VerticalProfileId;
  pageTone: "light" | "dark" | "warm" | "cool";
  navTreatment: "glass-dark" | "glass-light" | "solid" | "minimal";
  /** A prior for nav-surface-agent, not a forced choice — the LLM can and should override it. */
  navShape: NavShapeHint;
  motionPreset: MotionPreset;
  heroBias: string;
  blueprintFamily: string;
  grainOverlay: boolean;
  paletteHints: string;
  typographyHints: string;
  industryFamily: string;
  copyHints: string;
  imageHints: string;
  ctaPatterns: string[];
  proofPatterns: string[];
}

const LUXURY_DARK = /\b(salon|spa|barber|nightclub|luxury|boutique|jewel|hair|beauty|wellness retreat)\b/i;
const CLINICAL = /\b(dental|clinic|medical|doctor|healthcare|hospital|therapy|orthodont|physio)\b/i;
const CORPORATE = /\b(finance|financial|insurance|law|legal|accounting|consulting|b2b|capital|wealth|advisor)\b/i;
const EDITORIAL = /\b(fashion|editorial|studio|agency|creative|photography|design firm|atelier|architecture|architect)\b/i;
const WARM = /\b(restaurant|cafe|food|fitness|gym|yoga|pet|coffee|catering)\b/i;
const FOOD_RETAIL = /\b(bakery|bread|pastry|grocery|retail|shop|store|boutique|florist|butcher|deli)\b/i;
const HEALTH = /\b(health|wellness|chiropractic|dermatolog|skincare|aesthetic|medspa)\b/i;

const PROFILE_ARCHETYPE = /\b(luxury-dark|clinical-light|corporate-light|editorial-light|warm-consumer)\b/i;

export function profileIdFromArchetype(archetype?: string): VerticalProfileId | null {
  if (!archetype) return null;
  const match = archetype.toLowerCase().match(PROFILE_ARCHETYPE);
  if (match?.[1]) return match[1] as VerticalProfileId;
  const arch = archetype.toLowerCase();
  if (arch.includes("clinical")) return "clinical-light";
  if (arch.includes("corporate") || arch.includes("finance")) return "corporate-light";
  if (arch.includes("editorial") || arch.includes("fashion")) return "editorial-light";
  if (arch.includes("luxury") || arch.includes("salon") || arch.includes("spa")) return "luxury-dark";
  if (arch.includes("restaurant") || arch.includes("fitness") || arch.includes("warm")) return "warm-consumer";
  return null;
}

export function inferVerticalProfile(
  brief: ExpandedBrief,
  sitePlan?: Pick<SitePlan, "visualArchetype" | "compositionStrategy" | "industryFamily">
): VerticalDesignProfile {
  const fromArchetype = profileIdFromArchetype(sitePlan?.visualArchetype);
  if (fromArchetype) {
    return profileDefaults(fromArchetype, brief, sitePlan);
  }

  const text = [
    brief.businessName,
    brief.expandedBrief,
    brief.elevatorPitch,
    brief.tagline,
    brief.tone,
    sitePlan?.visualArchetype ?? "",
    sitePlan?.compositionStrategy ?? "",
    ...brief.services,
    ...brief.differentiators,
  ]
    .join(" ")
    .toLowerCase();

  let profileId: VerticalProfileId = "warm-consumer";
  if (EDITORIAL.test(text)) profileId = "editorial-light";
  else if (CLINICAL.test(text) || HEALTH.test(text)) profileId = "clinical-light";
  else if (CORPORATE.test(text)) profileId = "corporate-light";
  else if (LUXURY_DARK.test(text)) profileId = "luxury-dark";
  else if (WARM.test(text) || FOOD_RETAIL.test(text)) profileId = "warm-consumer";

  return profileDefaults(profileId, brief, sitePlan);
}

function profileDefaults(
  profileId: VerticalProfileId,
  brief: ExpandedBrief,
  sitePlan?: Pick<SitePlan, "visualArchetype" | "industryFamily">
): VerticalDesignProfile {
  const industryFamily =
    sitePlan?.industryFamily?.trim() ||
    slugifyIndustry(brief.expandedBrief || brief.businessName);

  const base: Record<VerticalProfileId, VerticalDesignProfile> = {
    "luxury-dark": {
      profileId: "luxury-dark",
      pageTone: "dark",
      navTreatment: "solid",
      navShape: "floating-capsule",
      motionPreset: "parallax-hero",
      heroBias: "hero_spotlight",
      blueprintFamily: "luxury-dark",
      grainOverlay: false,
      paletteHints: "Deep charcoal bg (#0a0a0a–#121212), rose gold or copper accent, vivid gradients for CTAs",
      typographyHints: "Playfair Display or Cormorant heading, light body sans, airy section gaps",
      industryFamily,
      copyHints: "Intimate, refined voice. Use Reserve, Book, Experience. Avoid cheap, deal, discount.",
      imageHints: "Moody salon/spa interior, warm low-key lighting, editorial portraits, luxe textures",
      ctaPatterns: ["Reserve", "Book", "Experience"],
      proofPatterns: ["testimonials", "transformations", "portfolio"],
    },
    "clinical-light": {
      profileId: "clinical-light",
      pageTone: "light",
      navTreatment: "solid",
      navShape: "full-width",
      motionPreset: "fade-up",
      heroBias: "hero_split_cinematic",
      blueprintFamily: "clinical-light",
      grainOverlay: false,
      paletteHints: "Clean white/slate bg (#f8fafc), teal or blue accent, trustworthy calm mood",
      typographyHints: "DM Sans or Inter, normal spacing, readable body",
      industryFamily,
      copyHints: "Reassuring, credential-forward. Use Schedule, Book appointment, Consult. Avoid hype, miracle.",
      imageHints: "Clean modern dental/clinic, bright natural light, smiling patients, sterile professionalism",
      ctaPatterns: ["Schedule", "Book appointment", "Consult"],
      proofPatterns: ["stats", "credentials", "before_after"],
    },
    "corporate-light": {
      profileId: "corporate-light",
      pageTone: "cool",
      navTreatment: "solid",
      navShape: "full-width",
      motionPreset: "fade-up",
      heroBias: "hero_editorial",
      blueprintFamily: "corporate-light",
      grainOverlay: false,
      paletteHints: "Cool light gray bg, navy/slate accent, restrained subtle gradients",
      typographyHints: "Plus Jakarta Sans or Inter, professional hierarchy",
      industryFamily,
      copyHints: "Assured, outcome-focused B2B tone. Use Request demo, Talk to us, Get started. Avoid casual slang.",
      imageHints: "Modern office, diverse professionals, city skyline, handshake meetings",
      ctaPatterns: ["Request demo", "Talk to us", "Get started"],
      proofPatterns: ["stats", "logos", "case studies"],
    },
    "editorial-light": {
      profileId: "editorial-light",
      pageTone: "warm",
      navTreatment: "minimal",
      navShape: "split-inline",
      motionPreset: "stagger",
      heroBias: "hero_spotlight",
      blueprintFamily: "editorial-light",
      grainOverlay: false,
      paletteHints: "Warm white editorial bg, strong accent (terracotta or ink), vivid gradient CTAs",
      typographyHints: "Display serif heading (Playfair), airy gaps, editorial label typography",
      industryFamily,
      copyHints: "Editorial, manifesto-driven. Use Start a project, Collaborate, View work. Avoid corporate jargon.",
      imageHints: "Fashion editorial, studio workspace, bold typography layouts, creative process",
      ctaPatterns: ["Start a project", "Collaborate", "View work"],
      proofPatterns: ["portfolio", "featured testimonial", "press"],
    },
    "warm-consumer": {
      profileId: "warm-consumer",
      pageTone: "warm",
      navTreatment: "solid",
      navShape: "floating-panel",
      motionPreset: "stagger",
      heroBias: "hero_video",
      blueprintFamily: "warm-consumer",
      grainOverlay: false,
      paletteHints: "Warm off-white bg (#faf7f2), energetic orange or green accent",
      typographyHints: "Rounded friendly sans, normal-to-airy spacing",
      industryFamily,
      copyHints: "Energetic, welcoming, community tone. Use Join, Visit today, Sign up. Avoid stiff formality.",
      imageHints: "Warm restaurant/fitness scenes, natural light, happy customers, vibrant food or activity",
      ctaPatterns: ["Join", "Visit today", "Sign up"],
      proofPatterns: ["reviews", "community stats", "before_after"],
    },
  };

  const profile = { ...base[profileId] };
  if (sitePlan?.visualArchetype) {
    const arch = sitePlan.visualArchetype.toLowerCase();
    const explicit = profileIdFromArchetype(sitePlan.visualArchetype);
    if (explicit) profile.profileId = explicit;
    else if (arch.includes("dark") && profile.pageTone === "light") profile.pageTone = "dark";
    else if (arch.includes("clinical")) profile.profileId = "clinical-light";
    else if (arch.includes("editorial") || arch.includes("fashion")) profile.profileId = "editorial-light";
  }
  profile.industryFamily = industryFamily;
  return profile;
}

export interface ProfilePaletteColors {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  gradientFrom: string;
  gradientTo: string;
}

export function mockPaletteForProfile(
  profile: VerticalDesignProfile,
  businessName: string
): {
  vertical: string;
  mood: string;
  gradientMood: "subtle" | "vivid" | "monochrome";
  accentRole: "sparing" | "hero" | "editorial";
  colors: ProfilePaletteColors;
} {
  const palettes: Record<VerticalProfileId, ProfilePaletteColors & { mood: string }> = {
    "luxury-dark": {
      mood: "luxury intimate refined",
      bg: "#0a0a0a",
      surface: "#141414",
      text: "#f5f5f5",
      muted: "#a3a3a3",
      accent: "#d4a574",
      accentSoft: "#2a2218",
      gradientFrom: "#d4a574",
      gradientTo: "#c9a962",
    },
    "clinical-light": {
      mood: "trustworthy calm clinical",
      bg: "#f8fafc",
      surface: "#ffffff",
      text: "#0f172a",
      muted: "#64748b",
      accent: "#0d9488",
      accentSoft: "#ccfbf1",
      gradientFrom: "#0d9488",
      gradientTo: "#14b8a6",
    },
    "corporate-light": {
      mood: "professional assured",
      bg: "#f1f5f9",
      surface: "#ffffff",
      text: "#0f172a",
      muted: "#64748b",
      accent: "#1e3a5f",
      accentSoft: "#e2e8f0",
      gradientFrom: "#1e3a5f",
      gradientTo: "#334155",
    },
    "editorial-light": {
      mood: "editorial luxe refined",
      bg: "#faf8f5",
      surface: "#ffffff",
      text: "#1a1a1a",
      muted: "#666666",
      accent: "#c45c26",
      accentSoft: "#fff7ed",
      gradientFrom: "#c45c26",
      gradientTo: "#e85d04",
    },
    "warm-consumer": {
      mood: "warm energetic welcoming",
      bg: "#faf7f2",
      surface: "#ffffff",
      text: "#1c1917",
      muted: "#78716c",
      accent: "#ea580c",
      accentSoft: "#ffedd5",
      gradientFrom: "#ea580c",
      gradientTo: "#f97316",
    },
  };

  const p = palettes[profile.profileId];
  return {
    vertical: profile.industryFamily || slugifyIndustry(businessName),
    mood: p.mood,
    gradientMood: profile.profileId === "luxury-dark" ? "vivid" : "subtle",
    accentRole: profile.profileId === "editorial-light" ? "editorial" : "hero",
    colors: p,
  };
}

export function mockNavForProfile(profile: VerticalDesignProfile): {
  pageTone: VerticalDesignProfile["pageTone"];
  navTreatment: VerticalDesignProfile["navTreatment"];
  navShape: VerticalDesignProfile["navShape"];
  surfaces: { default?: "none" | "subtle" | "elevated" | "bordered"; elevated?: "none" | "subtle" | "elevated" | "bordered"; none?: "none" | "subtle" | "elevated" | "bordered" };
  colors: {
    navBg: string;
    navText: string;
    navMuted: string;
    navActiveBg: string;
    navActiveText: string;
  };
} {
  const dark = profile.pageTone === "dark";
  return {
    pageTone: profile.pageTone,
    navTreatment: profile.navTreatment,
    navShape: profile.navShape,
    surfaces: {
      default: dark ? "subtle" : "none",
      elevated: "elevated",
      none: "none",
    },
    colors: dark
      ? {
          navBg: "rgba(255,255,255,0.08)",
          navText: "#f5f5f5",
          navMuted: "#a3a3a3",
          navActiveBg: "#d4a574",
          navActiveText: "#0a0a0a",
        }
      : profile.navTreatment === "glass-dark"
        ? {
            navBg: "rgba(10,12,18,0.72)",
            navText: "#f5f5f5",
            navMuted: "#a3a3a3",
            navActiveBg: mockPaletteForProfile(profile, "").colors.accent,
            navActiveText: "#ffffff",
          }
        : {
            navBg: "rgba(255,255,255,0.95)",
            navText: "#0f172a",
            navMuted: "#64748b",
            navActiveBg: mockPaletteForProfile(profile, "").colors.accent,
            navActiveText: "#ffffff",
          },
  };
}

export function mockTypographyForProfile(profile: VerticalDesignProfile): {
  fontHeading: string;
  fontBody: string;
  sectionGapMode: "tight" | "normal" | "airy";
  layout: { maxWidth: string; gridColumns: number; sectionGap: string; cardMinHeight: string };
  typography: { display: string; heading: string; body: string; label: string; mono: string };
} {
  const pairs: Record<VerticalProfileId, { h: string; b: string; gap: "tight" | "normal" | "airy" }> = {
    "luxury-dark": { h: "Cormorant Garamond", b: "Inter", gap: "airy" },
    "clinical-light": { h: "DM Sans", b: "Inter", gap: "normal" },
    "corporate-light": { h: "Plus Jakarta Sans", b: "Inter", gap: "normal" },
    "editorial-light": { h: "Playfair Display", b: "Inter", gap: "airy" },
    "warm-consumer": { h: "Outfit", b: "Inter", gap: "normal" },
  };
  const p = pairs[profile.profileId];
  return {
    fontHeading: p.h,
    fontBody: p.b,
    sectionGapMode: p.gap,
    layout: {
      maxWidth: "1200px",
      gridColumns: 3,
      sectionGap: p.gap === "airy" ? "5rem" : p.gap === "tight" ? "3rem" : "4rem",
      cardMinHeight: "auto",
    },
    typography: {
      display: p.h,
      heading: p.h,
      body: p.b,
      label: p.b,
      mono: "IBM Plex Mono",
    },
  };
}
