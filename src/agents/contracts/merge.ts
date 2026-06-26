import type { SectionMotionConfig, SiteMotionPlan } from "../../types.js";
import type { SectionInstance } from "../../types.js";

export function attachMotionPlan(
  sections: SectionInstance[],
  plan: SiteMotionPlan
): SectionInstance[] {
  return sections.map((s) => ({
    ...s,
    motionConfig: plan.sections[s.id] ?? { entrance: "reveal" },
    motion: plan.sections[s.id]?.entrance ?? s.motion,
  }));
}

export function mergeSectionMotionIntoPages(
  reactPages: Record<string, { sections: SectionInstance[] }>,
  plan: SiteMotionPlan
): void {
  for (const page of Object.values(reactPages)) {
    page.sections = attachMotionPlan(page.sections, plan);
  }
}

export function defaultSectionMotion(templateId: string): SectionMotionConfig {
  if (templateId.startsWith("hero_")) {
    return { entrance: "reveal", parallax: true };
  }
  if (templateId === "stats_marquee" || templateId === "logo_marquee" || templateId === "text_marquee") {
    return { entrance: "stagger", marquee: true, staggerDelay: 0.06 };
  }
  if (templateId === "stats_animated" || templateId === "testimonial_carousel" || templateId === "portfolio_carousel") {
    return { entrance: "stagger", staggerDelay: 0.08 };
  }
  if (templateId === "cta_band" || templateId === "footer_cta" || templateId === "newsletter_band") {
    return { entrance: "scale-in" };
  }
  return { entrance: "reveal" };
}
