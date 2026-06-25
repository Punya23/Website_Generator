import { describe, it, expect } from "vitest";
import { directPageBlueprints } from "../src/agents/creative-director-agent.js";
import { composePageSections } from "../src/agents/page-composer-agent.js";
import { fillSectionProps } from "../src/agents/section-props-agent.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { MediaRegistry } from "../src/media/media-registry.js";
import { runReactQA } from "../src/qa/react-qa.js";
import { mockPlan } from "./helpers/mock-site.js";

describe("Dstyle fashion react regression", () => {
  it("mock react pipeline avoids card-heavy monotony", async () => {
    const brief = {
      businessName: "Dstyle",
      tagline: "Modern elegance",
      elevatorPitch: "Contemporary fashion house blending tradition with modern silhouettes.",
      expandedBrief:
        "Dstyle is a fashion brand for women seeking bespoke bridal wear, saree collections, and custom tailoring.",
      targetAudience: "Women 25-45",
      services: ["Bridal couture", "Saree collections", "Custom tailoring"],
      differentiators: ["Handcrafted detail", "Premium fabrics", "Personal styling"],
      tone: "Elegant and editorial",
      primaryCta: "Book consultation",
      secondaryCta: "View collections",
    };

    const sitePlan = mockPlan(brief);
    const ctx = initSiteContext("Fashion", brief, sitePlan, {
      vertical: "fashion",
      mood: "editorial luxe",
      fontHeading: "Playfair Display",
      fontBody: "Inter",
      sectionGapMode: "airy",
      typography: {
        display: "Playfair Display",
        heading: "Playfair Display",
        body: "Inter",
        label: "Inter",
        mono: "IBM Plex Mono",
      },
      surfaces: {
        default: "none",
        elevated: "pricing panels only",
        none: "typography-first sections",
      },
      colors: {
        bg: "#fafafa",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#e85d04",
        accentSoft: "#fff7ed",
        gradientFrom: "#e85d04",
        gradientTo: "#f48c06",
        navBg: "#fff",
        navText: "#111",
        navMuted: "#666",
        navActiveBg: "#e85d04",
        navActiveText: "#fff",
      },
    });

    const registry = new MediaRegistry();
    const blueprints = await directPageBlueprints(ctx, sitePlan.pages);

    for (const blueprint of blueprints) {
      const instances = [];
      for (const section of blueprint.sections) {
        instances.push(await fillSectionProps(ctx, blueprint.slug, section, registry));
      }
      const composed = composePageSections(blueprint, instances);
      const qa = runReactQA(
        { slug: blueprint.slug, title: blueprint.slug, sections: composed },
        blueprint.slug
      );

      expect(qa.issues.filter((i) => i.code === "UNKNOWN_TEMPLATE")).toHaveLength(0);
      expect(qa.issues.filter((i) => i.code === "RAW_JSON_PROPS")).toHaveLength(0);

      const cardHeavy = qa.issues.filter((i) => i.code === "CARD_HEAVY_PAGE");
      expect(cardHeavy.length, cardHeavy.map((i) => i.message).join("; ")).toBeLessThanOrEqual(1);
    }
  });
});
