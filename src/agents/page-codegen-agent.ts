/** Page Codegen Agent — one LLM call composes an entire page from named React components. */
import type { PageBlueprint, PagePlan, SectionInstance, SiteContext } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm, strictLlmRequired, handleLlmFailure } from "../util/llm-required.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { componentManifestForPrompt } from "./component-manifest.js";
import {
  parsePageCodegenPlan,
  validatePageCodegenPlan,
  type PageCodegenPlan,
} from "./page-codegen-validate.js";
import { getTemplateByComponentName } from "../section-templates/registry.js";
import { enrichPropsImages } from "./media-curator-agent.js";
import type { MediaRegistry } from "../media/media-registry.js";

const PAGE_CODEGEN_PROMPT = `You are a senior web designer composing ONE marketing page for a premium React site.

You choose React section components by their exact export name and write visitor-facing props for each.

RULES:
- Use ONLY component names from the manifest below — exact PascalCase (e.g. FeatureBento, HeroSpotlight)
- Home: 4–7 sections, must START with a hero component
- Inner pages: 3–5 sections
- At most ONE conversion closer per page: CtaBand OR FooterCta OR NewsletterBand (not multiple)
- Do NOT add newsletter, announcement, or generic "Ready to get started?" filler — write specific copy for THIS business
- Vary section types — avoid repeating the same component twice
- Props must include real copy (headlines, body, items) specific to the business — not placeholders
- For images use { "alt": "descriptive alt" } only — never src URLs
- intent: max 12 words describing the section's job on this page

Output valid JSON only:
{
  "sections": [
    {
      "component": "HeroSpotlight",
      "intent": "Bold opening for the brand",
      "props": { "headline": "...", "subcopy": "...", "cta": { "label": "...", "href": "/contact" } }
    }
  ]
}`;

export function minimalBriefContext(ctx: SiteContext): string {
  const b = ctx.expandedBrief;
  const essence =
    b.elevatorPitch.length > 40
      ? b.elevatorPitch
      : b.expandedBrief.slice(0, 320).replace(/\s+/g, " ").trim();
  return `Business: ${ctx.businessName}
Essence: ${essence}
Tone: ${b.tone}
Primary CTA: ${b.primaryCta}`;
}

function buildUserPrompt(
  ctx: SiteContext,
  page: PagePlan,
  validationError?: string
): string {
  const retry = validationError
    ? `\n\nPRIOR ATTEMPT FAILED: ${validationError}\nFix and return valid JSON only.`
    : "";
  return `${minimalBriefContext(ctx)}

Design mood: ${ctx.designSystem.mood}
Page: ${page.slug} — ${page.title}
Goal: ${page.goal}

COMPONENT MANIFEST:
${componentManifestForPrompt()}
${retry}

Compose this page now.`;
}

export function pageCodegenPlanToBlueprint(slug: string, plan: PageCodegenPlan): PageBlueprint {
  return {
    slug,
    rhythm: "mixed",
    sections: plan.sections.map((s, i) => {
      const template = getTemplateByComponentName(s.component)!;
      return {
        id: `${slug}_s${i}_${template.id.replace(/_/g, "")}`,
        templateId: template.id,
        intent: s.intent,
      };
    }),
  };
}

export function instancesToBlueprint(slug: string, instances: SectionInstance[]): PageBlueprint {
  return {
    slug,
    rhythm: "mixed",
    sections: instances.map((s) => ({
      id: s.id,
      templateId: s.templateId,
      intent: s.intent,
    })),
  };
}

export async function generatePageSections(
  ctx: SiteContext,
  page: PagePlan,
  registry: MediaRegistry
): Promise<SectionInstance[]> {
  requireLlm("page codegen");

  if (!llm.isAvailable) {
    if (!allowMocks()) throw new Error("Page codegen requires LLM");
    recordFallback("page_codegen");
    return [];
  }

  try {
    let lastValidationError: string | undefined;
    let plan: PageCodegenPlan | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const parsed = await chatJsonWithRetry(
        "page codegen",
        PAGE_CODEGEN_PROMPT,
        (parseError) =>
          buildUserPrompt(ctx, page, parseError ?? lastValidationError),
        {
          tokenRole: "page",
          model: llm.getPageCodegenModel(),
          initialTemperature: 0.65,
          maxAttempts: 2,
        },
        (raw) => parseLlmJson(raw)
      );

      const candidate = parsePageCodegenPlan(parsed);
      const validationError = validatePageCodegenPlan(candidate, page.slug);
      if (validationError) {
        lastValidationError = validationError;
        pipelineLog(
          `[pipeline] Page codegen validation failed (${page.slug}, attempt ${attempt + 1}/3): ${validationError}`
        );
        continue;
      }
      plan = candidate;
      break;
    }

    if (!plan) {
      throw new Error(lastValidationError ?? "Page codegen validation failed");
    }

    const instances: SectionInstance[] = [];
    for (let i = 0; i < plan.sections.length; i++) {
      const section = plan.sections[i]!;
      const template = getTemplateByComponentName(section.component)!;
      const sectionId = `${page.slug}_s${i}_${template.id.replace(/_/g, "")}`;

      let props = { ...section.props };
      props = await enrichPropsImages(
        template.id,
        props,
        ctx,
        sectionId,
        page.slug,
        registry
      );

      instances.push({
        id: sectionId,
        templateId: template.id,
        intent: section.intent,
        props,
        fullBleed: template.sectionMode === "bleed",
        motion: template.defaultMotion,
      });
    }

    pipelineLog(
      `[pipeline] Page codegen (${page.slug}): ${instances.map((s) => s.templateId).join("→")}`
    );
    return instances;
  } catch (err) {
    recordFallback("page_codegen");
    if (strictLlmRequired()) handleLlmFailure("page codegen", err);
    pipelineLog(
      `[pipeline] Page codegen failed for ${page.slug}: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }
}
