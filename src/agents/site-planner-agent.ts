import type { ExpandedBrief, SitePlan } from "../types.js";
import { SitePlanSchema } from "../types.js";
import { CORE_PAGE_KINDS } from "../types.js";
import { llm } from "../llm/client.js";
import { briefToContext } from "./expand-brief-agent.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import type { SectionArchetype } from "../components/archetypes.js";
import {
  normalizePlannerBlockTypes,
  PLANNER_BLOCK_TYPES,
} from "./content-normalize.js";
import { extractBriefIntentFromText } from "../design/brief-intent.js";
import { isOptionalPageRelevant } from "../design/template-relevance.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { isQualityPipeline } from "../llm/pipeline-speed.js";
import { getOutputMode } from "../orchestrator/react-pipeline.js";

const ALLOWED_BLOCK_TYPES = PLANNER_BLOCK_TYPES.join(", ");

const PLANNER_REACT_SYSTEM = `You are a website information architect. Design page structure for a premium React marketing site.

Output valid JSON only (no markdown, no comments). Plain strings — no double quotes inside string values. Max 15 words per string field.

{
  "pages": [
    {
      "slug": "home",
      "title": "Home",
      "navLabel": "Home",
      "goal": "what this page must accomplish",
      "minBlocks": 12,
      "layoutHint": "spatial feel for this page",
      "contentFocus": ["topic one", "topic two"]
    }
  ],
  "compositionStrategy": "how layout rhythm differs from a generic template",
  "avoidPatterns": ["pattern to avoid"],
  "visualArchetype": "e.g. salon-luxury-dark, dental-clinical-light",
  "industryFamily": "short vertical slug",
  "motionStyle": "how scroll motion should feel"
}

Include home, about, services, and contact. Add optional pages only if genuinely needed.
Do NOT include sections or blockTypes — component layout is chosen later.`;

const PLANNER_HTML_SYSTEM = `You are a website information architect. Design a unique site structure for this business.

Output valid JSON only (no markdown, no comments). Plain strings — no double quotes inside string values.

{
  "pages": [
    {
      "slug": "home",
      "title": "Home",
      "navLabel": "Home",
      "goal": "what this page must accomplish",
      "minBlocks": 12,
      "layoutHint": "spatial feel for this page",
      "contentFocus": ["topics to cover"],
      "sections": [
        { "id": "home_hero", "intent": "Opening hero", "blockTypes": ["headline", "text"] },
        { "id": "home_main", "intent": "Main content", "blockTypes": ["feature", "stat"] }
      ]
    }
  ],
  "compositionStrategy": "how layout rhythm differs from a generic template",
  "avoidPatterns": ["pattern to avoid"],
  "visualArchetype": "e.g. salon-luxury-dark, dental-clinical-light",
  "industryFamily": "short vertical slug",
  "motionStyle": "how scroll motion should feel"
}

Allowed blockTypes ONLY: ${ALLOWED_BLOCK_TYPES}
Never use invented types like card, button, accordion, profileCard, backgroundImage.
Include home, about, services, and contact. Derive everything from the business.`;

function plannerSystemPrompt(): string {
  if (isQualityPipeline() || getOutputMode() === "react") {
    return PLANNER_REACT_SYSTEM;
  }
  return PLANNER_HTML_SYSTEM;
}

function defaultSections(
  slug: string,
  layoutHint: string,
  blockTypes: string[],
  archetypes?: SectionArchetype[]
) {
  const archetypeList: SectionArchetype[] = archetypes ?? [
    slug === "home" ? "split_hero" : "stats_row",
    "feature_grid",
    "cta_band",
  ];
  return [
    {
      id: `${slug}_hero`,
      intent: "Opening hero",
      blockTypes: ["headline", "text", "image"],
      archetype: archetypeList[0],
    },
    {
      id: `${slug}_main`,
      intent: layoutHint,
      blockTypes,
      archetype: archetypeList[1] ?? "feature_grid",
    },
    {
      id: `${slug}_close`,
      intent: "Conversion close",
      blockTypes: ["cta", "contact"],
      archetype: archetypeList[2] ?? "cta_band",
    },
  ];
}

function mockPlan(brief: ExpandedBrief): SitePlan {
  const services = brief.services.slice(0, 6);

  return SitePlanSchema.parse({
    pages: [
      {
        slug: "home",
        title: "Home",
        navLabel: "Home",
        goal: "Hook visitors and drive primary conversion",
        minBlocks: 22,
        layoutHint:
          "Full-bleed hero alone. Stats or proof band. Mixed grid sizes for features/gallery. Testimonials with breathing room. Full-bleed CTA.",
        contentFocus: ["value proposition", "proof", "services overview", "testimonials", "cta"],
        sections: defaultSections(
          "home",
          "Proof and services overview",
          ["headline", "stat", "feature", "testimonial", "gallery", "cta", "pricing", "bento"],
          ["split_hero", "bento_grid", "pricing_table", "cta_band"]
        ),
      },
      {
        slug: "about",
        title: "About",
        navLabel: "About",
        goal: "Build trust with story and credentials",
        minBlocks: 16,
        layoutHint: "Section headline (no card). Story text wide. Optional image row. Values/features grid.",
        contentFocus: ["origin story", "mission", "team", "values"],
        sections: defaultSections("about", "Story and values", ["headline", "text", "feature", "image"]),
      },
      {
        slug: "services",
        title: "Services",
        navLabel: "Services",
        goal: "Detail every offering with depth",
        minBlocks: 20,
        layoutHint: "Service features in varied grid. Gallery or image mosaic. Detail text blocks between grids.",
        contentFocus: services.length ? services : ["core services", "process", "pricing hints"],
        sections: defaultSections("services", "Service detail grid", ["headline", "feature", "gallery", "text"]),
      },
      {
        slug: "contact",
        title: "Contact",
        navLabel: "Contact",
        goal: "Remove friction to reach out",
        minBlocks: 14,
        layoutHint: "Headline. Contact + image row. FAQ stack if relevant. Full-bleed CTA.",
        contentFocus: ["contact info", "hours", "location", "booking"],
        sections: defaultSections("contact", "Contact and FAQ", ["headline", "contact", "faq", "cta"]),
      },
    ],
    compositionStrategy: `Dynamic layout tailored to ${brief.businessName} — alternating full-bleed and contained sections, no uniform template rows`,
    visualArchetype: "minimal-luxury",
    motionStyle: "staggered reveals with soft ease",
    avoidPatterns: [
      "hero beside image in same row",
      "card-wrapped page titles",
      "identical 3-column card grid for everything",
    ],
  });
}

