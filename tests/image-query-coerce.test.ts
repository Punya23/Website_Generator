import { describe, it, expect } from "vitest";
import {
  coerceImageQuery,
  HeroSpotlightPropsSchema,
} from "../src/section-templates/schemas.js";

describe("coerceImageQuery", () => {
  it("joins array keywords into one string", () => {
    expect(coerceImageQuery(["corporate office", "team meeting"])).toBe(
      "corporate office team meeting"
    );
  });

  it("passes through plain strings", () => {
    expect(coerceImageQuery("luxury spa interior")).toBe("luxury spa interior");
  });

  it("validates hero_spotlight when imageQuery was an array", () => {
    const parsed = HeroSpotlightPropsSchema.parse({
      headline: "Welcome",
      image: { imageQuery: ["professional", "corporate lobby"], alt: "Hero" },
    });
    expect(parsed.image.imageQuery).toBe("professional corporate lobby");
  });
});
