import type { ExpandedBrief, PageBlueprint, PagePlan, SiteContext, SitePlan } from "../types.js";
import { PageBlueprintSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { briefToContext } from "./expand-brief-agent.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { TEMPLATE_IDS, templateCatalogForPrompt, getTemplate } from "../section-templates/registry.js";
import { pipelineLog } from "../util/pipeline-log.js";

const CREATIVE_DIRECTOR_PROMPT = `You are the creative director for a premium marketing website (Framer/editorial quality).

Design each PAGE as a sequence of section TEMPLATES — never invent layout primitives or block types.

Available templates:
${templateCatalogForPrompt()}

Rules:
- Alternate visual rhythm: bleed → editorial → contained → band. Never stack 3+ identical template types.
- Use templateId ONLY from the list above.
- Each section needs unique id (prefix with page slug), templateId, and intent.
- Wire page layoutHint and site compositionStrategy into your choices.
- Home: start with hero_editorial or hero_split_cinematic.
- Services: services_showcase (can repeat max 2x with different intents).
- About: intro_statement + team_grid or testimonial_featured.
- Contact: contact_split + optional faq_accordion, close with cta_band.
- End most pages with cta_band unless contact page.

Output JSON:
{
  "pages": [
    {
      "slug": "home",
      "rhythm": "bleed-editorial-contained-band",
      "sections": [
        { "id": "home_hero", "templateId": "hero_editorial", "intent": "..." }
      ]
    }
  ]
}`;

function mockBlueprint(page: PagePlan, brief: ExpandedBrief): PageBlueprint {
  const slug = page.slug;
  const pick = (id: string, templateId: string, intent: string) => ({ id, templateId, intent });

  const bySlug: Record<string, PageBlueprint["sections"]> = {
    home: [
      pick(`${slug}_hero`, "hero_editorial", page.goal),
      pick(`${slug}_intro`, "intro_statement", brief.elevatorPitch.slice(0, 120)),
      pick(`${slug}_stats`, "stats_marquee", "Social proof"),
      pick(`${slug}_features`, "feature_bento", "Core offerings"),
      pick(`${slug}_cta`, "cta_band", brief.primaryCta),
    ],
    about: [
      pick(`${slug}_hero`, "hero_split_cinematic", page.goal),
      pick(`${slug}_story`, "intro_statement", "Origin story"),
      pick(`${slug}_team`, "team_grid", "Meet the team"),
      pick(`${slug}_quote`, "testimonial_featured", "Client voice"),
      pick(`${slug}_cta`, "cta_band", brief.primaryCta),
    ],
    services: [
      pick(`${slug}_hero`, "intro_statement", page.title),
      pick(`${slug}_svc1`, "services_showcase", brief.services[0] ?? "Service one"),
      pick(`${slug}_svc2`, "services_showcase", brief.services[1] ?? "Service two"),
      pick(`${slug}_gallery`, "gallery_masonry", "Work gallery"),
      pick(`${slug}_cta`, "cta_band", brief.primaryCta),
    ],
    contact: [
      pick(`${slug}_hero`, "intro_statement", page.goal),
      pick(`${slug}_contact`, "contact_split", "Get in touch"),
      pick(`${slug}_faq`, "faq_accordion", "Common questions"),
      pick(`${slug}_cta`, "cta_band", brief.primaryCta),
    ],
  };

  return {
    slug,
    rhythm: "editorial-contained-band",
    sections: bySlug[slug] ?? [
      pick(`${slug}_hero`, "hero_editorial", page.goal),
      pick(`${slug}_body`, "intro_statement", page.layoutHint),
      pick(`${slug}_cta`, "cta_band", brief.primaryCta),
    ],
  };
}

function normalizeBlueprint(raw: unknown, page: PagePlan, brief: ExpandedBrief): PageBlueprint {
  const obj = raw as Record<string, unknown>;
  const sections = Array.isArray(obj.sections) ? obj.sections : [];
  const normalized = sections.map((s, i) => {
    const sec = s as Record<string, unknown>;
    const templateId = String(sec.templateId ?? "intro_statement");
    const validId = TEMPLATE_IDS.includes(templateId as (typeof TEMPLATE_IDS)[number])
      ? templateId
      : "intro_statement";
    return {
      id: String(sec.id ?? `${page.slug}_section_${i}`),
      templateId: validId,
      intent: String(sec.intent ?? page.goal),
    };
  });

  return PageBlueprintSchema.parse({
    slug: page.slug,
    rhythm: String(obj.rhythm ?? "mixed"),
    sections: normalized.length >= 2 ? normalized : mockBlueprint(page, brief).sections,
  });
}

export async function directPageBlueprints(
  ctx: SiteContext,
  pages: PagePlan[]
): Promise<PageBlueprint[]> {
  requireLlm("creative direction");

  if (llm.isAvailable) {
    const raw = await llm.chat(
      CREATIVE_DIRECTOR_PROMPT,
      `${briefToContext(ctx.expandedBrief)}

SITE PLAN:
compositionStrategy: ${ctx.sitePlan.compositionStrategy}
visualArchetype: ${ctx.sitePlan.visualArchetype ?? "editorial"}
avoidPatterns: ${ctx.sitePlan.avoidPatterns.join("; ")}
motionStyle: ${ctx.sitePlan.motionStyle ?? ctx.designSystem.motionStyle ?? "stagger"}

PAGES:
${pages.map((p) => `- ${p.slug}: ${p.title} | goal: ${p.goal} | layoutHint: ${p.layoutHint}`).join("\n")}

Return blueprints for ALL pages listed.`,
      { jsonMode: true, temperature: 0.55, maxTokens: 4096, model: llm.getCompositionModel() }
    );

    const parsed = JSON.parse(raw) as { pages?: unknown[] };
    const blueprints: PageBlueprint[] = [];

    for (const page of pages) {
      const pageRaw = parsed.pages?.find(
        (p) => (p as Record<string, unknown>).slug === page.slug
      );
      if (pageRaw) {
        blueprints.push(normalizeBlueprint(pageRaw, page, ctx.expandedBrief));
      } else if (allowMocks()) {
        blueprints.push(mockBlueprint(page, ctx.expandedBrief));
      } else {
        blueprints.push(mockBlueprint(page, ctx.expandedBrief));
      }
    }

    pipelineLog(`[pipeline] Creative director: ${blueprints.length} page blueprints`);
    return blueprints;
  }

  if (!allowMocks()) throw new Error("Creative director requires LLM");
  return pages.map((p) => mockBlueprint(p, ctx.expandedBrief));
}

export function blueprintSectionMode(templateId: string): boolean {
  const t = getTemplate(templateId);
  return t?.sectionMode === "bleed" || t?.sectionMode === "band";
}
