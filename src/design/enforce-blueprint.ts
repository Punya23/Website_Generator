import type { PageBlueprint, PagePlan, SiteContext } from "../types.js";
import { PageBlueprintSchema } from "../types.js";
import { pickBlueprintFromPool } from "./blueprint-pools.js";
import type { VerticalProfileId } from "./vertical-profiles.js";
import { pickHomeHeroTemplate } from "../section-templates/hero-variants.js";
import { filterPoolSequence } from "./brief-intent.js";
import { getTemplate } from "../section-templates/registry.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { isQualityPipeline } from "../llm/pipeline-speed.js";

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

const HERO_PREFIX = "hero_";

function reindexSections(
  slug: string,
  sections: PageBlueprint["sections"]
): PageBlueprint["sections"] {
  return sections.map((s, i) => ({
    ...s,
    id: `${slug}_s${i}_${s.templateId.replace(/_/g, "")}`,
  }));
}

function nearestPoolTemplate(
  poolSections: PageBlueprint["sections"],
  index: number
): string {
  return poolSections[index]?.templateId ?? poolSections[0]?.templateId ?? "intro_statement";
}

/**
 * LLM blueprint wins when valid; pool repairs unknown IDs, missing hero, or short pages.
 */
export function validateAndMergeBlueprint(
  page: PagePlan,
  ctx: SiteContext,
  llmBp: PageBlueprint,
  poolBp?: PageBlueprint
): PageBlueprint {
  const profileId = resolvePoolProfileId(ctx);
  const seed = ctx.variationSeed ?? Date.now();
  const pool =
    poolBp ?? pickBlueprintFromPool(page, ctx.expandedBrief, profileId, seed);

  let sections = llmBp.sections.map((s, i) => {
    let templateId = s.templateId;
    if (!getTemplate(templateId)) {
      templateId = nearestPoolTemplate(pool.sections, i);
      pipelineLog(
        `[pipeline] Blueprint repair: unknown template "${s.templateId}" → ${templateId} on ${page.slug}`
      );
    }
    return {
      id: s.id,
      templateId,
      intent: s.intent?.trim() || pool.sections[i]?.intent || page.goal,
    };
  });

  if (page.slug === "home" && sections.length > 0 && !sections[0]!.templateId.startsWith(HERO_PREFIX)) {
    sections[0] = {
      ...sections[0]!,
      templateId: pickHomeHeroTemplate(ctx),
      intent: sections[0]!.intent || page.goal,
    };
    pipelineLog(`[pipeline] Blueprint repair: home hero injected on ${page.slug}`);
  }

  const filtered = filterPoolSequence(
    sections.map((s) => ({ templateId: s.templateId, intent: s.intent })),
    ctx
  );
  if (filtered.length >= 2) {
    sections = filtered.map((s, i) => ({
      id: sections[i]?.id ?? `${page.slug}_s${i}_${s.templateId.replace(/_/g, "")}`,
      templateId: s.templateId,
      intent: s.intent,
    }));
  }

  if (sections.length < 2) {
    sections = pool.sections.slice(0, Math.max(2, pool.sections.length));
    pipelineLog(`[pipeline] Blueprint repair: padded ${page.slug} from pool (${sections.length} sections)`);
  }

  return PageBlueprintSchema.parse({
    slug: page.slug,
    rhythm: llmBp.rhythm?.trim() || pool.rhythm,
    sections: reindexSections(page.slug, sections),
  });
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

  if (llmBlueprint?.sections?.length && isQualityPipeline()) {
    return validateAndMergeBlueprint(page, ctx, llmBlueprint, poolBp);
  }

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
