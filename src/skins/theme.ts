/**
 * Theme + context from an authored skin only.
 * Look tokens come from the skin token pack, not a brief regex or design-council overlay.
 */
import type { ExpandedBrief, SiteContext, SitePlan, SiteTheme } from "../types.js";
import type { SiteSkin } from "./schema.js";
import { SKIN_PAGE_TITLES } from "./schema.js";
import { ensureReadableTheme } from "../theme/contrast.js";
import { alignSitePlanToSkin } from "./picker.js";
import { tokensForSkin } from "./tokens.js";

export function emptySitePlan(): SitePlan {
  return {
    pages: Object.keys(SKIN_PAGE_TITLES).map((slug) => {
      const titles = SKIN_PAGE_TITLES[slug]!;
      return {
        slug,
        title: titles.title,
        navLabel: titles.navLabel,
        goal: titles.goal,
        minBlocks: 4,
        layoutHint: titles.goal,
        contentFocus: [titles.goal],
      };
    }),
    compositionStrategy: "",
    avoidPatterns: [],
  };
}

export function themeFromSkin(skin: SiteSkin, _brief: ExpandedBrief): SiteTheme {
  const pack = tokensForSkin(skin);
  return ensureReadableTheme({
    vertical: skin.id,
    mood: pack.mood,
    gradientMood: pack.gradientMood,
    accentRole: pack.accentRole,
    pageTone: pack.pageTone,
    navTreatment: pack.navTreatment,
    navShape: skin.chrome.navShape,
    motionPreset: skin.motionPreset,
    fontHeading: pack.fontHeading,
    fontBody: pack.fontBody,
    sectionGapMode: pack.sectionGapMode,
    layout: pack.layout,
    colors: pack.colors,
  });
}

export function applySkinToContext(ctx: SiteContext, skin: SiteSkin): void {
  ctx.skinId = skin.id;
  ctx.skinName = skin.name;
  ctx.sitePlan = alignSitePlanToSkin(ctx.sitePlan, skin);
  ctx.designSystem = themeFromSkin(skin, ctx.expandedBrief);
  const tone = ctx.designSystem.pageTone ?? "light";
  ctx.verticalProfile = {
    profileId: skin.visualFamily,
    pageTone: tone,
    heroBias: "",
    blueprintFamily: skin.id,
    grainOverlay: skin.chrome.grainOverlay ?? false,
    industryFamily: skin.id,
  };
}
