import { afterAll, describe, expect, it } from "vitest";
import { closeQABrowser, runCodeQA } from "../src/qa/code-qa.js";

function pageWithSections(sections: string): string {
  return `<!doctype html><html><body>${sections}</body></html>`;
}

describe("runCodeQA — per-section structural checks", () => {
  afterAll(async () => {
    await closeQABrowser();
  });

  it("flags a section with no text and no media as EMPTY_SECTION, naming its sectionId", async () => {
    const html = pageWithSections(`
      <div data-tpl="tpl_x" data-role="features" data-section="sec_features">
        <div class="wrap"></div>
      </div>
    `);
    const qa = await runCodeQA(html, "home");
    const issue = qa.issues.find((i) => i.code === "EMPTY_SECTION");
    expect(issue).toBeDefined();
    expect(issue?.sectionId).toBe("sec_features");
    expect(qa.passed).toBe(false);
  });

  it("does not flag a section that has media but no text (an image-only gallery slot)", async () => {
    const html = pageWithSections(`
      <div data-tpl="tpl_x" data-role="gallery" data-section="sec_gallery">
        <img src="https://example.com/photo.jpg" alt="Photo" />
      </div>
    `);
    const qa = await runCodeQA(html, "home");
    expect(qa.issues.some((i) => i.code === "EMPTY_SECTION")).toBe(false);
  });

  it("flags a literal \"undefined\" leaking into a section's copy, naming its sectionId", async () => {
    const html = pageWithSections(`
      <div data-tpl="tpl_x" data-role="hero" data-section="sec_hero">
        <h1>Cedar &amp; Co</h1>
        <p>undefined</p>
      </div>
    `);
    const qa = await runCodeQA(html, "home");
    const issue = qa.issues.find((i) => i.code === "UNDEFINED_LEAK");
    expect(issue).toBeDefined();
    expect(issue?.sectionId).toBe("sec_hero");
  });

  it("flags a raw JSON envelope shipped as a section's copy, naming its sectionId", async () => {
    const html = pageWithSections(`
      <div data-tpl="tpl_x" data-role="hero" data-section="sec_hero">
        <h1>{"headline":"Cedar &amp; Co","body":"Fresh bread daily."}</h1>
      </div>
    `);
    const qa = await runCodeQA(html, "home");
    const issue = qa.issues.find((i) => i.code === "RAW_JSON_LEAK");
    expect(issue).toBeDefined();
    expect(issue?.sectionId).toBe("sec_hero");
  });

  it("does not false-positive on a clean, populated section", async () => {
    const html = pageWithSections(`
      <div data-tpl="tpl_x" data-role="hero" data-section="sec_hero">
        <h1>Cedar &amp; Co</h1>
        <p>Cedar &amp; Co bakes sourdough fresh every morning in Bristol.</p>
        <img src="https://example.com/photo.jpg" alt="Bakery" />
      </div>
    `);
    const qa = await runCodeQA(html, "home");
    expect(qa.issues.some((i) => ["EMPTY_SECTION", "UNDEFINED_LEAK", "RAW_JSON_LEAK", "TEMPLATE_FILLER_LEAK"].includes(i.code))).toBe(false);
  });
});
