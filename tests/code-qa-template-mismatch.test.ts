import { afterAll, describe, expect, it } from "vitest";
import { closeQABrowser, runCodeQA } from "../src/qa/code-qa.js";

/** Sections from real templates put their content inside their own `.container`-shaped wrapper —
 *  `firstElementChild` inside `[data-tpl]` stands in for that here, same shape `compose.ts` emits
 *  (`<div data-tpl=... data-section=...><section>...real markup...</section></div>`). */
function section(templateId: string, sectionId: string, maxWidthPx: number, role = "features"): string {
  return `<div data-tpl="${templateId}" data-role="${role}" data-section="${sectionId}">
    <section style="max-width:${maxWidthPx}px;margin:0 auto;padding:40px;background:#eee">
      <h2>Heading for ${sectionId}</h2><p>${"Body copy that is long enough to fill space. ".repeat(3)}</p>
    </section>
  </div>`;
}

describe("runCodeQA — cross-template structural mismatch", () => {
  afterAll(async () => {
    await closeQABrowser();
  });

  it("flags two adjacent sections from different templates with visibly different content widths", async () => {
    const html = `<!doctype html><html><body>
      ${section("tpl_a", "sec_1", 940)}
      ${section("tpl_b", "sec_2", 1400)}
    </body></html>`;
    const qa = await runCodeQA(html, "home");
    const mismatch = qa.issues.find((i) => i.code === "CROSS_TEMPLATE_WIDTH_MISMATCH");
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe("hard");
    expect(qa.passed).toBe(false);
  });

  it("does not flag adjacent sections from the SAME template at different widths (that is just layout)", async () => {
    const html = `<!doctype html><html><body>
      ${section("tpl_a", "sec_1", 940)}
      ${section("tpl_a", "sec_2", 600)}
    </body></html>`;
    const qa = await runCodeQA(html, "home");
    expect(qa.issues.some((i) => i.code === "CROSS_TEMPLATE_WIDTH_MISMATCH")).toBe(false);
  });

  it("does not flag adjacent sections from different templates that render at compatible widths", async () => {
    const html = `<!doctype html><html><body>
      ${section("tpl_a", "sec_1", 1200)}
      ${section("tpl_b", "sec_2", 1230)}
    </body></html>`;
    const qa = await runCodeQA(html, "home");
    expect(qa.issues.some((i) => i.code === "CROSS_TEMPLATE_WIDTH_MISMATCH")).toBe(false);
  });

  it("never compares a nav/footer boundary — chrome intentionally always comes from one template", async () => {
    const html = `<!doctype html><html><body>
      ${section("tpl_a", "sec_1", 940)}
      ${section("tpl_b", "footer", 1600, "footer")}
    </body></html>`;
    const qa = await runCodeQA(html, "home");
    expect(qa.issues.some((i) => i.code === "CROSS_TEMPLATE_WIDTH_MISMATCH")).toBe(false);
  });

  it("still catches real overflow on verbatim [data-tpl] markup, which [data-block-id]-only checks miss entirely", async () => {
    const html = `<!doctype html><html><body>
      <div data-tpl="tpl_a" data-role="hero" data-section="sec_1" style="width:300px;overflow:hidden">
        <div style="width:2000px">way too wide content that must overflow its own container</div>
      </div>
    </body></html>`;
    const qa = await runCodeQA(html, "home");
    expect(qa.issues.some((i) => i.code === "HORIZONTAL_OVERFLOW")).toBe(true);
  });
});
