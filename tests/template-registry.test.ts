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
    expect(TEMPLATE_IDS).toContain("hero_metro");
    expect(TEMPLATE_IDS).toContain("testimonial_carousel");
    expect(TEMPLATE_IDS).toContain("portfolio_carousel");
    expect(TEMPLATE_IDS).toContain("before_after");
    expect(TEMPLATE_IDS).toContain("pricing_toggle");
    expect(TEMPLATE_IDS).toContain("stats_animated");
    expect(TEMPLATE_IDS).toContain("newsletter_band");
    expect(TEMPLATE_IDS).toContain("text_marquee");
    expect(TEMPLATE_IDS).toContain("quote_calculator");
    expect(TEMPLATE_IDS).toContain("hero_statement");
    expect(TEMPLATE_IDS).toContain("story_split");
    expect(TEMPLATE_IDS).toContain("offer_index");
    expect(TEMPLATE_IDS).toContain("hours_location");
    expect(TEMPLATE_IDS).toContain("menu_board");
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

  it("validates hero_metro image reveal frames", () => {
    const props = validateTemplateProps("hero_metro", {
      headline: "Look ahead",
      subcopy: "The next still is already moving.",
      images: [
        { caption: "Lobby", image: { imageQuery: "hotel lobby dusk" } },
        { caption: "Suite", image: { imageQuery: "suite interior" } },
      ],
    });
    expect(props.headline).toBe("Look ahead");
    expect(Array.isArray(props.images)).toBe(true);
    expect((props.images as unknown[]).length).toBeGreaterThanOrEqual(3);
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

  it("validates story_split and offer_index copy", () => {
    const story = validateTemplateProps("story_split", {
      headline: "Why this crew",
      paragraphs: ["We show up the same day.", "We leave the site clean."],
      image: { imageQuery: "workshop" },
    });
    expect(story.headline).toBe("Why this crew");

    const offers = validateTemplateProps("offer_index", {
      headline: "What we fix",
      items: [
        { title: "Leaks", description: "Same-day pipe repair." },
        { title: "Heat", description: "Furnace service." },
        { title: "Cooling", description: "AC recovery." },
      ],
    });
    expect(offers.items).toHaveLength(3);
  });

  it("catalog lists all templates for LLM prompt", () => {
    const catalog = templateCatalogForPrompt();
    for (const id of TEMPLATE_IDS) {
      expect(catalog).toContain(id);
    }
  });
});
