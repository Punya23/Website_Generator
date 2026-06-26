import { describe, expect, it } from "vitest";
import { deriveAccentFromSeed, pickTypographyFromSeed } from "../src/design/seed-design.js";

describe("seed-design", () => {
  it("derives different accents for different seeds", () => {
    const base = "#ea580c";
    const a = deriveAccentFromSeed(1, base, "warm-consumer");
    const b = deriveAccentFromSeed(99, base, "warm-consumer");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("picks heading fonts from profile pool", () => {
    const fonts = pickTypographyFromSeed(7, "warm-consumer");
    expect(fonts.fontHeading).toBeTruthy();
    expect(fonts.fontBody).toBeTruthy();
    expect(fonts.fontHeading).not.toBe(pickTypographyFromSeed(8, "warm-consumer").fontHeading);
  });
});
