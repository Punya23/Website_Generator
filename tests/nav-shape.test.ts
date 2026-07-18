import { describe, it, expect } from "vitest";
import {
  isNavShape,
  navShapeStyle,
} from "../src/react-codegen/component-library/components/primitives/nav-shape.js";

describe("isNavShape", () => {
  it("accepts the four known shapes", () => {
    expect(isNavShape("full-width")).toBe(true);
    expect(isNavShape("floating-capsule")).toBe(true);
    expect(isNavShape("floating-panel")).toBe(true);
    expect(isNavShape("split-inline")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isNavShape("glass")).toBe(false);
    expect(isNavShape(undefined)).toBe(false);
  });
});

describe("navShapeStyle", () => {
  it("gives full-width a full-bleed border and no split", () => {
    const style = navShapeStyle("full-width");
    expect(style.split).toBe(false);
    expect(style.surfaceClass).toContain("border-b");
    expect(style.headerClass).toBe("");
  });

  it("gives floating-capsule a pill radius, inset header, and no split", () => {
    const style = navShapeStyle("floating-capsule");
    expect(style.split).toBe(false);
    expect(style.surfaceClass).toContain("rounded-full");
    expect(style.headerClass).not.toBe("");
  });

  it("gives floating-panel a soft, theme-driven radius surface", () => {
    const style = navShapeStyle("floating-panel");
    expect(style.split).toBe(false);
    expect(style.surfaceClass).toContain("rounded-[var(--radius-lg)]");
  });

  it("marks split-inline as split so logo and links render as two surfaces", () => {
    const style = navShapeStyle("split-inline");
    expect(style.split).toBe(true);
    expect(style.surfaceClass).toContain("rounded-full");
  });

  it("defaults to full-width when shape is undefined", () => {
    expect(navShapeStyle(undefined)).toEqual(navShapeStyle("full-width"));
  });

  it("produces four visually distinct surface treatments", () => {
    const shapes = ["full-width", "floating-capsule", "floating-panel", "split-inline"] as const;
    const surfaces = new Set(shapes.map((s) => navShapeStyle(s).surfaceClass));
    expect(surfaces.size).toBe(4);
  });

  it("floating shapes use the theme shadow token, not a hardcoded shadow-sm", () => {
    for (const shape of ["floating-capsule", "floating-panel", "split-inline"] as const) {
      expect(navShapeStyle(shape).surfaceClass).toContain("shadow-[var(--shadow)]");
      expect(navShapeStyle(shape).surfaceClass).not.toContain("shadow-sm");
    }
  });
});
