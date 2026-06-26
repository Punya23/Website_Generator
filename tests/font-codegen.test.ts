import { describe, it, expect } from "vitest";
import { generateFontLayout } from "../src/react-codegen/font-codegen.js";

describe("font-codegen", () => {
  it("emits valid Lato weights for next/font", () => {
    const layout = generateFontLayout({
      fontHeading: "Lato",
      fontBody: "Inter",
      sectionGapMode: "normal",
    } as Parameters<typeof generateFontLayout>[0]);

    expect(layout.imports).toContain("Lato");
    expect(layout.fontVars).toContain('weight: ["300", "400", "700", "900"]');
    expect(layout.fontVars).toContain('weight: ["400", "500", "600", "700"]');
  });

  it("falls back to 400/700 for unknown google fonts", () => {
    const layout = generateFontLayout({
      fontHeading: "Some Custom Font",
      fontBody: "Some Custom Font",
      sectionGapMode: "normal",
    } as Parameters<typeof generateFontLayout>[0]);

    expect(layout.fontVars).toContain('weight: ["400", "700"]');
  });
});
