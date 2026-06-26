import type { PageBlueprint, PagePlan, SiteContext } from "../types.js";
import { PageBlueprintSchema } from "../types.js";
import { pickBlueprintFromPool } from "./blueprint-pools.js";
import type { VerticalProfileId } from "./vertical-profiles.js";
import { pickHomeHeroTemplate } from "../section-templates/hero-variants.js";
import { filterPoolSequence } from "./brief-intent.js";

/** Map site plan archetype/strategy to blueprint pool family. */
export function resolvePoolProfileId(ctx: SiteContext): VerticalProfileId {
  const base = (ctx.verticalProfile?.profileId ?? "warm-consumer") as VerticalProfileId;
  const strategy = ctx.sitePlan.compositionStrategy?.toLowerCase() ?? "";
  const archetype = ctx.sitePlan.visualArchetype?.toLowerCase() ?? "";

  if (strategy.includes("immersive") || archetype.includes("immersive")) {
    if (base === "clinical-light" || base === "corporate-light") return base;
    return base === "warm-consumer" ? "warm-consumer" : "luxury-dark";
  }
  if (strategy.includes("editorial") || archetype.includes("editorial")) {
    if (base === "corporate-light") return "editorial-light";
    if (base === "warm-consumer") return "editorial-light";
    return base;
  }
  if (strategy.includes("proof") || archetype.includes("proof")) {
    if (base === "editorial-light") return "clinical-light";
    return base;
  }
  return base;
}

/** Pool defines template sequence; LLM supplies intents where useful. */
export function enforceBlueprintWithPool(
  page: PagePlan,
  ctx: SiteContext,
  llmBlueprint?: PageBlueprint
): PageBlueprint {
  const profileId = resolvePoolProfileId(ctx);
  const seed = ctx.variationSeed ?? Date.now();
  const poolBp = pickBlueprintFromPool(page, ctx.expandedBrief, profileId, seed);

  const filteredSections = filterPoolSequence(
    poolBp.sections.map((s) => ({ templateId: s.templateId, intent: s.intent })),
    ctx
  );
  if (filteredSections.length >= 2) {
    poolBp.sections = filteredSections.map((s, i) => ({
      ...poolBp.sections.find((ps) => ps.templateId === s.templateId) ?? poolBp.sections[i]!,
      templateId: s.templateId,
      intent: s.intent,
      id: `${page.slug}_s${i}_${s.templateId.replace(/_/g, "")}`,
    }));
  }

  const llmByIndex = llmBlueprint?.sections ?? [];
  const llmByTemplate = new Map(llmByIndex.map((s) => [s.templateId, s]));

  const sections = poolBp.sections.map((poolSec, i) => {
    const fromLlm = llmByIndex[i] ?? llmByTemplate.get(poolSec.templateId);
    const intent = fromLlm?.intent?.trim() || poolSec.intent || page.goal;
    return {
      id: poolSec.id,
      templateId: poolSec.templateId,
      intent,
    };
  });

  if (page.slug === "home" && sections.length > 0) {
    sections[0] = {
      ...sections[0]!,
      templateId: pickHomeHeroTemplate(ctx),
      intent: llmByIndex[0]?.intent?.trim() || page.goal,
    };
  }

  return PageBlueprintSchema.parse({
    slug: page.slug,
    rhythm: llmBlueprint?.rhythm?.trim() || poolBp.rhythm,
    sections,
  });
}
