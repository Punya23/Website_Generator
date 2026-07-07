import { describe, it, expect } from "vitest";
import {
  cardGridClassForCount,
  defaultBentoSpan,
} from "../src/react-codegen/component-library/components/primitives/layout.js";

describe("cardGridClassForCount", () => {
  it("uses two columns for two items (not four)", () => {
    const cls = cardGridClassForCount(2, { bento: true });
    expect(cls).toContain("sm:grid-cols-2");
    expect(cls).not.toContain("xl:grid-cols-4");
  });

  it("uses three columns for three items", () => {
    const cls = cardGridClassForCount(3);
    expect(cls).toContain("lg:grid-cols-3");
  });

  it("assigns bento row min height", () => {
    expect(cardGridClassForCount(4, { bento: true })).toContain("minmax(220px");
  });
});

describe("defaultBentoSpan", () => {
  it("leaves two-item grids equal width", () => {
    expect(defaultBentoSpan(0, 2)).toBeUndefined();
    expect(defaultBentoSpan(1, 2)).toBeUndefined();
  });

  it("highlights first tile when three items", () => {
    expect(defaultBentoSpan(0, 3)).toBe("large");
  });
});
