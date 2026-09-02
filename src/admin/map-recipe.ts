import { getTemplate, TEMPLATE_IDS } from "../section-templates/registry.js";
import {
  SiteSkinSchema,
  type SiteSkin,
  type SkinCategory,
  type SkinProvenance,
  type SkinVisualFamily,
} from "../skins/schema.js";
import { industryArchetype, isArchetype, isIndustry, type Industry, type SiteArchetype } from "../skins/taxonomy.js";
import type { MotionPreset } from "../types.js";
import { inferLandmark } from "./extract-outline.js";
import type { Landmark, MappedRecipe, MappedSection, PageOutline } from "./types.js";

const LANDMARK_TO_TEMPLATE: Record<Landmark, string> = {
  hero: "hero_statement",
  features: "offer_index",
  story: "story_split",
  gallery: "horizontal_gallery",
  testimonials: "testimonial_featured",
  pricing: "pricing_tiers",
  faq: "faq_accordion",
  cta: "cta_band",
  contact: "contact_split",
  team: "team_grid",
  stats: "stats_marquee",
  other: "intro_statement",
};

function knownTemplate(id: string): string | undefined {
  return TEMPLATE_IDS.includes(id as (typeof TEMPLATE_IDS)[number]) ? id : undefined;
}

export function sanitizeMappedSections(
  sections: Array<{ templateId: string; intent: string; landmark?: Landmark }>,
  options: { min: number; max: number; fallback: MappedRecipe["home"] }
): MappedRecipe["home"] {
  const used = new Set<string>();
  const next: MappedRecipe["home"] = [];
  for (const section of sections) {
    const id = knownTemplate(section.templateId);
    if (!id || !getTemplate(id)) continue;
    if (used.has(id) && id !== "story_split") continue;
    used.add(id);
    const intentRaw = (section.intent || "Section").trim();
    next.push({
      templateId: id,
      intent: (intentRaw.length >= 4 ? intentRaw : `${intentRaw} block`).slice(0, 80),
      landmark: section.landmark,
    });
    if (next.length >= options.max) break;
  }
  if (next.length < options.min) {
    for (const extra of options.fallback) {
      if (next.length >= options.min) break;
      if (next.some((row) => row.templateId === extra.templateId) && extra.templateId !== "story_split") {
        continue;
      }
      next.push(extra);
    }
  }
  return next.slice(0, options.max);
}

export function mapOutlineToRecipe(outline: PageOutline): MappedRecipe {
  const notes: string[] = [];
  const home: MappedRecipe["home"] = [];
  const used = new Set<string>();

  const push = (templateId: string, intent: string, landmark?: Landmark) => {
    const id = knownTemplate(templateId);
    if (!id || !getTemplate(id)) {
      notes.push(`Skipped unknown template ${templateId}`);
      return;
    }
    if (used.has(id) && id !== "story_split") return;
    used.add(id);
    const intentRaw = (intent || landmark || "Section").trim();
    const safeIntent = intentRaw.length >= 4 ? intentRaw : `${intentRaw} block`;
    home.push({ templateId: id, intent: safeIntent.slice(0, 80), landmark });
  };

  if (!outline.landmarks.includes("hero")) {
    push("hero_statement", outline.title || "Opening", "hero");
  }

  for (const heading of outline.headings) {
    const landmark = inferLandmark(heading.text);
    push(LANDMARK_TO_TEMPLATE[landmark], heading.text.slice(0, 48) || landmark, landmark);
    if (home.length >= 6) break;
  }

  if (home.length === 0) {
    push("hero_statement", outline.title || "Opening", "hero");
  }
  if (!home.some((s) => s.templateId.startsWith("hero_"))) {
    home.unshift({
      templateId: "hero_statement",
      intent: outline.title || "Opening",
      landmark: "hero",
    });
  }
  if (!home.some((s) => s.templateId === "cta_band" || s.templateId === "footer_cta")) {
    push("cta_band", "Close the page", "cta");
  }

  const trimmed = home.slice(0, 8);
  const closers = trimmed.filter((s) => s.templateId === "cta_band" || s.templateId === "footer_cta");
  if (closers.length > 1) {
    let keep = -1;
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i]?.templateId === "cta_band" || trimmed[i]?.templateId === "footer_cta") {
        keep = i;
        break;
      }
    }
    const next = trimmed.filter((s, i) => i === keep || (s.templateId !== "cta_band" && s.templateId !== "footer_cta"));
    return score(next, notes, outline);
  }

  return score(trimmed, notes, outline);
}

