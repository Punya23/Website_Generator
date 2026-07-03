import type { ExpandedBrief, PageBlueprint, PagePlan, SiteContext } from "../types.js";
import { PageBlueprintSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { briefToContext } from "./expand-brief-agent.js";
import { allowMocks, requireLlm, strictLlmRequired, handleLlmFailure } from "../util/llm-required.js";
import { getTemplate } from "../section-templates/registry.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { enforceBlueprintWithPool } from "../design/enforce-blueprint.js";
import { trimBlueprints } from "../design/blueprint-trim.js";
import { isQualityPipeline } from "../llm/pipeline-speed.js";
import { architectSiteBlueprints, type SiteArchitectOptions } from "./site-architect-agent.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { recordFallback } from "../util/fallback-tracker.js";

const CREATIVE_DIRECTOR_PROMPT = `You are the creative director for a premium marketing website (Framer/editorial quality).

You advise section INTENT copy per page — the pipeline assigns templateId sequence from the vertical profile pool.
Write compelling intent strings (1 short sentence each) for every section slot listed under each page.

Rules:
- Match vertical profile tone (luxury-dark = intimate; clinical-light = trustworthy; corporate = assured)
- Intents must be visitor-facing goals, not template names
- Do not invent templateIds or reorder sections

Output JSON:
{
  "pages": [
    {
      "slug": "home",
      "sections": [
        { "intent": "Immersive opening that signals premium craft" }
      ]
    }
  ]
}`;

export interface CreativeDirectorOptions {
  /** Skip LLM — pool + seed only (retry path). */
  poolOnly?: boolean;
  /** Prior blueprint QA issues for architect retry */
  qaIssues?: string[];
}

function poolBlueprint(page: PagePlan, ctx: SiteContext): PageBlueprint {
  return enforceBlueprintWithPool(page, ctx);
}

function parseLlmIntents(
  raw: unknown,
  page: PagePlan
): PageBlueprint | undefined {
  const parsed = raw as { pages?: Array<{ slug?: string; sections?: Array<{ intent?: string }> }> };
  const pageRaw = parsed.pages?.find((p) => p.slug === page.slug);
  if (!pageRaw?.sections?.length) return undefined;

  const sections = pageRaw.sections.map((s, i) => ({
    id: `${page.slug}_llm_${i}`,
    templateId: "intro_statement",
    intent: String(s.intent ?? page.goal),
  }));

  return PageBlueprintSchema.parse({
    slug: page.slug,
    rhythm: "mixed",
    sections,
  });
}

export async function directPageBlueprints(
  ctx: SiteContext,
  pages: PagePlan[],
  options: CreativeDirectorOptions = {}
): Promise<PageBlueprint[]> {
  requireLlm("creative direction");

  if (isQualityPipeline() && !options.poolOnly) {
    const architectOpts: SiteArchitectOptions = {};
    if (options.qaIssues?.length) architectOpts.qaIssues = options.qaIssues;
    return architectSiteBlueprints(ctx, pages, architectOpts);
  }

  const profileLine = ctx.verticalProfile
    ? `verticalProfile: ${ctx.verticalProfile.profileId}
heroBias: ${ctx.verticalProfile.heroBias}
blueprintFamily: ${ctx.verticalProfile.blueprintFamily}`
    : "verticalProfile: corporate-light";

  if (!options.poolOnly && llm.isAvailable) {
    const poolOutline = pages
      .map((page) => {
        const bp = poolBlueprint(page, ctx);
        return `Page ${page.slug}:\n${bp.sections.map((s, i) => `  ${i + 1}. ${s.templateId}`).join("\n")}`;
      })
      .join("\n\n");

    try {
      const raw = await llm.chat(
        CREATIVE_DIRECTOR_PROMPT,
        `${briefToContext(ctx.expandedBrief)}

${profileLine}
variationSeed: ${ctx.variationSeed ?? "none"}

SITE PLAN:
compositionStrategy: ${ctx.sitePlan.compositionStrategy}
visualArchetype: ${ctx.sitePlan.visualArchetype ?? "editorial"}
industryFamily: ${ctx.sitePlan.industryFamily ?? ctx.verticalProfile?.industryFamily ?? ctx.designSystem.vertical}
avoidPatterns: ${ctx.sitePlan.avoidPatterns.join("; ")}

SECTION SLOTS (fixed order — write one intent per line):
${poolOutline}

PAGES:
${pages.map((p) => `- ${p.slug}: ${p.title} | goal: ${p.goal} | contentFocus: ${p.contentFocus?.join(", ") ?? "—"}`).join("\n")}

Return intents for ALL section slots on ALL pages.`,
        {
          jsonMode: true,
          temperature: ctx.variationSeed ? 0.72 : 0.55,
          tokenRole: "composition",
          model: llm.getCompositionModel(),
        }
      );

      const parsed = parseLlmJson(raw);
      const blueprints = trimBlueprints(
        pages.map((page) => {
          const llmBp = parseLlmIntents(parsed, page);
          return enforceBlueprintWithPool(page, ctx, llmBp);
        }),
        ctx
      );

      pipelineLog(`[pipeline] Creative director: ${blueprints.length} pool-enforced blueprints`);
      return blueprints;
    } catch (err) {
      recordFallback("creative_director");
      pipelineLog(
        `[pipeline] Creative director LLM failed: ${err instanceof Error ? err.message : String(err)} — using pool blueprints`
      );
      if (strictLlmRequired()) {
        handleLlmFailure("creative director", err);
      }
      if (!allowMocks()) {
        return trimBlueprints(pages.map((p) => poolBlueprint(p, ctx)), ctx);
      }
    }
  } else if (!options.poolOnly) {
    if (!allowMocks()) requireLlm("creative director");
  }

  const blueprints = trimBlueprints(
    pages.map((p) => poolBlueprint(p, ctx)),
    ctx
  );
  pipelineLog(`[pipeline] Creative director: ${blueprints.length} pool blueprints`);
  return blueprints;
}

export function blueprintSectionMode(templateId: string): boolean {
  const t = getTemplate(templateId);
  return t?.sectionMode === "bleed" || t?.sectionMode === "band";
}
