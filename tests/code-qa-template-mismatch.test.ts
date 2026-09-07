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
    // Genuinely too-wide content, not clipped by any ancestor's own overflow:hidden — the realistic
    // shape of a real layout bug (a too-wide row/grid actually pushes the page's own scrollWidth
    // past the viewport, the thing a real visitor would see as a horizontal scrollbar). A version of
    // this fixture that clips the overflow at the section's own box (via `overflow:hidden` on
    // `[data-tpl]` itself) is indistinguishable, from the PAGE's perspective, from an off-canvas menu
    // or a hidden dropdown — see the "off-canvas menu" test below and the code's own comment for why
    // page-level scrollWidth, not a per-element check, is what HORIZONTAL_OVERFLOW gates on now.
    const html = `<!doctype html><html><body style="margin:0">
      <div data-tpl="tpl_a" data-role="hero" data-section="sec_1" style="width:300px">
        <div style="width:2000px">way too wide content that must overflow its own container</div>
      </div>
    </body></html>`;
    const qa = await runCodeQA(html, "home");
    expect(qa.issues.some((i) => i.code === "HORIZONTAL_OVERFLOW")).toBe(true);
  });

  it("does not flag an off-canvas menu translated outside the viewport as overflow", async () => {
    // Confirmed live: a real generation's off-canvas hamburger-menu panel inflated its ancestor
    // [data-tpl] wrapper's raw scrollWidth (1600 vs clientWidth 1280) purely because the panel is
    // translated off-screen — CSS transform is paint-only, so a translated child still contributes
    // to its ancestor's normal-flow scrollable area even though nobody can see it in this state.
    // The ancestor itself never moves (`position:absolute` would escape the flow entirely and not
    // reproduce this — the real bug is specifically a normal-flow child moved via `transform`).
    const html = `<!doctype html><html><body style="overflow-x:hidden;width:1280px;margin:0">
      <div data-tpl="tpl_a" data-role="nav" data-section="sec_nav" style="width:1280px;overflow:hidden">
        <nav style="width:1280px;overflow:hidden;display:block">
          <ul style="width:320px;transform:translateX(1280px);white-space:nowrap;display:block">
            <li style="display:inline-block;width:200px">Home</li>
            <li style="display:inline-block;width:200px">About</li>
            <li style="display:inline-block;width:200px">Services</li>
            <li style="display:inline-block;width:200px">Contact</li>
          </ul>
        </nav>
      </div>
    </body></html>`;
    const qa = await runCodeQA(html, "home");
    expect(qa.issues.some((i) => i.code === "HORIZONTAL_OVERFLOW")).toBe(false);
  });
});
