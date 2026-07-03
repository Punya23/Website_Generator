import { describe, it, expect } from "vitest";
import { repairTemplateProps } from "../src/section-templates/repair-props.js";
import { validateTemplateProps } from "../src/section-templates/registry.js";

describe("repairTemplateProps", () => {
  it("coerces ServicesShowcase body into paragraphs", () => {
    const repaired = repairTemplateProps("services_showcase", {
      headline: "Our approach",
      body: "We combine expertise with personal attention.",
    });
    expect(repaired.paragraphs).toEqual(["We combine expertise with personal attention."]);
    expect(repaired.body).toBeUndefined();
  });

  it("validates ServicesShowcase after repair without paragraphs in LLM output", () => {
    const props = validateTemplateProps("services_showcase", {
      headline: "Our Services",
      subcopy: "Everything you need in one place.",
    });
    expect(props.paragraphs).toEqual(["Everything you need in one place."]);
  });

  it("truncates ScrollShowcase steps that exceed the schema max instead of failing validation", () => {
    const repaired = repairTemplateProps("scroll_showcase", {
      headline: "How it works",
      steps: Array.from({ length: 8 }, (_, i) => ({
        title: `Step ${i + 1}`,
        description: `Description ${i + 1}`,
      })),
    });
    expect((repaired.steps as unknown[]).length).toBe(5);

    const props = validateTemplateProps("scroll_showcase", {
      headline: "How it works",
      steps: Array.from({ length: 8 }, (_, i) => ({
        title: `Step ${i + 1}`,
        description: `Description ${i + 1}`,
      })),
    });
    expect((props.steps as unknown[]).length).toBe(5);
  });

  it("drops ScrollShowcase steps entirely when fewer than the schema min survive repair", () => {
    const repaired = repairTemplateProps("scroll_showcase", {
      headline: "How it works",
      steps: [{ title: "Only one" }],
    });
    expect(repaired.steps).toBeUndefined();
  });

  describe("gallery_masonry", () => {
    it("pads images to the schema minimum (3) when the media curator returned none", () => {
      const repaired = repairTemplateProps("gallery_masonry", {
        headline: "Gallery",
      });
      expect(Array.isArray(repaired.images)).toBe(true);
      expect((repaired.images as unknown[]).length).toBe(3);

      const props = validateTemplateProps("gallery_masonry", {
        headline: "Gallery",
      });
      expect((props.images as unknown[]).length).toBe(3);
    });

    it("pads a too-short images array up to the minimum, preserving existing entries", () => {
      const repaired = repairTemplateProps("gallery_masonry", {
        headline: "Gallery",
        images: [{ imageQuery: "storefront" }],
      });
      const images = repaired.images as Record<string, unknown>[];
      expect(images.length).toBe(3);
      expect(images[0]!.imageQuery).toBe("storefront");
    });

    it("reuses an already-resolved image src for padded filler slots instead of shipping blank tiles", () => {
      const repaired = repairTemplateProps("gallery_masonry", {
        headline: "Gallery",
        images: [{ imageQuery: "storefront", src: "https://cdn.example.com/storefront.jpg" }],
      });
      const images = repaired.images as Record<string, unknown>[];
      expect(images.length).toBe(3);
      expect(images.every((img) => img.src === "https://cdn.example.com/storefront.jpg")).toBe(true);
    });

    it("truncates an images array that exceeds the schema max (12)", () => {
      const repaired = repairTemplateProps("gallery_masonry", {
        headline: "Gallery",
        images: Array.from({ length: 20 }, (_, i) => ({ imageQuery: `image ${i}` })),
      });
      expect((repaired.images as unknown[]).length).toBe(12);

      const props = validateTemplateProps("gallery_masonry", {
        headline: "Gallery",
        images: Array.from({ length: 20 }, (_, i) => ({ imageQuery: `image ${i}` })),
      });
      expect((props.images as unknown[]).length).toBe(12);
    });

    it("derives imageQuery from caption when imageQuery is missing", () => {
      const repaired = repairTemplateProps("gallery_masonry", {
        images: [
          { caption: "Bridal suite" },
          { caption: "Reception hall" },
          { caption: "Garden view" },
        ],
      });
      const images = repaired.images as Record<string, unknown>[];
      expect(images[0]!.imageQuery).toBe("Bridal suite");
    });
  });

  describe("before_after", () => {
    it("fills missing before/after images with a placeholder query so required fields validate", () => {
      const repaired = repairTemplateProps("before_after", {
        headline: "See the difference",
      });
      expect(repaired.before).toEqual({ imageQuery: "before transformation" });
      expect(repaired.after).toEqual({ imageQuery: "after transformation" });

      const props = validateTemplateProps("before_after", {
        headline: "See the difference",
      });
      expect(props.before).toBeTruthy();
      expect(props.after).toBeTruthy();
    });
  });

  describe("cta_band / footer_cta", () => {
    it("builds a valid cta object when cta is entirely missing", () => {
      const repaired = repairTemplateProps("cta_band", {
        headline: "Ready to get started?",
      });
      expect(repaired.cta).toEqual({ label: "Ready to get started?" });

      const props = validateTemplateProps("cta_band", {
        headline: "Ready to get started?",
      });
      expect((props.cta as Record<string, unknown>).label).toBe("Ready to get started?");
    });

    it("preserves an existing well-formed cta unchanged", () => {
      const repaired = repairTemplateProps("footer_cta", {
        headline: "Let's talk",
        cta: { label: "Book now", href: "/contact" },
      });
      expect(repaired.cta).toEqual({ label: "Book now", href: "/contact" });
    });
  });
});
