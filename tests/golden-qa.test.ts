import { describe, it, expect, afterAll } from "vitest";
import { renderSite } from "../src/renderer/render.js";
import { runCodeQA, closeQABrowser } from "../src/qa/code-qa.js";
import { annasKitchenFixture, salonFixture } from "./fixtures/site-context-fixtures.js";

describe("Fixture golden QA", () => {
  afterAll(async () => {
    await closeQABrowser();
  });

  for (const [name, fixtureFn] of [
    ["Anna's Kitchen", annasKitchenFixture],
    ["Lumière Salon", salonFixture],
  ] as const) {
    it(`${name} fixture renders and passes structural QA`, async () => {
      const ctx = fixtureFn();
      const page = ctx.pages.home!;
      const html = renderSite(
        ctx.businessName,
        ctx.expandedBrief.expandedBrief,
        ctx.designSystem,
        [
          {
            slug: "home",
            title: page.title,
            navLabel: page.navLabel,
            content: page.content!,
            layout: page.layout!,
          },
        ],
        ctx.sitePlan.motionStyle
      ).home!;

      expect(html).toContain(ctx.businessName);
      expect(html).toContain("data-block-id");
      expect(html).not.toMatch(/min-height:\s*var\(--card-min-height\)/);

      const qa = await runCodeQA(html, "home");
      const hard = qa.issues.filter((i) => i.severity === "hard");
      expect(hard, hard.map((i) => i.message).join("; ")).toEqual([]);
      expect(qa.passed).toBe(true);
    });
  }
});
