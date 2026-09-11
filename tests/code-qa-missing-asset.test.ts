/**
 * Phase 4 (docs/PLACEMENTS_ORCHESTRATION_PLAN.md, "post-fill QA"): a missing local stylesheet or
 * CSS `background-image` had NO detection before this — `BROKEN_IMAGE` only looks at `<img>`
 * elements via `naturalWidth`, which a `<link rel="stylesheet">` or a CSS background isn't. Needs a
 * real staged file (`pageUrl`), not `setContent`, to exercise at all — a bare `about:blank` document
 * never issues the network requests this check listens for.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { closeQABrowser, runCodeQA } from "../src/qa/code-qa.js";

const dirs: string[] = [];

async function stage(html: string, files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-qa-missing-asset-"));
  dirs.push(dir);
  await fs.writeFile(path.join(dir, "index.html"), html, "utf8");
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return pathToFileURL(path.join(dir, "index.html")).href;
}

describe("runCodeQA — MISSING_ASSET", () => {
  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  afterAll(async () => {
    await closeQABrowser();
  });

  it("flags a stylesheet link that points at a file which was never copied", async () => {
    const pageUrl = await stage(`<!doctype html><html><head>
      <link rel="stylesheet" href="assets/css/style.css">
    </head><body><h1>Cedar &amp; Co</h1></body></html>`);
    const qa = await runCodeQA("", "home", { pageUrl });
    const issue = qa.issues.find((i) => i.code === "MISSING_ASSET");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("hard");
    expect(issue?.message).toContain("style.css");
    expect(qa.passed).toBe(false);
  });

  it("does not flag a stylesheet that actually exists at the staged path", async () => {
    const pageUrl = await stage(
      `<!doctype html><html><head><link rel="stylesheet" href="assets/css/style.css"></head><body><h1>Cedar &amp; Co</h1></body></html>`,
      { "assets/css/style.css": "body { margin: 0; }" }
    );
    const qa = await runCodeQA("", "home", { pageUrl });
    expect(qa.issues.some((i) => i.code === "MISSING_ASSET")).toBe(false);
  });

  it("flags a missing CSS background-image — the case BROKEN_IMAGE cannot see (no <img> element exists)", async () => {
    const pageUrl = await stage(`<!doctype html><html><head>
      <style>.hero { background-image: url('assets/img/hero.jpg'); height: 400px; }</style>
    </head><body><div class="hero"></div></body></html>`);
    const qa = await runCodeQA("", "home", { pageUrl });
    const issue = qa.issues.find((i) => i.code === "MISSING_ASSET");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("hero.jpg");
    expect(qa.issues.some((i) => i.code === "BROKEN_IMAGE")).toBe(false);
  });

  it("de-dupes a background-image reused across several sections into one issue, not one per use", async () => {
    const pageUrl = await stage(`<!doctype html><html><head>
      <style>.a, .b, .c { background-image: url('assets/img/missing.jpg'); height: 100px; }</style>
    </head><body><div class="a"></div><div class="b"></div><div class="c"></div></body></html>`);
    const qa = await runCodeQA("", "home", { pageUrl });
    expect(qa.issues.filter((i) => i.code === "MISSING_ASSET")).toHaveLength(1);
  });

  it("is not checked at all without a pageUrl — setContent has no base URL to resolve against", async () => {
    const qa = await runCodeQA(
      `<!doctype html><html><head><link rel="stylesheet" href="assets/css/style.css"></head><body><h1>x</h1></body></html>`,
      "home"
    );
    expect(qa.issues.some((i) => i.code === "MISSING_ASSET")).toBe(false);
  });
});
