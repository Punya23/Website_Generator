/**
 * Look tokens owned by each authored skin. Not inferred from the brief and not
 * the five regex vertical palettes.
 */
import type { SiteTheme } from "../types.js";
import type { SiteSkin, SkinVisualFamily } from "./schema.js";

export type SkinTokenPack = Pick<
  SiteTheme,
  "mood" | "fontHeading" | "fontBody" | "pageTone" | "navTreatment" | "gradientMood" | "accentRole" | "sectionGapMode"
> & {
  colors: SiteTheme["colors"];
  layout: NonNullable<SiteTheme["layout"]>;
};

const FAMILY_FALLBACK: Record<SkinVisualFamily, SkinTokenPack> = {
  "luxury-dark": pack("#0c0b0a", "#161412", "#f4efe6", "#a89f91", "#c6a06a", "#2a2418", "dark", "Cormorant Garamond", "Source Sans 3"),
  "clinical-light": pack("#f4f7f6", "#ffffff", "#14302a", "#5b716c", "#1f7a6e", "#d7efe9", "light", "Source Serif 4", "Source Sans 3"),
  "corporate-light": pack("#f3f1ec", "#ffffff", "#1b2430", "#5c6570", "#1f3d5c", "#e4eaf1", "light", "Libre Baskerville", "Source Sans 3"),
  "editorial-light": pack("#f7f2ea", "#fffdf8", "#1c1410", "#6b5e54", "#9c3b1e", "#f3e0d4", "light", "Fraunces", "Figtree"),
  "warm-consumer": pack("#f6efe4", "#fffaf3", "#2a1d14", "#7a6554", "#c45c26", "#f6ddc8", "warm", "Fraunces", "Nunito Sans"),
};

