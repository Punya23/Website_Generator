import { describe, it, expect } from "vitest";
import {
  normalizeLayoutNode,
  repairLayoutCoverage,
  collectIds,
  sanitizeLayoutNode,
} from "../src/agents/layout-normalize.js";
import { LayoutNodeSchema } from "../src/types.js";

const IDS = ["home_headline", "home_feature_0", "home_feature_1", "home_cta"];

describe("layout normalizer", () => {
  it("converts embedded block objects to id strings", () => {
    const bad = {
      type: "Stack",
      children: [
        {
          type: "Section",
          fullBleed: true,
          children: [{ id: "home_headline", type: "headline", title: "Welcome" }],
        },
        {
          type: "Grid",
          children: [
            { id: "home_feature_0", type: "feature", title: "A" },
            { id: "home_feature_1", type: "feature", title: "B" },
          ],
        },
        { type: "Section", fullBleed: true, children: ["home_cta"] },
      ],
    };

    const normalized = normalizeLayoutNode(bad, IDS)!;
    expect(LayoutNodeSchema.parse(normalized)).toBeTruthy();
    expect(collectIds(normalized).sort()).toEqual(IDS.sort());
  });

  it("fixes lowercase layout type names", () => {
    const bad = {
      type: "stack",
      children: [{ type: "section", fullBleed: true, children: ["home_headline"] }],
    };
    const normalized = normalizeLayoutNode(bad, IDS)!;
    expect(normalized.type).toBe("Stack");
    expect((normalized.children[0] as { type: string }).type).toBe("Section");
  });

  it("throws when block ids are missing from layout", () => {
    const partial = {
      type: "Stack" as const,
      children: ["home_headline", "home_cta"],
    };
    expect(() => repairLayoutCoverage(partial, IDS)).toThrow(/missing block ids/i);
  });
});

describe("sanitizeLayoutNode", () => {
  it("fixes Bento with columns: 1 to valid schema", () => {
    const layout = sanitizeLayoutNode({
      type: "Bento",
      columns: 1,
      children: ["a", "b"],
    });
    expect(layout.type).toBe("Bento");
    expect(layout.columns).toBeGreaterThanOrEqual(2);
    expect(LayoutNodeSchema.parse(layout)).toBeTruthy();
  });

  it("converts single-child Grid to Stack", () => {
    const layout = sanitizeLayoutNode({
      type: "Grid",
      columns: 3,
      children: ["only"],
    });
    expect(layout.type).toBe("Stack");
    expect(LayoutNodeSchema.parse(layout)).toBeTruthy();
  });

  it("sanitizes nested Section > Row with invalid columns", () => {
    const layout = sanitizeLayoutNode({
      type: "Section",
      fullBleed: false,
      children: [
        {
          type: "Row",
          columns: 1,
          children: ["home_headline", "home_feature_0"],
        },
      ],
    });
    expect(LayoutNodeSchema.parse(layout)).toBeTruthy();
  });
});
