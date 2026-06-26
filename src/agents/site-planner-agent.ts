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

const ALLOWED_BLOCK_TYPES = PLANNER_BLOCK_TYPES.join(", ");

const PLANNER_SYSTEM = `You are a website information architect. Design a unique site structure for this business.

Think through what pages matter, what each page must accomplish, how navigation should read at a glance, and what overall visual/layout personality suits the brand.

Output valid JSON:
{
  "pages": [
    {
      "slug": "home|about|services|contact|team|pricing|faq|gallery",
      "title": "page heading for the page itself",
      "navLabel": "short label for the navigation bar — clear and scannable",
      "goal": "what this page must accomplish",
      "minBlocks": number (total content blocks target for page, usually 8-24),
      "layoutHint": "your creative direction for how this page should feel spatially",
      "contentFocus": ["topics to cover in depth"],
      "sections": [
        { "id": "home_hero", "intent": "...", "blockTypes": ["headline", "text"] },
        { "id": "home_proof", "intent": "...", "blockTypes": ["stat", "feature"] }
      ]

Allowed blockTypes values ONLY: ${ALLOWED_BLOCK_TYPES}
Never use invented types like card, button, accordion, profileCard, backgroundImage.
    }
  ],
  "compositionStrategy": "how layout rhythm should differ from a generic template",
  "avoidPatterns": ["what to avoid for this specific business"],
  "visualArchetype": "free-form name e.g. salon-luxury-dark, dental-clinical-light, finance-corporate-light",
  "industryFamily": "short slug for vertical (salon, dental, finance, etc.)",
  "motionStyle": "how motion should feel on scroll"
}

Include home, about, services, and contact. Add optional pages only if genuinely needed.
Derive everything from the business — not stereotypes.`;

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

export async function planSite(brief: ExpandedBrief): Promise<SitePlan> {
  requireLlm("site planning");

  if (llm.isAvailable) {
    try {
      const raw = await llm.chat(
        PLANNER_SYSTEM,
        briefToContext(brief),
        { jsonMode: true, temperature: 0.6, tokenRole: "plan", model: llm.getCompositionModel() }
      );
      const plan = parseSitePlan(JSON.parse(raw), brief);
      const slugs = new Set(plan.pages.map((p) => p.slug));
      for (const core of CORE_PAGE_KINDS) {
        if (!slugs.has(core)) {
          if (!allowMocks()) throw new Error(`Site plan missing required page: ${core}`);
          return mockPlan(brief);
        }
      }
      return plan;
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