function normalizePlannerJson(raw: unknown, brief: ExpandedBrief): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const plan = raw as Record<string, unknown>;
  if (!Array.isArray(plan.pages)) return raw;

  const briefText = [
    brief.businessName,
    brief.expandedBrief,
    brief.tagline,
    ...brief.services,
  ].join(" ");
  const intent = extractBriefIntentFromText(briefText);
  const coreSlugs = new Set<string>(CORE_PAGE_KINDS);

  plan.pages = (plan.pages as unknown[])
    .filter((pageRaw) => {
      if (!pageRaw || typeof pageRaw !== "object") return false;
      const slug = String((pageRaw as Record<string, unknown>).slug ?? "page");
      if (coreSlugs.has(slug)) return true;
      return isOptionalPageRelevant(slug, intent, briefText);
    })
    .map((pageRaw) => {
    if (!pageRaw || typeof pageRaw !== "object") return pageRaw;
    const page = pageRaw as Record<string, unknown>;
    const slug = String(page.slug ?? "page");
    const layoutHint = String(page.layoutHint ?? "Main content");
    const blockTypes = Array.isArray(page.contentFocus)
      ? ["text", "feature", "stat"]
      : ["text", "feature"];

    const minBlocks =
      typeof page.minBlocks === "number" && Number.isFinite(page.minBlocks)
        ? Math.max(1, Math.round(page.minBlocks))
        : 12;

    const sections = (Array.isArray(page.sections) && page.sections.length > 0
      ? page.sections
      : defaultSections(slug, layoutHint, blockTypes)
    ).map((sectionRaw) => {
      if (!sectionRaw || typeof sectionRaw !== "object") return sectionRaw;
      const section = sectionRaw as Record<string, unknown>;
      const blockTypesRaw = Array.isArray(section.blockTypes) ? section.blockTypes : [];
      return {
        ...section,
        blockTypes: normalizePlannerBlockTypes(blockTypesRaw.map(String)),
      };
    });

    return {
      ...page,
      minBlocks,
      sections,
      contentFocus: Array.isArray(page.contentFocus) ? page.contentFocus : [layoutHint],
      layoutHint,
      navLabel: page.navLabel ?? page.title ?? slug,
    };
  });

  return plan;
}

function parseSitePlan(raw: unknown, brief: ExpandedBrief): SitePlan {
  return SitePlanSchema.parse(normalizePlannerJson(raw, brief));
}

function validateCorePages(plan: SitePlan, brief: ExpandedBrief): SitePlan {
  const slugs = new Set(plan.pages.map((p) => p.slug));
  const missing = CORE_PAGE_KINDS.filter((core) => !slugs.has(core));
  if (missing.length === 0) return plan;

  // The LLM sometimes names a page after the business's own vocabulary (a yoga studio's
  // "classes", a restaurant's "menu", a photographer's "portfolio") instead of the canonical
  // "services" slug that downstream code (nav, chrome director, content agent) assumes exists.
  // Backfill the missing canonical page(s) from the deterministic mock plan rather than crashing
  // the whole generation — every page the LLM did produce is preserved. Recorded as a fallback so
  // it surfaces in the "generation degraded" summary.
  const fallback = mockPlan(brief);
  const backfill = fallback.pages.filter((p) => missing.includes(p.slug as (typeof missing)[number]));
  recordFallback("site_planner");
  pipelineLog(
    `[pipeline] Site plan missing canonical page(s): ${missing.join(", ")} — backfilled from defaults (LLM pages kept)`
  );
  return { ...plan, pages: [...plan.pages, ...backfill] };
}

function plannerUserPrompt(brief: ExpandedBrief, parseError?: string): string {
  const retryBlock = parseError
    ? `\n\nPRIOR RESPONSE WAS INVALID JSON (${parseError}). Return ONLY strict JSON matching the schema — no prose, no markdown.`
    : "";
  return `${briefToContext(brief)}${retryBlock}`;
}

export async function planSite(brief: ExpandedBrief): Promise<SitePlan> {
  requireLlm("site planning");

  if (llm.isAvailable) {
    try {
      const parsed = await chatJsonWithRetry(
        "site planner",
        plannerSystemPrompt(),
        (parseError) => plannerUserPrompt(brief, parseError),
        {
          tokenRole: "plan",
          model: llm.getCompositionModel(),
          initialTemperature: 0.5,
          maxAttempts: 3,
        },
        (raw) => parseLlmJson(raw)
      );
      return validateCorePages(parseSitePlan(parsed, brief), brief);
    } catch (err) {
      recordFallback("site_planner");
      if (!allowMocks()) throw err instanceof Error ? err : new Error(String(err));
    }
  }

  if (!allowMocks()) throw new Error("Site planning requires LLM");
  return mockPlan(brief);
}

export function getPagePlan(plan: SitePlan, slug: string) {
  return plan.pages.find((p) => p.slug === slug);
}
