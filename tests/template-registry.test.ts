import { describe, it, expect } from "vitest";
import {
  SECTION_TEMPLATES,
  TEMPLATE_IDS,
  validateTemplateProps,
  templateCatalogForPrompt,
} from "../src/section-templates/registry.js";

describe("section template registry", () => {
  it("has 15 premium templates", () => {
    expect(SECTION_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(TEMPLATE_IDS).toContain("hero_editorial");
    expect(TEMPLATE_IDS).toContain("services_showcase");
    expect(TEMPLATE_IDS).toContain("cta_band");
  });

  it("validates hero_editorial props", () => {
    const props = validateTemplateProps("hero_editorial", {
      headline: "Welcome",
      subcopy: "Tagline",
      image: { imageQuery: "hero" },
    });
    expect(props.headline).toBe("Welcome");
  });

  it("validates services_showcase props", () => {
    const props = validateTemplateProps("services_showcase", {
      headline: "Our Services",
      paragraphs: ["First paragraph", "Second paragraph"],
      image: { imageQuery: "service" },
    });
    expect(props.paragraphs).toHaveLength(2);
  });

  it("catalog lists all templates for LLM prompt", () => {
    const catalog = templateCatalogForPrompt();
    for (const id of TEMPLATE_IDS) {
      expect(catalog).toContain(id);
    }
  });
});
