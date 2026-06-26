import { describe, it, expect } from "vitest";
import {
  SECTION_TEMPLATES,
  TEMPLATE_IDS,
  validateTemplateProps,
  templateCatalogForPrompt,
} from "../src/section-templates/registry.js";

describe("section template registry", () => {
  it("has immersive marketing templates including carousels and video hero", () => {
    expect(SECTION_TEMPLATES.length).toBeGreaterThanOrEqual(24);
    expect(TEMPLATE_IDS).toContain("hero_video");
    expect(TEMPLATE_IDS).toContain("testimonial_carousel");
    expect(TEMPLATE_IDS).toContain("portfolio_carousel");
    expect(TEMPLATE_IDS).toContain("before_after");
    expect(TEMPLATE_IDS).toContain("pricing_toggle");
    expect(TEMPLATE_IDS).toContain("stats_animated");
    expect(TEMPLATE_IDS).toContain("newsletter_band");
    expect(TEMPLATE_IDS).toContain("text_marquee");
    expect(TEMPLATE_IDS).toContain("footer_cta");
  });

  it("validates text_marquee props", () => {
    const props = validateTemplateProps("text_marquee", {
      phrases: ["Craft", "Quality", "Style"],
      speed: "normal",
    });
    expect(props.phrases).toHaveLength(3);
  });

  it("validates footer_cta props", () => {
    const props = validateTemplateProps("footer_cta", {
      headline: "Ready to start?",
      cta: { label: "Contact", href: "/contact" },
    });
    expect(props.headline).toBe("Ready to start?");
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
