import { afterAll, describe, expect, it } from "vitest";
import { closeQABrowser, runCodeQA } from "../src/qa/code-qa.js";

describe("runCodeQA — TEMPLATE_FILLER_LEAK", () => {
  afterAll(async () => {
    await closeQABrowser();
  });

  it("fails hard QA when leftover lorem ipsum text ships in the final HTML", async () => {
    const html = `<!doctype html><html><body>
      <section><h1>Cedar &amp; Co</h1><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p></section>
    </body></html>`;
    const qa = await runCodeQA(html, "home");
    const leak = qa.issues.find((i) => i.code === "TEMPLATE_FILLER_LEAK");
    expect(leak).toBeDefined();
    expect(leak?.severity).toBe("hard");
    expect(qa.passed).toBe(false);
  });

  it("fails hard QA when the template author's own street address ships in the final HTML", async () => {
    const html = `<!doctype html><html><body>
      <footer><div class="addr">E44, Design Street, Web Corner Melbourne.</div></footer>
    </body></html>`;
    const qa = await runCodeQA(html, "home");
    expect(qa.issues.some((i) => i.code === "TEMPLATE_FILLER_LEAK")).toBe(true);
  });

  it("does not false-positive on clean, business-specific HTML", async () => {
    const html = `<!doctype html><html><body>
      <section><h1>Cedar &amp; Co</h1><p>Cedar &amp; Co bakes sourdough fresh every morning in Bristol.</p></section>
    </body></html>`;
    const qa = await runCodeQA(html, "home");
    expect(qa.issues.some((i) => i.code === "TEMPLATE_FILLER_LEAK")).toBe(false);
  });
});
