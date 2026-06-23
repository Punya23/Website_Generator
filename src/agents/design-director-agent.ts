import type { SiteTheme } from "../types.js";
import { SiteThemeSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { ensureReadableTheme } from "../theme/contrast.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { GENERIC_THEME, slugifyIndustry } from "./theme-agent.js";

const DESIGN_SYSTEM_PROMPT = `You are the visual design director for a marketing website. Study the business and invent a complete design system.

Think through mood, mindful contrast (navigation readable, text comfortable on surfaces), where accent appears sparingly, content width, grid rhythm, card density, and motion personality.

Output valid JSON only — you choose every value:
{
  "vertical": "industry slug",
  "mood": "3-word mood",
  "fontHeading": "Google Font",
  "fontBody": "Google Font",
  "motionStyle": "scroll personality",
  "motionPreset": "fade-up|stagger|scale-in|slide-left|parallax-hero|none",
  "layout": {
    "maxWidth": "CSS length",
    "gridColumns": 2-4,
    "sectionGap": "CSS length",
    "cardMinHeight": "auto or CSS min-height"
  },
  "colors": {
    "bg", "surface", "text", "muted", "accent", "accentSoft",
    "gradientFrom", "gradientTo", "navBg", "navText", "navMuted", "navActiveBg", "navActiveText"
  }
}`;

export async function generateDesignSystem(
  businessName: string,
  businessBrief: string,
  rawBrief?: string
): Promise<SiteTheme> {
  requireLlm("design system");

  if (llm.isAvailable) {
    try {
      const raw = await llm.chat(
        DESIGN_SYSTEM_PROMPT,
        `Business: ${businessName}\nBrief: ${businessBrief}\nUser: ${rawBrief ?? businessBrief}`,
        { jsonMode: true, temperature: 0.65 }
      );
      return ensureReadableTheme(SiteThemeSchema.parse(JSON.parse(raw)));
    } catch (err) {
      if (!allowMocks()) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  if (!allowMocks()) {
    throw new Error("Design system generation failed");
  }

  return ensureReadableTheme({ ...GENERIC_THEME, vertical: slugifyIndustry(businessBrief) });
}

/** @deprecated alias */
export const generateTheme = generateDesignSystem;
