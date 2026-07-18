import { describe, it, expect } from "vitest";
import { themeCssVars } from "../src/react-codegen/assemble-project.js";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";

describe("structural design tokens (radius / shadow)", () => {
  it("defaults to today's radius/shadow values when unset", () => {
    const css = themeCssVars(GENERIC_THEME);
    expect(css).toContain("--radius: 0.75rem;");
    // Multi-layer soft shadow (premium depth stacks several low-opacity layers, not one flat blur).
    expect(css).toContain("--shadow: 0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 16px 32px -12px rgba(0,0,0,0.1);");
  });

  it("maps each radiusScale to a distinct value", () => {
    const sharp = themeCssVars({ ...GENERIC_THEME, radiusScale: "sharp" });
    const soft = themeCssVars({ ...GENERIC_THEME, radiusScale: "soft" });
    const pill = themeCssVars({ ...GENERIC_THEME, radiusScale: "pill" });

    expect(sharp).toContain("--radius: 0.25rem;");
    expect(soft).toContain("--radius: 0.5rem;");
    expect(pill).toContain("--radius: 9999px;");
  });

  it("maps each shadowDepth to a distinct value", () => {
    const flat = themeCssVars({ ...GENERIC_THEME, shadowDepth: "flat" });
    const soft = themeCssVars({ ...GENERIC_THEME, shadowDepth: "soft" });
    const elevated = themeCssVars({ ...GENERIC_THEME, shadowDepth: "elevated" });
    const dramatic = themeCssVars({ ...GENERIC_THEME, shadowDepth: "dramatic" });

    expect(flat).toContain("--shadow: none;");
    // Each non-flat depth is a distinct multi-layer stack.
    for (const css of [soft, elevated, dramatic]) {
      const match = css.match(/--shadow: (.+);/);
      expect(match).not.toBeNull();
      expect(match![1]!.split("),").length).toBeGreaterThanOrEqual(3);
    }
    expect(soft).not.toBe(elevated);
    expect(elevated).not.toBe(dramatic);
  });
});