function score(home: MappedRecipe["home"], notes: string[], outline: PageOutline): MappedRecipe {
  let confidence = 0.35;
  if (home[0]?.templateId.startsWith("hero_")) confidence += 0.2;
  if (home.some((s) => s.templateId === "offer_index" || s.templateId === "feature_bento")) confidence += 0.15;
  if (outline.landmarks.length >= 3) confidence += 0.15;
  if (home.length >= 4) confidence += 0.1;
  if (outline.headings.length < 2) {
    confidence -= 0.2;
    notes.push("Sparse outline — review mapping before approval");
  }
  return {
    home,
    notes,
    confidence: Math.max(0.1, Math.min(0.95, confidence)),
  };
}

const DEFAULT_ABOUT: MappedRecipe["home"] = [
  { templateId: "story_split", intent: "Our story" },
  { templateId: "team_grid", intent: "People" },
];
const DEFAULT_SERVICES: MappedRecipe["home"] = [
  { templateId: "offer_index", intent: "Services" },
  { templateId: "faq_accordion", intent: "Questions" },
  { templateId: "footer_cta", intent: "Start" },
];
const DEFAULT_CONTACT: MappedRecipe["home"] = [
  { templateId: "contact_split", intent: "Contact" },
  { templateId: "faq_accordion", intent: "Before you write" },
];

function sectionsFromOutline(
  outline: PageOutline | undefined,
  fallback: MappedRecipe["home"],
  min: number,
  max: number
): MappedRecipe["home"] {
  if (!outline) return fallback.slice(0, max);
  const mapped = mapOutlineToRecipe(outline).home;
  return sanitizeMappedSections(mapped, { min, max, fallback });
}

export function draftSkinFromRecipe(options: {
  title: string;
  inspiredBy: string;
  category: SkinCategory;
  recipe: MappedRecipe;
  existingIds: string[];
  visualFamily?: SkinVisualFamily;
  navShape?: SiteSkin["chrome"]["navShape"];
  footerLayout?: SiteSkin["chrome"]["footerLayout"];
  motionPreset?: MotionPreset;
  pageOutlines?: Record<string, PageOutline>;
  extraPages?: {
    about?: MappedSection[];
    services?: MappedSection[];
    contact?: MappedSection[];
  };
  industry?: string;
  archetype?: string;
  provenance?: SkinProvenance;
}): SiteSkin {
  const slug = options.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28) || "ingested";
  let id = `ingested-${slug}`;
  let n = 2;
  while (options.existingIds.includes(id)) {
    id = `ingested-${slug}-${n++}`;
  }

  const home = sanitizeMappedSections(options.recipe.home, {
    min: 3,
    max: 8,
    fallback: [
      { templateId: "hero_statement", intent: "Opening" },
      { templateId: "offer_index", intent: "What we offer" },
      { templateId: "cta_band", intent: "Get in touch" },
    ],
  });

  const about = sanitizeMappedSections(
    options.extraPages?.about ?? sectionsFromOutline(options.pageOutlines?.about, DEFAULT_ABOUT, 2, 6),
    { min: 2, max: 6, fallback: DEFAULT_ABOUT }
  );
  const services = sanitizeMappedSections(
    options.extraPages?.services ??
      sectionsFromOutline(options.pageOutlines?.services, DEFAULT_SERVICES, 2, 6),
    { min: 2, max: 6, fallback: DEFAULT_SERVICES }
  );
  const contact = sanitizeMappedSections(
    options.extraPages?.contact ??
      sectionsFromOutline(options.pageOutlines?.contact, DEFAULT_CONTACT, 2, 6),
    { min: 2, max: 6, fallback: DEFAULT_CONTACT }
  );

  const raw = {
    id,
    name: options.title.slice(0, 48) || "Ingested recipe",
    categories: [options.category],
    visualFamily: options.visualFamily ?? "editorial-light",
    description: `Approved composition recipe from ${options.inspiredBy}. Original HTML was not vendored.`,
    chrome: {
      navShape: options.navShape ?? "full-width",
      footerLayout: options.footerLayout ?? "two-column",
    },
    motionPreset: options.motionPreset ?? "fade-up",
    widget: "none" as const,
    inspiredBy: options.inspiredBy,
    industries: isIndustry(options.industry) ? ([options.industry] as Industry[]) : undefined,
    archetype: isArchetype(options.archetype)
      ? (options.archetype as SiteArchetype)
      : isIndustry(options.industry)
        ? industryArchetype(options.industry)
        : undefined,
    provenance: options.provenance,
    pages: { home, about, services, contact },
  };

  return SiteSkinSchema.parse(raw);
}

