import { describe, it, expect } from "vitest";
import { themeCssVars } from "../src/react-codegen/assemble-project.js";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";

describe("structural design tokens (radius / shadow)", () => {
  it("defaults to today's radius/shadow values when unset", () => {
    const css = themeCssVars(GENERIC_THEME);
    expect(css).toContain("--radius: 0.75rem;");
    expect(css).toContain("--shadow: 0 4px 24px rgba(0, 0, 0, 0.06);");
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
    const dramatic = themeCssVars({ ...GENERIC_THEME, shadowDepth: "dramatic" });

    expect(flat).toContain("--shadow: none;");
    expect(dramatic).toContain("--shadow: 0 24px 64px rgba(0, 0, 0, 0.22);");
  });
});
