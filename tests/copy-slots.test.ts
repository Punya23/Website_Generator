import { describe, expect, it } from "vitest";
import { applyCopySlots } from "../src/templates/copy-slots.js";
import type { ExpandedBrief } from "../src/types.js";
import type { SlotLocator } from "../src/templates/types.js";

const BRIEF: ExpandedBrief = {
  businessName: "Cedar & Co",
  tagline: "Sourdough, done right",
  elevatorPitch: "A neighborhood bakery baking sourdough fresh every morning in Bristol.",
  expandedBrief:
    "Cedar & Co is a sourdough bakery in Bristol. We bake fresh loaves every single morning using a wild yeast starter that has been alive for a decade.",
  targetAudience: "Locals who care where their bread comes from",
  services: ["Sourdough loaves", "Pastries", "Custom cakes"],
  differentiators: ["Wild yeast starter", "Baked fresh daily", "Locally sourced flour"],
  tone: "Warm",
  primaryCta: "Order online",
};

describe("applyCopySlots — serviceItemTitle/serviceItemBody cycling (C1)", () => {
  it("cycles through the brief's services instead of leaving extra template cards untouched", () => {
    const html =
      `<section>` +
      Array.from({ length: 5 }, (_, i) => `<h3 class="svc-${i}">Original Service ${i}</h3>`).join("") +
      `</section>`;
    const slots: SlotLocator[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "serviceItemTitle",
      selector: `.svc-${i}`,
      groupIndex: i,
      originalText: `Original Service ${i}`,
    }));

    const result = applyCopySlots(html, slots, { brief: BRIEF, rawBrief: "", role: "features" });

    // Every card was filled — none left as the template author's own "Original Service N" demo copy.
    expect(result.html).not.toContain("Original Service");
    expect(result.skipped).toBe(0);
    expect(result.applied).toBe(5);
    // Cards 3 and 4 (index 3, 4) wrap back onto services[0] and services[1] — repeated real business
    // copy, not a leftover placeholder.
    expect(result.html).toContain(`class="svc-0">${BRIEF.services[0]}<`);
    expect(result.html).toContain(`class="svc-3">${BRIEF.services[0]}<`);
    expect(result.html).toContain(`class="svc-4">${BRIEF.services[1]}<`);
  });

  it("cycles differentiators for serviceItemBody the same way", () => {
    const html = `<section><p class="b0">orig 0</p><p class="b1">orig 1</p><p class="b2">orig 2</p><p class="b3">orig 3</p></section>`;
    const slots: SlotLocator[] = Array.from({ length: 4 }, (_, i) => ({
      kind: "serviceItemBody",
      selector: `.b${i}`,
      groupIndex: i,
      originalText: `orig ${i}`,
    }));
    const result = applyCopySlots(html, slots, { brief: BRIEF, rawBrief: "", role: "features" });
    expect(result.skipped).toBe(0);
    expect(result.html).toContain(`class="b0">${BRIEF.differentiators[0]}<`);
    expect(result.html).toContain(`class="b3">${BRIEF.differentiators[0]}<`);
  });
});

describe("applyCopySlots — narrative filler pass catches div/span-wrapped copy (C2)", () => {
  it("replaces leftover marketing prose sitting in a <div>, not only <p>/<blockquote>", () => {
    const html = `<section><div class="lead">Our creative team is passionate about delivering world class design solutions for every client we work with.</div></section>`;
    const result = applyCopySlots(html, [], { brief: BRIEF, rawBrief: "", role: "features" });
    expect(result.html).not.toContain("Our creative team is passionate");
    expect(result.filler).toBeGreaterThan(0);
    expect(result.changes.some((c) => c.kind === "filler:narrative")).toBe(true);
  });

  it("replaces the same shape of leftover prose in a <span>", () => {
    const html = `<section><span class="lead">This template was built to showcase a fictional design studio and its imaginary portfolio of client work.</span></section>`;
    const result = applyCopySlots(html, [], { brief: BRIEF, rawBrief: "", role: "story" });
    expect(result.html).not.toContain("fictional design studio");
  });

  it("still leaves a testimonial quote alone (denylisted role, unaffected by the broader tag match)", () => {
    const html = `<div class="quote">This team completely transformed our brand and we could not be happier with the results they delivered.</div>`;
    const result = applyCopySlots(html, [], { brief: BRIEF, rawBrief: "", role: "testimonials" });
    expect(result.html).toContain("completely transformed our brand");
    expect(result.filler).toBe(0);
  });
});

describe("applyCopySlots — selector-error accounting (C3)", () => {
  it("counts a selector that fails to resolve separately, in selectorErrors, while still counting it as skipped", () => {
    const html = `<section><h2>Fine</h2></section>`;
    const slots: SlotLocator[] = [
      { kind: "sectionHeading", selector: "h2[[[bad selector", originalText: "Fine Original Heading Text" },
    ];
    const result = applyCopySlots(html, slots, { brief: BRIEF, rawBrief: "", role: "hero" });
    expect(result.selectorErrors).toBe(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it("does not count a selector that simply matches nothing as a selectorError", () => {
    const html = `<section><h2>Fine</h2></section>`;
    const slots: SlotLocator[] = [
      { kind: "primaryCta", selector: ".does-not-exist", originalText: "Click here" },
    ];
    const result = applyCopySlots(html, slots, { brief: BRIEF, rawBrief: "", role: "hero" });
    expect(result.selectorErrors).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
