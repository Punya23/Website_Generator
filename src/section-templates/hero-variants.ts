import type { SiteContext } from "../types.js";
import { pickFrom } from "../design/variation.js";

const HERO_TEMPLATES = [
  "hero_spotlight",
  "hero_editorial",
  "hero_split_cinematic",
  "hero_video",
] as const;

const HERO_LAYOUT_BY_TEMPLATE: Record<string, string[]> = {
  hero_spotlight: ["split-offset", "centered-stack", "full-bleed-left"],
  hero_editorial: ["full-bleed-left", "split-offset", "centered-stack"],
  hero_split_cinematic: ["default", "split-offset"],
  hero_video: ["default", "full-bleed-left"],
};

export function pickHomeHeroTemplate(ctx: SiteContext): string {
  const profile = ctx.verticalProfile;
  const seed = ctx.variationSeed ?? 0;
  const bias = profile?.heroBias;

  if (bias && HERO_TEMPLATES.includes(bias as (typeof HERO_TEMPLATES)[number])) {
    const alternates = HERO_TEMPLATES.filter((t) => t !== bias);
    const pool = [bias, ...alternates.slice(0, 2)];
    return pickFrom(seed, "home-hero", pool);
  }

  const dark = profile?.profileId === "luxury-dark" || profile?.profileId === "editorial-light";
  const pool = dark
    ? ["hero_spotlight", "hero_video", "hero_editorial"]
    : ["hero_split_cinematic", "hero_editorial", "hero_spotlight"];
  return pickFrom(seed, "home-hero", pool);
}

export function pickHeroLayoutVariant(templateId: string, seed: number | string): string {
  const variants = HERO_LAYOUT_BY_TEMPLATE[templateId] ?? ["default"];
  return pickFrom(seed, `hero-layout:${templateId}`, variants);
}
