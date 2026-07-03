import type { PageBlueprint, PagePlan, SiteContext } from "../types.js";
import { llm } from "../llm/client.js";
import { briefToContext } from "./expand-brief-agent.js";
import { allowMocks, requireLlm, strictLlmRequired, handleLlmFailure } from "../util/llm-required.js";
import { templateCatalogForPrompt } from "../section-templates/registry.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { trimBlueprints } from "../design/blueprint-trim.js";
import { pickBlueprintFromPool } from "../design/blueprint-pools.js";
import { resolvePoolProfileId, validateAndMergeBlueprint } from "../design/enforce-blueprint.js";
import { isQualityPipeline } from "../llm/pipeline-speed.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { hashString } from "../design/variation.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";

const SITE_ARCHITECT_PROMPT = `You are the site architect for a premium marketing website (Framer/editorial quality).

Choose which React section components to use for EACH page. You control templateId and visitor-facing intent per section.

RULES:
- Use ONLY templateIds from the catalog below
- Home MUST start with a hero_* template (prefer hero_spotlight, hero_editorial, or hero_split_cinematic)
- Home: 5–7 sections; inner pages: 3–5 sections
- Include at least 3 PREMIUM templates on home (marked [premium] in catalog)
- Mix section modes: bleed + editorial + band — avoid all-contained pages
- No 3+ identical templateIds in a row on any page
- Limit intro_statement to at most once per page
- Match the business — gym ≠ salon ≠ fintech; vary structure by industry
- End each page with cta_band OR footer_cta (one conversion closer)
- Do NOT copy example sequences verbatim — invent a fresh flow for THIS brand
- rhythm: exactly ONE of bleed-editorial-band | editorial-contained-band | mixed
- intent: max 12 words, plain text, no double quotes inside strings

Output valid JSON only (no markdown, no comments):
{
  "pages": [
    {
      "slug": "home",
      "rhythm": "mixed",
      "sections": [
        { "templateId": "hero_spotlight", "intent": "Bold opening that signals premium craft" }
      ]
    }
  ]
}`;

function poolBlueprint(page: PagePlan, ctx: SiteContext): PageBlueprint {
  const profileId = resolvePoolProfileId(ctx);
  const seed = ctx.variationSeed ?? Date.now();
  return pickBlueprintFromPool(page, ctx.expandedBrief, profileId, seed);
}

function poolExamplesForPrompt(pages: PagePlan[], ctx: SiteContext): string {
  const profileId = resolvePoolProfileId(ctx);
  const seed = ctx.variationSeed ?? Date.now();
  return pages
    .map((page) => {
      const bp = pickBlueprintFromPool(page, ctx.expandedBrief, profileId, seed);
      return `Example ${page.slug} (DO NOT COPY — inspiration only):\n${bp.sections.map((s) => `  - ${s.templateId}`).join("\n")}`;
    })
    .join("\n\n");
}

function parseArchitectBlueprints(
  raw: unknown,
  pages: PagePlan[],
  ctx: SiteContext
): PageBlueprint[] {
  const parsed = raw as {
    pages?: Array<{
      slug?: string;
      rhythm?: string;
      sections?: Array<{ templateId?: string; intent?: string }>;
    }>;
  };

  return pages.map((page) => {
    const pageRaw = parsed.pages?.find((p) => p.slug === page.slug);
    const poolBp = poolBlueprint(page, ctx);

    if (!pageRaw?.sections?.length) {
      return poolBp;
    }

    const llmBp: PageBlueprint = {
      slug: page.slug,
      rhythm: pageRaw.rhythm?.trim() || poolBp.rhythm,
      sections: pageRaw.sections.map((s, i) => ({
        id: `${page.slug}_s${i}_${String(s.templateId ?? "intro_statement").replace(/_/g, "")}`,
        templateId: String(s.templateId ?? "intro_statement"),
        intent: String(s.intent ?? page.goal),
      })),
    };

    return validateAndMergeBlueprint(page, ctx, llmBp, poolBp);
  });
}

