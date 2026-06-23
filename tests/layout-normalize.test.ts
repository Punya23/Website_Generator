import { describe, it, expect } from "vitest";
import {
  normalizeLayoutNode,
  repairLayoutCoverage,
  collectIds,
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

  it("repairs missing block ids by appending to stack", () => {
    const partial = {
      type: "Stack" as const,
      children: ["home_headline", "home_cta"],
    };
    const repaired = repairLayoutCoverage(partial, IDS);
    expect(collectIds(repaired).sort()).toEqual(IDS.sort());
  });
});
