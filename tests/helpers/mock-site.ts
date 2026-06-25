import type { ExpandedBrief, SitePlan } from "../../src/types.js";
import { SitePlanSchema } from "../../src/types.js";

export function mockPlan(brief: ExpandedBrief): SitePlan {
  return SitePlanSchema.parse({
    pages: [
      {
        slug: "home",
        title: "Home",
        navLabel: "Home",
        goal: "Hook visitors",
        minBlocks: 12,
        layoutHint: "Editorial hero",
        contentFocus: ["brand"],
      },
      {
        slug: "about",
        title: "About",
        navLabel: "About",
        goal: "Trust",
        minBlocks: 10,
        layoutHint: "Story",
        contentFocus: ["team"],
      },
      {
        slug: "services",
        title: "Services",
        navLabel: "Services",
        goal: "Detail offerings",
        minBlocks: 14,
        layoutHint: "Showcase",
        contentFocus: brief.services,
      },
      {
        slug: "contact",
        title: "Contact",
        navLabel: "Contact",
        goal: "Convert",
        minBlocks: 8,
        layoutHint: "Form",
        contentFocus: ["contact"],
      },
    ],
    compositionStrategy: "Editorial rhythm with bleed heroes",
    avoidPatterns: ["uniform card grids"],
    visualArchetype: "fashion-editorial",
    motionStyle: "stagger",
  });
}
