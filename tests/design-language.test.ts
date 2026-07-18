import { describe, it, expect } from "vitest";
import {
  bandFillClass,
  surfaceClass,
  panelClass,
  mediaOverlayClass,
  dividerClass,
  resolveSiteVisualContract,
  applyVisualContractToProps,
} from "../src/design/design-language.js";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

describe("design-language resolvers", () => {
  it("maps each bandFill to a distinct treatment", () => {
    const fills = ["plain", "subtle", "gradient", "mesh", "accent"] as const;
    const classes = new Set(fills.map((f) => bandFillClass(f)));
    expect(classes.size).toBe(5);
    expect(bandFillClass("mesh")).toContain("mesh-gradient");
    expect(bandFillClass("plain")).not.toContain("mesh-gradient");
  });

  it("maps panels without forcing glass", () => {
    expect(panelClass("bordered")).toContain("border");
    expect(panelClass("glass")).toContain("backdrop-blur");
    expect(panelClass("flat")).not.toContain("backdrop-blur");
  });

  it("media overlays are opt-in", () => {
    expect(mediaOverlayClass("none")).toBe("");
    expect(mediaOverlayClass("scrim-bottom")).toContain("gradient");
  });

  it("resolveSiteVisualContract prefers plain/bordered for clean fx", () => {
    const c = resolveSiteVisualContract({ ...GENERIC_THEME, accentRole: "sparing" }, "clean");
    expect(c.visualFx).toBe("clean");
    expect(c.defaultBandFill).toBe("plain");
  });

  it("applyVisualContractToProps only fills missing keys", () => {
    const contract = resolveSiteVisualContract(GENERIC_THEME, "editorial");
    const out = applyVisualContractToProps({ bandFill: "accent", headline: "Hi" }, contract);
    expect(out.bandFill).toBe("accent");
    expect(out.visualFx).toBe("editorial");
    expect(out.surface).toBeTruthy();
  });
});

describe("no forced mesh in immersive sections", () => {
  it("HeroVideo and PricingToggle do not hardcode mesh-gradient", () => {
    const immersive = readFileSync(
      join(root, "src/react-codegen/component-library/components/sections/immersive.tsx"),
      "utf8"
    );
    expect(immersive).not.toMatch(/className=\{?[`"'][^`"']*mesh-gradient/);
    expect(immersive).toContain("bandFillClass");
    expect(immersive).toContain("panelClass");
    expect(immersive).toContain("mediaOverlayClass");
  });
});

describe("surface / divider helpers", () => {
  it("surface and divider helpers return empty for none", () => {
    expect(surfaceClass("none")).toBe("");
    expect(dividerClass("none")).toBe("");
    expect(dividerClass("line")).toContain("border");
  });
});
