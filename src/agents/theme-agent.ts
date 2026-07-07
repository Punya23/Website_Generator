import type { SiteTheme } from "../types.js";
import { SiteThemeSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { ensureReadableTheme } from "../theme/contrast.js";

const THEME_SYSTEM = `You are the visual design director for a marketing website. Study the business and invent a cohesive visual system.

Think through:
- What mood and personality fit this brand?
- What palette expresses that mood while keeping mindful contrast everywhere (navigation links must be easy to read against the nav background; body text must be comfortable on card surfaces)?
- Where should accent color appear for emphasis — and where should it stay absent so the page breathes?
- Should the site feel light or dark? Luxurious or energetic? Editorial or trustworthy?
- How wide should the main content feel? How many columns suit card grids? How much vertical rhythm between sections?
- What motion personality suits the brand (subtle, bold, calm)?

Output valid JSON only:
{
  "vertical": "short industry slug derived from the business",
  "mood": "3-word mood",
  "fontHeading": "Google Font name",
  "fontBody": "Google Font name",
  "motionStyle": "short description of scroll/reveal personality",
  "layout": {
    "maxWidth": "CSS length for content width e.g. 1100px",
    "gridColumns": 2-4,
    "sectionGap": "CSS length between major sections",
    "cardMinHeight": "CSS min height for uniform cards"
  },
  "colors": {
    "bg": "page background",
    "surface": "card/panel background",
    "text": "primary text on surface",
    "muted": "secondary text",
    "accent": "brand emphasis color — use sparingly",
    "accentSoft": "subtle accent tint",
    "gradientFrom": "CTA gradient start",
    "gradientTo": "CTA gradient end",
    "navBg": "navigation bar background",
    "navText": "navigation link text — must contrast with navBg",
    "navMuted": "inactive nav links",
    "navActiveBg": "active nav pill/background",
    "navActiveText": "active nav label — must contrast with navActiveBg"
  }
}

You choose every value. No code. No CSS.`;

export const GENERIC_THEME: SiteTheme = {
  vertical: "business",
  mood: "clean modern refined",
  fontHeading: "Plus Jakarta Sans",
  fontBody: "Inter",
  motionStyle: "soft staggered reveals",
  motionPreset: "stagger",
  pageTone: "light",
  navTreatment: "solid",
  gradientMood: "subtle",
  accentRole: "sparing",
  layout: {
    maxWidth: "1200px",
    gridColumns: 3,
    sectionGap: "3rem",
    cardMinHeight: "200px",
  },
  colors: {
    bg: "#fafafa",
    surface: "#ffffff",
    text: "#111111",
    muted: "#666666",
    accent: "#c45c26",
    accentSoft: "#fff7ed",
    gradientFrom: "#c45c26",
    gradientTo: "#e85d04",
    navBg: "#ffffff",
    navText: "#111111",
    navMuted: "#666666",
    navActiveBg: "#c45c26",
    navActiveText: "#ffffff",
  },
};

/** @deprecated use GENERIC_THEME — kept for tests */
export const PRESETS = { default: GENERIC_THEME, salon: GENERIC_THEME, finserv: GENERIC_THEME, fitness: GENERIC_THEME, restaurant: GENERIC_THEME };

export async function generateTheme(
  businessName: string,
  businessBrief: string,
  rawBrief?: string
): Promise<SiteTheme> {
  if (llm.isAvailable) {
    try {
      const raw = await llm.chat(
        THEME_SYSTEM,
        `Business: ${businessName}\nBrief: ${businessBrief}\nUser input: ${rawBrief ?? businessBrief}`,
        { jsonMode: true, temperature: 0.65, tokenRole: "design" }
      );
      return ensureReadableTheme(SiteThemeSchema.parse(JSON.parse(raw)));
    } catch {
      // fall through
    }
  }
  return ensureReadableTheme({ ...GENERIC_THEME, vertical: slugifyIndustry(businessBrief) });
}

export function slugifyIndustry(brief: string): string {
  const words = brief
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 2);
  return words.join("-") || "business";
}

/** @deprecated industry is LLM-derived; kept for compatibility */
export function detectVertical(brief: string): string {
  return slugifyIndustry(brief);
}
