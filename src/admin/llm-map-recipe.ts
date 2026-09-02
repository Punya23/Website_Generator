import { llm } from "../llm/client.js";
import { TEMPLATE_IDS } from "../section-templates/registry.js";
import type { SkinVisualFamily } from "../skins/schema.js";
import { ingestModel, ingestUseLlm } from "./config.js";
import { mapOutlineToRecipe, sanitizeMappedSections } from "./map-recipe.js";
import type { MappedRecipe, MappedSection, PageOutline, ThemeFeatures } from "./types.js";

export interface LlmMappedSkin {
  recipe: MappedRecipe;
  visualFamily: SkinVisualFamily;
  navShape: "full-width" | "floating-capsule" | "floating-panel" | "split-inline";
  footerLayout: "two-column" | "centered" | "cta-heavy";
  extraPages: {
    about: MappedSection[];
    services: MappedSection[];
    contact: MappedSection[];
  };
  usedLlm: boolean;
  /** Visual attributes came from a measured render rather than a model guess. */
  usedFeatures: boolean;
}

const VISUAL: SkinVisualFamily[] = [
  "luxury-dark",
  "clinical-light",
  "corporate-light",
  "editorial-light",
  "warm-consumer",
];

const NAV = ["full-width", "floating-capsule", "floating-panel", "split-inline"] as const;
const FOOTER = ["two-column", "centered", "cta-heavy"] as const;

function pickFamily(value: unknown): SkinVisualFamily {
  return VISUAL.includes(value as SkinVisualFamily) ? (value as SkinVisualFamily) : "editorial-light";
}

function asSections(value: unknown): MappedSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const templateId = String((row as { templateId?: string }).templateId ?? "");
      const intent = String((row as { intent?: string }).intent ?? "Section");
      if (!templateId) return null;
      return { templateId, intent };
    })
    .filter((row): row is MappedSection => Boolean(row));
}

function fallbackPages(homeOutline: PageOutline, pageOutlines?: Record<string, PageOutline>) {
  return {
    about: sanitizeMappedSections(mapOutlineToRecipe(pageOutlines?.about ?? homeOutline).home, {
      min: 2,
      max: 6,
      fallback: [
        { templateId: "story_split", intent: "Our story" },
        { templateId: "team_grid", intent: "People" },
      ],
    }),
    services: sanitizeMappedSections(mapOutlineToRecipe(pageOutlines?.services ?? homeOutline).home, {
      min: 2,
      max: 6,
      fallback: [
        { templateId: "offer_index", intent: "Services" },
        { templateId: "faq_accordion", intent: "Questions" },
        { templateId: "footer_cta", intent: "Start" },
      ],
    }),
    contact: sanitizeMappedSections(mapOutlineToRecipe(pageOutlines?.contact ?? homeOutline).home, {
      min: 2,
      max: 6,
      fallback: [
        { templateId: "contact_split", intent: "Contact" },
        { templateId: "faq_accordion", intent: "Before you write" },
      ],
    }),
  };
}

export async function mapOutlineWithLlm(options: {
  outline: PageOutline;
  category: string;
  pageOutlines?: Record<string, PageOutline>;
  features?: ThemeFeatures;
}): Promise<LlmMappedSkin> {
  const deterministic = mapOutlineToRecipe(options.outline);
  const extraPages = fallbackPages(options.outline, options.pageOutlines);
  const features = options.features;

  // Measured beats guessed. When a render answered every visual question, the whole reason for
  // the mapping LLM call is gone — the section order already comes from the outline heuristic.
  if (features?.conclusive) {
    return {
      recipe: {
        home: deterministic.home,
        notes: [...deterministic.notes, "Visual attributes measured from a rendered demo"],
        confidence: Math.min(0.95, Math.max(deterministic.confidence, 0.75)),
      },
      visualFamily: features.visualFamily,
      navShape: features.navShape,
      footerLayout: features.footerLayout,
      extraPages,
      usedLlm: false,
      usedFeatures: true,
    };
  }

  if (!ingestUseLlm() || !llm.isAvailable) {
    return {
      recipe: deterministic,
      visualFamily: features?.visualFamily ?? "editorial-light",
      navShape: features?.navShape ?? "full-width",
      footerLayout: features?.footerLayout ?? "two-column",
      extraPages,
      usedLlm: false,
      usedFeatures: Boolean(features),
    };
  }

  const headings = options.outline.headings.map((h) => `h${h.level}: ${h.text}`).join("\n");
  const extra = Object.entries(options.pageOutlines ?? {})
    .map(([slug, outline]) => `${slug}: ${outline.headings.map((h) => h.text).join(" | ")}`)
    .join("\n");

  try {
    const raw = await llm.chat(
      `You map public website outlines onto a fixed React section library. Return JSON only.
Never copy HTML/CSS. Pick templateId values only from this allowlist:
${TEMPLATE_IDS.join(", ")}
visualFamily must be one of: ${VISUAL.join(", ")}
navShape: ${NAV.join(", ")}
footerLayout: ${FOOTER.join(", ")}
home: 3-8 sections, first must be a hero_* template, exactly one cta_band or footer_cta at the end.
about/services/contact: 2-6 sections each.`,
      JSON.stringify({
        category: options.category,
        title: options.outline.title,
        landmarks: options.outline.landmarks,
        headings,
        extraPages: extra,
      }),
      {
        jsonMode: true,
        temperature: 0.4,
        tokenRole: "composition",
        model: ingestModel(),
      }
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const home = sanitizeMappedSections(asSections(parsed.home), {
      min: 3,
      max: 8,
      fallback: deterministic.home,
    });
    const confidence = Math.max(
      deterministic.confidence,
      typeof parsed.confidence === "number" ? parsed.confidence : 0.75
    );
    return {
      recipe: {
        home,
        notes: [...deterministic.notes, "Mapped with LLM"],
        confidence: Math.min(0.95, confidence),
      },
      visualFamily: features?.visualFamily ?? pickFamily(parsed.visualFamily),
      navShape:
        features?.navShape ??
        (NAV.includes(parsed.navShape as (typeof NAV)[number])
          ? (parsed.navShape as (typeof NAV)[number])
          : "full-width"),
      footerLayout:
        features?.footerLayout ??
        (FOOTER.includes(parsed.footerLayout as (typeof FOOTER)[number])
          ? (parsed.footerLayout as (typeof FOOTER)[number])
          : "two-column"),
      extraPages: {
        about: sanitizeMappedSections(asSections(parsed.about), {
          min: 2,
          max: 6,
          fallback: extraPages.about,
        }),
        services: sanitizeMappedSections(asSections(parsed.services), {
          min: 2,
          max: 6,
          fallback: extraPages.services,
        }),
        contact: sanitizeMappedSections(asSections(parsed.contact), {
          min: 2,
          max: 6,
          fallback: extraPages.contact,
        }),
      },
      usedLlm: true,
      usedFeatures: Boolean(features),
    };
  } catch {
    return {
      recipe: deterministic,
      visualFamily: features?.visualFamily ?? "editorial-light",
      navShape: features?.navShape ?? "full-width",
      footerLayout: features?.footerLayout ?? "two-column",
      extraPages,
      usedLlm: false,
      usedFeatures: Boolean(features),
    };
  }
}
