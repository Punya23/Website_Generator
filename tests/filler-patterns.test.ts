import { describe, expect, it } from "vitest";
import { scanHtmlForFillerLeaks } from "../src/templates/filler-patterns.js";

describe("scanHtmlForFillerLeaks", () => {
  it("flags leftover lorem ipsum text", () => {
    const html = `<section><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p></section>`;
    const leaks = scanHtmlForFillerLeaks(html);
    expect(leaks.some((l) => l.code === "lorem")).toBe(true);
  });

  it("flags lorem-shaped Latin filler even without the words lorem/ipsum", () => {
    const html = `<section><p>Donec quam felis ultricies nec pellentesque vulputate.</p></section>`;
    const leaks = scanHtmlForFillerLeaks(html);
    expect(leaks.some((l) => l.code === "lorem")).toBe(true);
  });

  it("flags the template author's own copyright credit", () => {
    const html = `<footer><span>© 2026 Mediplace By Scriptfusions</span></footer>`;
    const leaks = scanHtmlForFillerLeaks(html);
    expect(leaks.some((l) => l.code === "copyright")).toBe(true);
  });

  it("does not flag the site's own correctly-substituted copyright credit", () => {
    // Confirmed live: `neutralizeTemplateFiller` always rewrites the footer copyright to
    // "© <businessName>. All rights reserved." — text that still matches COPYRIGHT_RE (it still
    // has a ©), so every real generation's own CORRECT footer permanently read as a "leak" until
    // `businessName` was threaded through so this check can tell the two apart.
    const html = `<footer><span>© Cedar &amp; Co. All rights reserved.</span></footer>`;
    expect(scanHtmlForFillerLeaks(html, "Cedar & Co")).toEqual([]);
  });

  it("still flags a leaked copyright even when a business name is supplied but doesn't match", () => {
    const html = `<footer><span>© 2026 Mediplace By Scriptfusions</span></footer>`;
    const leaks = scanHtmlForFillerLeaks(html, "Cedar & Co");
    expect(leaks.some((l) => l.code === "copyright")).toBe(true);
  });

  it("flags a self-referential heading in the template author's own voice", () => {
    const html = `<section><h2>We're a Creative Agency</h2></section>`;
    const leaks = scanHtmlForFillerLeaks(html);
    expect(leaks.some((l) => l.code === "selfReferentialHeading")).toBe(true);
  });

  it("flags a leaked street address, comma-and-unit-prefix shapes included", () => {
    const html = `<div class="topbar">E44, Design Street, Web Corner Melbourne.</div>`;
    const leaks = scanHtmlForFillerLeaks(html);
    expect(leaks.some((l) => l.code === "streetAddress")).toBe(true);
  });

  it("flags lorem sitting directly in a container that also has a real nested list", () => {
    // Confirmed live: a real footer widget shipped `<div class="textwidget">Lorem ipsum dolor sit
    // amet, consectetur adipiscing elit.<ul><li>real list item</li></ul></div>` on every page of
    // every generation — isTextLeaf disqualifies the whole div (its child is a block-level <ul>,
    // not an inline tag), so the div's OWN direct "Lorem ipsum..." text was invisible to every
    // check that requires a leaf.
    const html = `<div class="textwidget">Lorem ipsum dolor sit amet, consectetur adipiscing elit.<ul><li>Real service item</li></ul></div>`;
    const leaks = scanHtmlForFillerLeaks(html);
    expect(leaks.some((l) => l.code === "lorem")).toBe(true);
  });

  it("does not flag clean, business-specific copy", () => {
    const html = `<section><h2>Our Services</h2><p>Cedar &amp; Co bakes sourdough fresh every morning in Bristol.</p></section>`;
    expect(scanHtmlForFillerLeaks(html)).toEqual([]);
  });

  it("does not flag a short structural label heading", () => {
    const html = `<section><h3>FAQ</h3><h3>Working Hours</h3></section>`;
    expect(scanHtmlForFillerLeaks(html)).toEqual([]);
  });
});
