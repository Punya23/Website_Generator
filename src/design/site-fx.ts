/** Site-wide visual FX treatments — stops every site inheriting the same cursor blur / mesh / glass. */
import { pickFrom } from "../design/variation.js";
import type { SiteContext } from "../types.js";
import type { SiteLookProfile } from "../agents/site-look-agent.js";

export type SiteFxTreatment = "clean" | "editorial" | "spotlight" | "glass";

const FX_POOL: SiteFxTreatment[] = [
  "clean",
  "clean",
  "editorial",
  "editorial",
  "spotlight",
  "glass",
];

/** Infer FX from look archetype words; otherwise seed-pick with a clean/editorial bias. */
export function resolveSiteFxTreatment(
  ctx: SiteContext,
  lookProfile?: SiteLookProfile
): SiteFxTreatment {
  const look = [
    lookProfile?.layoutArchetype ?? "",
    ...(lookProfile?.toneKeywords ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (
    /\b(glass|frosted|blur|translucent)\b/.test(look) ||
    /\bcursor|spotlight|mesh\b/.test(look)
  ) {
    return /\bglass|frosted|blur\b/.test(look) ? "glass" : "spotlight";
  }
  if (/\b(editorial|print|typograph|magazine|broadsheet)\b/.test(look)) {
    return "editorial";
  }
  if (/\b(clean|minimal|flat|crisp|solid|product)\b/.test(look)) {
    return "clean";
  }

  const seed = ctx.variationSeed ?? ctx.businessName;
  return pickFrom(seed, "site-fx-treatment", FX_POOL);
}

export function fxUsesCursorSpotlight(fx: SiteFxTreatment): boolean {
  return fx === "spotlight";
}

export function fxUsesMeshGrain(fx: SiteFxTreatment): boolean {
  return fx === "spotlight" || fx === "glass";
}

export function fxUsesGlassPanels(fx: SiteFxTreatment): boolean {
  return fx === "glass" || fx === "spotlight";
}
