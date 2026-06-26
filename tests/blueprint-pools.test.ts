import { describe, it, expect } from "vitest";
import { pickBlueprintFromPool } from "../src/design/blueprint-pools.js";
import type { PagePlan } from "../src/types.js";

const brief = {
  businessName: "Luxe Salon",
  tagline: "Refined beauty",
  elevatorPitch: "Premium salon",
  expandedBrief: "Luxury salon and spa",
  targetAudience: "Professionals",
  services: ["Cut", "Color"],
  differentiators: ["Craft"],
  tone: "refined",
  primaryCta: "Book",
};

const homePage: PagePlan = {
  slug: "home",
  title: "Home",
  navLabel: "Home",
  goal: "Convert visitors",
  minBlocks: 12,
  layoutHint: "Immersive hero",
  contentFocus: ["hero"],
};

describe("blueprint pools", () => {
  it("picks different home sequences for different seeds", () => {
    const a = pickBlueprintFromPool(homePage, brief, "luxury-dark", 1001);
    const b = pickBlueprintFromPool(homePage, brief, "luxury-dark", 2002);
    const idsA = a.sections.map((s) => s.templateId).join(",");
    const idsB = b.sections.map((s) => s.templateId).join(",");
    expect(idsA).not.toBe(idsB);
  });

  it("clinical-light home avoids luxury-only templates in pool", () => {
    const bp = pickBlueprintFromPool(homePage, brief, "clinical-light", 42);
    const hero = bp.sections[0]?.templateId;
    expect(["hero_split_cinematic", "hero_editorial"]).toContain(hero);
  });

  it("is deterministic for same seed", () => {
    const a = pickBlueprintFromPool(homePage, brief, "editorial-light", 999);
    const b = pickBlueprintFromPool(homePage, brief, "editorial-light", 999);
    expect(a.sections.map((s) => s.templateId)).toEqual(b.sections.map((s) => s.templateId));
  });
});
