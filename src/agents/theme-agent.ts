import type { SiteTheme } from "../types.js";
import { SiteThemeSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { normalizeTheme } from "../theme/contrast.js";

const THEME_SYSTEM = `You are a brand design director. Output a cohesive visual theme with ACCESSIBLE contrast.

Output valid JSON:
{
  "vertical": "salon|finserv|restaurant|fitness|tech|healthcare|default",
  "mood": "3-word mood",
  "fontHeading": "Google Font name",
  "fontBody": "Google Font name",
  "colors": {
    "bg": "#hex page background",
    "surface": "#hex card background — MUST contrast with bg (not same hue/intensity)",
    "text": "#hex primary text — WCAG AA on surface (4.5:1+)",
    "muted": "#hex secondary text — readable on surface",
    "accent": "#hex brand accent for links/stats",
    "accentSoft": "#hex subtle tint for hover states ONLY — not card backgrounds",
    "gradientFrom": "#hex",
    "gradientTo": "#hex",
    "navBg": "rgba(...) translucent nav"
  }
}

CRITICAL CONTRAST RULES:
- NEVER put text on accentSoft — cards use surface + text
- Dark sites: surface slightly lighter than bg; text near white on surface
- Light sites: surface white/off-white; text dark slate on surface
- accentSoft is a 10-15% accent tint, NOT a second card color
- Fitness: dark bg #0a0a0a, surface #171717, text #fafafa, electric accent
- Salon: warm cream bg, white surface, dark brown text
- Only output JSON`;

const PRESETS: Record<string, SiteTheme> = {
  salon: {
    vertical: "salon",
    mood: "luxe warm inviting",
    fontHeading: "Playfair Display",
    fontBody: "Lato",
    colors: {
      bg: "#faf8f5",
      surface: "#ffffff",
      text: "#1c1917",
      muted: "#78716c",
      accent: "#b45309",
      accentSoft: "#fef3c7",
      gradientFrom: "#92400e",
      gradientTo: "#d97706",
      navBg: "rgba(255,255,255,0.92)",
    },
  },
  finserv: {
    vertical: "finserv",
    mood: "trusted premium calm",
    fontHeading: "DM Serif Display",
    fontBody: "Inter",
    colors: {
      bg: "#f8fafc",
      surface: "#ffffff",
      text: "#0f172a",
      muted: "#64748b",
      accent: "#1e40af",
      accentSoft: "#dbeafe",
      gradientFrom: "#1e3a5f",
      gradientTo: "#2563eb",
      navBg: "rgba(255,255,255,0.94)",
    },
  },
  restaurant: {
    vertical: "restaurant",
    mood: "warm artisan cozy",
    fontHeading: "Fraunces",
    fontBody: "Source Sans 3",
    colors: {
      bg: "#faf6f1",
      surface: "#ffffff",
      text: "#292524",
      muted: "#78716c",
      accent: "#c2410c",
      accentSoft: "#ffedd5",
      gradientFrom: "#9a3412",
      gradientTo: "#ea580c",
      navBg: "rgba(255,255,255,0.93)",
    },
  },
  fitness: {
    vertical: "fitness",
    mood: "bold energetic modern",
    fontHeading: "Oswald",
    fontBody: "Nunito Sans",
    colors: {
      bg: "#0a0a0a",
      surface: "#171717",
      text: "#fafafa",
      muted: "#a3a3a3",
      accent: "#22d3ee",
      accentSoft: "#164e63",
      gradientFrom: "#0891b2",
      gradientTo: "#06b6d4",
      navBg: "rgba(10,10,10,0.9)",
    },
  },
  default: {
    vertical: "default",
    mood: "clean modern professional",
    fontHeading: "Plus Jakarta Sans",
    fontBody: "Inter",
    colors: {
      bg: "#f8fafc",
      surface: "#ffffff",
      text: "#0f172a",
      muted: "#64748b",
      accent: "#6366f1",
      accentSoft: "#eef2ff",
      gradientFrom: "#4f46e5",
      gradientTo: "#818cf8",
      navBg: "rgba(255,255,255,0.92)",
    },
  },
};

function detectVertical(brief: string): keyof typeof PRESETS {
  const b = brief.toLowerCase();
  if (/salon|hair|beauty|spa|barber|nail/.test(b)) return "salon";
  if (/finance|wealth|invest|bank|insurance|legal|finserv|capital/.test(b)) return "finserv";
  if (/restaurant|food|cafe|bakery|chef|dining/.test(b)) return "restaurant";
  if (/gym|fitness|yoga|crossfit|trainer|workout/.test(b)) return "fitness";
  if (/clinic|health|medical|dental|doctor/.test(b)) return "finserv";
  return "default";
}

export async function generateTheme(
  businessName: string,
  businessBrief: string,
  rawBrief?: string
): Promise<SiteTheme> {
  const verticalHint = detectVertical(rawBrief ?? businessBrief);
  if (llm.isAvailable) {
    try {
      const raw = await llm.chat(
        THEME_SYSTEM,
        `Business: ${businessName}\nBrief: ${businessBrief}`,
        { jsonMode: true, temperature: 0.5 }
      );
      return normalizeTheme(SiteThemeSchema.parse(JSON.parse(raw)));
    } catch {
      // fall through to preset
    }
  }
  return normalizeTheme({ ...PRESETS[verticalHint] });
}

export { PRESETS, detectVertical };
