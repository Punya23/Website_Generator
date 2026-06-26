import { describe, expect, it } from "vitest";
import { mapPool } from "../src/util/async-pool.js";

describe("mapPool", () => {
  it("preserves order with concurrency > 1", async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await mapPool(items, 3, async (n) => {
      await new Promise((r) => setTimeout(r, 5 - n));
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("returns empty for no items", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
