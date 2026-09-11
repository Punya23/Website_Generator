import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { renderSite } from "../src/renderer/render.js";
import { normalizeContentBlocks } from "../src/agents/content-normalize.js";
import { assemblePageFromSections } from "../src/site-context/assemble.js";
import type { PageSection, SiteContext } from "../src/types.js";

/** The real `SiteContext` this regression was written against, captured verbatim from generation
 *  run `clearsmile-dental/1782221940511` and committed under `tests/fixtures/`. It used to be read
 *  straight out of `output/_debug/`, which made the test pass only on the machine that happened to
 *  have produced that run: `output/` is gitignored, so a fresh clone, a git worktree, or CI hit
 *  `ENOENT ... site-context.json` and failed for a reason that had nothing to do with the bug being
 *  pinned. Kept as untouched real agent output rather than hand-written blocks — the raw-JSON leak
 *  below only ever showed up in genuinely messy generated content. */
function loadClearSmileContext(): SiteContext {
  // `import.meta.url`, not `process.cwd()`: the fixture sits next to this test, so resolving it
  // relative to the file keeps it found no matter which directory vitest was invoked from.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixture = path.join(here, "fixtures", "clearsmile-site-context.json");
  const raw = fs.readFileSync(fixture, "utf8");
  return JSON.parse(raw) as SiteContext;
}

describe("ClearSmile Dental regression", () => {
  it("renders services and contact without raw JSON after normalization", () => {
    const ctx = loadClearSmileContext();

    const pages = ["services", "contact"].map((slug) => {
      const page = ctx.pages[slug as keyof typeof ctx.pages];
      if (!page || !("sections" in page)) throw new Error(`Missing page ${slug}`);

      const sections: PageSection[] = page.sections.map((section) => ({
        ...section,
        blocks: normalizeContentBlocks(section.blocks, section.id),
      }));

      const { content, layout } = assemblePageFromSections(sections);
      return {
        slug,
        title: page.title,
        navLabel: page.navLabel,
        content,
        layout,
      };
    });

    const htmlBySlug = renderSite(
      ctx.businessName,
      ctx.expandedBrief.expandedBrief,
      ctx.designSystem,
      pages
    );

    const servicesHtml = htmlBySlug.services!;
    const contactHtml = htmlBySlug.contact!;

    expect(servicesHtml).toContain("<ul class=\"feature-list\">");
    expect(servicesHtml).toContain("Routine cleanings and exams");
    expect(servicesHtml).not.toMatch(/\{"id":\s*"[^"]+",\s*"type":/);

    expect(contactHtml).toContain("<form");
    expect(contactHtml).toContain('type="email"');
    expect(contactHtml).toContain("Submit");
    expect(contactHtml).not.toMatch(/\{"id":\s*"[^"]+",\s*"type":/);
  });
});
