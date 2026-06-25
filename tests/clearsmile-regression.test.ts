import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { renderSite } from "../src/renderer/render.js";
import { normalizeContentBlocks } from "../src/agents/content-normalize.js";
import { assemblePageFromSections } from "../src/site-context/assemble.js";
import type { PageSection, SiteContext } from "../src/types.js";

function loadClearSmileContext(): SiteContext {
  const debugDir = path.join(
    process.cwd(),
    "output/_debug/clearsmile-dental/1782221940511/site-context.json"
  );
  const raw = fs.readFileSync(debugDir, "utf8");
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
