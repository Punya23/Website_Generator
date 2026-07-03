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
});
