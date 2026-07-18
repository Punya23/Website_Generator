import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const premium = readFileSync(
  join(root, "src/react-codegen/component-library/components/sections/premium.tsx"),
  "utf8"
);
const index = readFileSync(
  join(root, "src/react-codegen/component-library/components/sections/index.tsx"),
  "utf8"
);
const immersive = readFileSync(
  join(root, "src/react-codegen/component-library/components/sections/immersive.tsx"),
  "utf8"
);

describe("section layout variants", () => {
  it("HeroSpotlight branches on layoutVariant", () => {
    expect(premium).toContain('variant === "centered-stack"');
    expect(premium).toContain("SplitHeroLayout");
    expect(premium).toContain("mediaPosition");
  });

  it("CtaBand uses distinct alignment per variant", () => {
    expect(index).toContain('variant === "band-wide"');
    expect(index).toContain("text-left");
    expect(index).toContain("text-center");
  });

  it("FooterCta band-wide keeps CTAs inside Reveal", () => {
    const footerStart = index.indexOf("export function FooterCta");
    const footerEnd = index.indexOf("export function TeamGrid", footerStart);
    const footer = index.slice(footerStart, footerEnd);
    expect(footer).toContain("flex flex-col items-start justify-between");
    expect(footer).toContain("<Reveal>");
    expect(footer).toMatch(/<Reveal>[\s\S]*props\.cta\.label/);
  });

  it("PricingToggle aligns headline and toggle", () => {
    expect(immersive).toContain("headerAlign");
    expect(immersive).toContain("toggleAlign");
  });
});
