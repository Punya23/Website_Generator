import { describe, it, expect } from "vitest";
import { directPageBlueprints } from "../src/agents/creative-director-agent.js";
import { composePageSections } from "../src/agents/page-composer-agent.js";
import { fillSectionProps } from "../src/agents/section-props-agent.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { MediaRegistry } from "../src/media/media-registry.js";
import { mockPlan } from "./helpers/mock-site.js";

describe("react pipeline (mock)", () => {
  it("produces blueprints and validated section props", async () => {
    const brief = {
      businessName: "Dstyle",
      tagline: "Modern elegance",
      elevatorPitch: "Fashion brand for modern women",
      expandedBrief: "A contemporary fashion house.",
      targetAudience: "Women",
      services: ["Bridal", "Sarees", "Custom tailoring"],
      differentiators: ["Craft", "Quality", "Style"],
      tone: "Elegant",
      primaryCta: "Book consultation",
    };

    const sitePlan = mockPlan(brief);
    const ctx = initSiteContext("Fashion", brief, sitePlan, {
      vertical: "fashion",
      mood: "editorial",
      fontHeading: "Playfair Display",
      fontBody: "Inter",
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

    const blueprints = await directPageBlueprints(ctx, sitePlan.pages);
    expect(blueprints.length).toBe(4);
    expect(blueprints[0]?.sections[0]?.templateId).toMatch(/hero_/);

    const registry = new MediaRegistry();
    const home = blueprints.find((b) => b.slug === "home")!;
    const instances = [];
    for (const section of home.sections) {
      instances.push(await fillSectionProps(ctx, "home", section, registry));
    }

    const composed = composePageSections(home, instances);
    expect(composed.length).toBeGreaterThanOrEqual(home.sections.length);
    expect(composed.every((s) => s.props && typeof s.props === "object")).toBe(true);
    expect(composed.some((s) => s.templateId === "hero_editorial" || s.templateId === "hero_split_cinematic")).toBe(true);
  });
});