function architectUserPrompt(
  ctx: SiteContext,
  pages: PagePlan[],
  options: SiteArchitectOptions,
  parseError?: string
): string {
  const profileLine = ctx.verticalProfile
    ? `verticalProfile: ${ctx.verticalProfile.profileId}
heroBias: ${ctx.verticalProfile.heroBias}
blueprintFamily: ${ctx.verticalProfile.blueprintFamily}`
    : "verticalProfile: corporate-light";

  const distinctHint = ctx.variationSeed
    ? `variationSeed: ${ctx.variationSeed} (briefHash: ${hashString(ctx.expandedBrief.expandedBrief.slice(0, 200))})`
    : "";

  const qaBlock = options.qaIssues?.length
    ? `\nFIX THESE QA ISSUES FROM PRIOR ATTEMPT:\n${options.qaIssues.map((m) => `- ${m}`).join("\n")}`
    : "";

  const retryBlock = parseError
    ? `\nPRIOR RESPONSE WAS INVALID JSON (${parseError}). Return ONLY strict JSON matching the schema — no prose, no markdown.`
    : "";

  return `${briefToContext(ctx.expandedBrief)}

${profileLine}
${distinctHint}

SITE PLAN:
compositionStrategy: ${ctx.sitePlan.compositionStrategy}
visualArchetype: ${ctx.sitePlan.visualArchetype ?? "editorial"}
industryFamily: ${ctx.sitePlan.industryFamily ?? ctx.verticalProfile?.industryFamily ?? ctx.designSystem.vertical}
avoidPatterns: ${ctx.sitePlan.avoidPatterns.join("; ")}

TEMPLATE CATALOG:
${templateCatalogForPrompt()}

EXAMPLE SEQUENCES (inspiration only — create a unique layout):
${poolExamplesForPrompt(pages, ctx)}

PAGES TO DESIGN:
${pages.map((p) => `- ${p.slug}: ${p.title} | goal: ${p.goal} | contentFocus: ${p.contentFocus?.join(", ") ?? "—"}`).join("\n")}
${qaBlock}${retryBlock}

Return blueprints for ALL pages with valid templateIds only.`;
}

export interface SiteArchitectOptions {
  /** Prior QA issues to fix on retry */
  qaIssues?: string[];
}

export async function architectSiteBlueprints(
  ctx: SiteContext,
  pages: PagePlan[],
  options: SiteArchitectOptions = {}
): Promise<PageBlueprint[]> {
  requireLlm("site architect");

  if (!isQualityPipeline()) {
    return trimBlueprints(
      pages.map((p) => poolBlueprint(p, ctx)),
      ctx
    );
  }

  if (!llm.isAvailable) {
    if (!allowMocks()) throw new Error("Site architect requires LLM");
    return trimBlueprints(pages.map((p) => poolBlueprint(p, ctx)), ctx);
  }

  let lastErr: unknown;

  try {
    const initialTemperature = ctx.variationSeed ? 0.72 : 0.55;
    const parsed = await chatJsonWithRetry(
      "site architect",
      SITE_ARCHITECT_PROMPT,
      (parseError) => architectUserPrompt(ctx, pages, options, parseError),
      {
        tokenRole: "architect",
        model: llm.getArchitectModel(),
        initialTemperature,
        maxAttempts: 2,
      },
      (raw) => parseLlmJson(raw)
    );

    const blueprints = trimBlueprints(parseArchitectBlueprints(parsed, pages, ctx), ctx);
    pipelineLog(
      `[pipeline] Site architect (GLM): ${blueprints.map((b) => `${b.slug}=${b.sections.map((s) => s.templateId).join("→")}`).join("; ")}`
    );
    return blueprints;
  } catch (err) {
    lastErr = err;
  }

  recordFallback("site_architect");
  if (strictLlmRequired()) {
    handleLlmFailure("site architect", lastErr);
  }
  pipelineLog(
    `[pipeline] Site architect failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)} — using pool blueprints`
  );
  return trimBlueprints(pages.map((p) => poolBlueprint(p, ctx)), ctx);
}
