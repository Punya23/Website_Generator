import { describe, it, expect } from "vitest";
import { buildArchetypeLayout } from "../src/components/archetypes.js";
import type { ContentBlock } from "../src/types.js";

describe("Section archetypes", () => {
  it("builds pricing table grid", () => {
    const blocks: ContentBlock[] = [
      { id: "p1", type: "pricing", title: "Basic", price: "$9" },
      { id: "p2", type: "pricing", title: "Pro", price: "$29" },
    ];
    const layout = buildArchetypeLayout("pricing_table", blocks);
    expect(layout.type).toBe("Section");
    const grid = layout.children[0];
    expect(grid && typeof grid !== "string" && grid.type).toBe("Grid");
  });

  it("builds bento layout", () => {
    const blocks: ContentBlock[] = [
      { id: "b1", type: "bento", title: "A", span: "wide" },
      { id: "b2", type: "bento", title: "B" },
    ];
    const layout = buildArchetypeLayout("bento_grid", blocks);
    const bento = layout.children[0];
    expect(bento && typeof bento !== "string" && bento.type).toBe("Bento");
  });
});