/** One look per authored skin so two skins in the same family still do not share a palette. */
export const SKIN_TOKEN_PACKS: Record<string, SkinTokenPack> = {
  "local-service-trades": pack("#1a1612", "#241e18", "#f3eadc", "#b7a894", "#d97706", "#3b2a14", "dark", "IBM Plex Sans", "IBM Plex Sans", {
    mood: "workshop grit, ochre type",
    navTreatment: "solid",
    accentRole: "hero",
  }),
  "local-service-clinic": pack("#f3f6f5", "#ffffff", "#13322c", "#58716b", "#0f766e", "#ccfbf1", "light", "Source Serif 4", "Source Sans 3", {
    mood: "quiet clinic, seafoam ink",
    navTreatment: "minimal",
    sectionGapMode: "airy",
  }),
  "local-service-salon": pack("#140f12", "#1d1619", "#f7ebe4", "#c4a99c", "#e8b4a2", "#3a2428", "dark", "Cormorant Garamond", "Outfit", {
    mood: "chair-side rose on black",
    navTreatment: "glass-dark",
    accentRole: "editorial",
  }),
  "local-service-fitness": pack("#0b0d0c", "#121512", "#e8f5c8", "#8fa37a", "#b8f229", "#1c2610", "dark", "Barlow Condensed", "Barlow", {
    mood: "floor chalk and lime",
    navTreatment: "solid",
    accentRole: "hero",
    sectionGapMode: "tight",
  }),
  "local-service-shop": pack("#f4ead9", "#fff8ec", "#3b2114", "#7a5844", "#9f1239", "#f3d5c4", "warm", "Fraunces", "Karla", {
    mood: "counter cream and oxblood",
    navTreatment: "solid",
  }),
  "hospitality-restaurant": pack("#1c1210", "#271816", "#f6e7d4", "#c4a48c", "#b42318", "#3a1c16", "dark", "Libre Baskerville", "Source Sans 3", {
    mood: "wine list, candle paper",
    navTreatment: "glass-dark",
    accentRole: "editorial",
  }),
  "hospitality-inn": pack("#eef1e8", "#f7f6ef", "#243126", "#5d6b5c", "#3f6212", "#dce7c8", "light", "Newsreader", "Figtree", {
    mood: "linen and garden green",
    navTreatment: "minimal",
    sectionGapMode: "airy",
  }),
  "hospitality-cafe": pack("#f7efe6", "#fffaf4", "#3d2416", "#8a6a52", "#c2410c", "#fed7aa", "warm", "Nunito", "Nunito Sans", {
    mood: "morning terracotta",
    navTreatment: "solid",
  }),
  "professional-counsel": pack("#f4f0e6", "#fffcf7", "#1b2433", "#5a6574", "#1e3a5f", "#dbe4ef", "light", "Source Serif 4", "Source Sans 3", {
    mood: "chambers ivory and navy",
    navTreatment: "minimal",
    accentRole: "sparing",
  }),
  "professional-capital": pack("#101418", "#171d24", "#e8eef4", "#9aa8b5", "#c9a227", "#2a2514", "dark", "Playfair Display", "IBM Plex Sans", {
    mood: "desk charcoal, coin gold",
    navTreatment: "solid",
    accentRole: "hero",
  }),
  "professional-practice": pack("#ece8e1", "#f8f5f0", "#1f1b16", "#6b645c", "#44403c", "#ddd6cc", "light", "DM Sans", "DM Sans", {
    mood: "stone desk, ink rules",
    navTreatment: "minimal",
    accentRole: "sparing",
  }),
  "professional-realty": pack("#f2eee8", "#ffffff", "#1c2a32", "#5d6d76", "#9a3412", "#f3d5c4", "light", "Karla", "Karla", {
    mood: "listing slate and copper",
    navTreatment: "solid",
  }),
  "creative-atelier": pack("#efe6d6", "#f8f1e4", "#1a140e", "#6e5b48", "#111111", "#e7d5b8", "warm", "Syne", "Manrope", {
    mood: "kraft paper studio",
    navTreatment: "minimal",
    accentRole: "editorial",
  }),
  "creative-agency": pack("#f7f7f5", "#ffffff", "#111827", "#4b5563", "#2563eb", "#dbeafe", "light", "Space Grotesk", "Inter", {
    mood: "poster blue on newsprint",
    navTreatment: "solid",
    accentRole: "hero",
    sectionGapMode: "tight",
  }),
  "creative-form": pack("#e8e4dc", "#f4f1ea", "#1c1917", "#57534e", "#9a3412", "#fed7aa", "light", "Archivo", "Archivo", {
    mood: "concrete and rust filings",
    navTreatment: "solid",
    accentRole: "editorial",
  }),
  "creative-fashion": pack("#f5f0e8", "#fffcf8", "#14110f", "#6b6258", "#111111", "#e7e0d6", "light", "Cormorant Garamond", "Outfit", {
    mood: "lookbook bone and black",
    navTreatment: "minimal",
    accentRole: "editorial",
    sectionGapMode: "airy",
  }),
};

function pack(
  bg: string,
  surface: string,
  text: string,
  muted: string,
  accent: string,
  accentSoft: string,
  pageTone: SkinTokenPack["pageTone"],
  fontHeading: string,
  fontBody: string,
  extra: Partial<SkinTokenPack> = {}
): SkinTokenPack {
  const dark = pageTone === "dark";
  return {
    mood: extra.mood ?? "skin-authored",
    fontHeading,
    fontBody,
    pageTone,
    navTreatment: extra.navTreatment ?? (dark ? "solid" : "minimal"),
    gradientMood: extra.gradientMood ?? (dark ? "vivid" : "subtle"),
    accentRole: extra.accentRole ?? "sparing",
    sectionGapMode: extra.sectionGapMode ?? "normal",
    layout: extra.layout ?? {
      maxWidth: dark ? "1180px" : "1120px",
      gridColumns: 3,
      sectionGap: extra.sectionGapMode === "airy" ? "7rem" : extra.sectionGapMode === "tight" ? "3.5rem" : "5rem",
      cardMinHeight: "200px",
    },
    colors: {
      bg,
      surface,
      text,
      muted,
      accent,
      accentSoft,
      gradientFrom: accent,
      gradientTo: accent,
      navBg: dark ? bg : surface,
      navText: text,
      navMuted: muted,
      navActiveBg: accent,
      navActiveText: dark ? bg : "#ffffff",
    },
  };
}

export function tokensForSkin(skin: Pick<SiteSkin, "id" | "visualFamily">): SkinTokenPack {
  return SKIN_TOKEN_PACKS[skin.id] ?? FAMILY_FALLBACK[skin.visualFamily];
}
