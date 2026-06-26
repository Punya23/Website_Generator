import type { PageBlueprint, SiteContext } from "../types.js";
import { pipelineLog } from "../util/pipeline-log.js";

const PREMIUM_TEMPLATES = new Set(["hero_spotlight", "scroll_showcase", "horizontal_gallery"]);
const GALLERY_TEMPLATES = new Set([
  "gallery_masonry",
  "horizontal_gallery",
  "portfolio_carousel",
  "scroll_showcase",
]);

function injectSection(
  sections: PageBlueprint["sections"],
  templateId: string,
  intent: string,
  slug: string,
  index: number
): PageBlueprint["sections"] {
  const id = `${slug}_repair_${index}_${templateId.replace(/_/g, "")}`;
  const next = [...sections];
  next.splice(index, 0, { id, templateId, intent });
  return next.map((s, i) => ({
    ...s,
    id: `${slug}_s${i}_${s.templateId.replace(/_/g, "")}`,
  }));
}

/** Deterministic blueprint fixes after pool retry — no extra LLM. */
export function repairBlueprints(
  blueprints: PageBlueprint[],
  ctx: SiteContext
): PageBlueprint[] {
  const profile = ctx.verticalProfile?.profileId ?? "corporate-light";
  const isEditorial = profile === "editorial-light" || profile === "luxury-dark";

  return blueprints.map((bp) => {
    let sections = [...bp.sections];
    let repaired = false;

    if (bp.slug === "home") {
      const hasPremium = sections.some((s) => PREMIUM_TEMPLATES.has(s.templateId));
      if (!hasPremium && sections.length > 0) {
        const premium = isEditorial ? "scroll_showcase" : "hero_spotlight";
        sections = injectSection(
          sections,
          premium,
          "Immersive showcase",
          bp.slug,
          Math.min(1, sections.length)
        );
        repaired = true;
      }

      if (isEditorial) {
        const hasGallery = sections.some((s) => GALLERY_TEMPLATES.has(s.templateId));
        if (!hasGallery && sections.length >= 2) {
          const insertAt = Math.max(1, sections.length - 1);
          sections = injectSection(
            sections,
            "horizontal_gallery",
            "Visual rhythm",
            bp.slug,
            insertAt
          );
          repaired = true;
        }
      }
    }

    if (bp.slug === "gallery" && sections.length < 2) {
      const hasGalleryContent = sections.some((s) => GALLERY_TEMPLATES.has(s.templateId));
      if (!hasGalleryContent) {
        sections = injectSection(
          sections,
          "gallery_masonry",
          "Selected work",
          bp.slug,
          0
        );
        repaired = true;
      }
      if (sections.length < 2) {
        sections = injectSection(
          sections,
          "intro_statement",
          "Our collection",
          bp.slug,
          0
        );
        repaired = true;
      }
    }

    if (sections.length < 2) {
      sections = injectSection(
        sections,
        "intro_statement",
        ctx.sitePlan.pages.find((p) => p.slug === bp.slug)?.goal ?? "Welcome",
        bp.slug,
        0
      );
      repaired = true;
    }

    if (repaired) {
      pipelineLog(`[pipeline] Blueprint repair applied to ${bp.slug} (${sections.length} sections)`);
    }

    return { ...bp, sections };
  });
}
