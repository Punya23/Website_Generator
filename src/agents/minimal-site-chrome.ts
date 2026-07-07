/** Clean chrome/motion defaults for page-codegen — no grain, blur, or scroll gimmicks. */
import type { ChromeSpec, PageBlueprint, SiteContext, SiteMotionPlan } from "../types.js";
import { defaultSectionMotion } from "./contracts/index.js";

export function minimalChromeSpec(ctx: SiteContext, blueprints: PageBlueprint[]): ChromeSpec {
  const slugs = blueprints.map((b) => b.slug);
  return {
    footer: {
      layout: "centered",
      tagline: ctx.expandedBrief.tagline,
      linkGroups: [{ label: "Pages", slugs: slugs.filter((s) => s !== "contact") }],
      ctaLabel: ctx.expandedBrief.primaryCta,
      ctaHref: "/contact",
      showMood: false,
    },
    nav: {
      compactOnScroll: false,
      shadowOnScroll: false,
    },
    immersive: {
      smoothScroll: false,
      grainOverlay: false,
    },
  };
}

export function minimalMotionPlan(ctx: SiteContext, blueprints: PageBlueprint[]): SiteMotionPlan {
  const sections: SiteMotionPlan["sections"] = {};
  for (const bp of blueprints) {
    for (const s of bp.sections) {
      const base = defaultSectionMotion(s.templateId);
      sections[s.id] = {
        ...base,
        entrance: s.templateId.startsWith("hero_") ? "none" : base.entrance,
        parallax: false,
        marquee: false,
      };
    }
  }

  return {
    globalPreset: ctx.designSystem.motionPreset ?? "fade-up",
    reducedMotion: "respect",
    navScrollEnhance: false,
    sections,
    chrome: {
      footer: { entrance: "none" },
      nav: { compactOnScroll: false, shadowOnScroll: false },
    },
  };
}
