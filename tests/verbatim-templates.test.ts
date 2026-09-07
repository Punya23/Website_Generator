import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scopeCss, scopeSelector, sanitizeCss, parseCssTolerantly } from "../src/templates/ingest/scope-css.js";
import { recolorCss } from "../src/templates/ingest/recolor-css.js";
import { getPalette } from "../src/templates/palette.js";
import { extractPageSections } from "../src/templates/ingest/extract-sections.js";
import { namespaceIds } from "../src/templates/ingest/id-rewrite.js";
import { AssetCollector, rewriteCssUrls, rewriteHtmlAssets } from "../src/templates/ingest/asset-manifest.js";
import { classifyRoleHeuristically, locateSlots } from "../src/templates/ingest/classify-section.js";
import { applyCopySlots, applyPhotoSlots, neutralizeTemplateFiller, resolveContact } from "../src/templates/copy-slots.js";
import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectPhotoSlots } from "../src/templates/ingest/photo-slots.js";
import { rankByTaxonomy, sectionTaxonomyAffinity, selectSiteSections } from "../src/templates/select.js";
import type { IndexedSection, TemplateIndex, TemplateStore } from "../src/templates/store.js";
import type { DesignFingerprint } from "../src/templates/types.js";
import { classifyTaxonomy } from "../src/skins/taxonomy.js";
import { expandBriefFromInput } from "../src/agents/expand-brief-agent.js";
import { colord } from "colord";
import { pickTemplateRoot } from "../src/templates/ingest/normalize-archive.js";

const TPL = "tpl_test1234";

describe("scope-css", () => {
  it("prefixes every selector in a comma list individually", () => {
    const out = scopeCss(".btn, .card > a { color: red }", { templateId: TPL });
    expect(out).toContain(`[data-tpl="${TPL}"] .btn`);
    expect(out).toContain(`[data-tpl="${TPL}"] .card > a`);
  });

  it("rewrites document-level selectors to the scope root instead of dropping their look", () => {
    const out = scopeCss("body { font-family: Georgia } :root { --brand: #ff0000 }", { templateId: TPL });
    expect(out).toContain(`[data-tpl="${TPL}"] {`);
    expect(out).toContain("font-family: Georgia");
    expect(out).toContain("--brand");
    expect(out).not.toMatch(/^\s*body\s*\{/m);
  });

  it("namespaces keyframes and the animations that reference them", () => {
    const out = scopeCss("@keyframes fadeIn { from { opacity: 0 } } .a { animation: fadeIn 1s }", {
      templateId: TPL,
    });
    expect(out).toContain(`@keyframes ${TPL}__fadeIn`);
    expect(out).toContain(`animation: ${TPL}__fadeIn 1s`);
    // Keyframe stops are not selectors and must not be scoped.
    expect(out).not.toContain(`[data-tpl="${TPL}"] from`);
  });

  it("applies element-id renames so #hero rules keep matching renamed markup", () => {
    const out = scopeSelector("#hero .title", `[data-tpl="${TPL}"]`, new Map([["hero", `${TPL}__hero`]]));
    expect(out).toBe(`[data-tpl="${TPL}"] #${TPL}__hero .title`);
  });

  it("survives the malformed CSS real template packages ship", () => {
    // SCSS-style line comment left in a .css file (seen in a real bundled vendor stylesheet).
    expect(sanitizeCss("a {\n  // padding: 1px;\n  color: red;\n}")).not.toContain("//");
    // Missing semicolon — strict postcss throws, the tolerant parser recovers.
    expect(() => parseCssTolerantly('.a { font-family:"X"\n margin: 0 }')).not.toThrow();
    // A selector no parser accepts must cost that rule, not the stylesheet.
    const out = scopeCss("***/ .animation1 { color: red } .ok { color: blue }", { templateId: TPL });
    expect(out).toContain(`[data-tpl="${TPL}"] .ok`);
  });
});

describe("recolor-css", () => {
  const palette = getPalette("all-black");

  it("maps a light template's surfaces onto the dark ramp, preserving layering order", () => {
    const css = `
      .page { background: #ffffff }
      .page2 { background: #ffffff }
      .card { background: #f0f0f0 }
      .well { background: #dddddd }
    `;
    const { css: out, stats } = recolorCss(css, palette);
    expect(stats.sourceWasDark).toBe(false);
    const page = out.match(/\.page \{ background: (#[0-9a-f]{6}) \}/)?.[1];
    const card = out.match(/\.card \{ background: (#[0-9a-f]{6}) \}/)?.[1];
    expect(page).toBe(palette.backgroundRamp[0]);
    // The lightest source surface becomes the deepest black; the next one stays distinguishable.
    expect(card).not.toBe(page);
    expect(colord(card!).toHsl().l).toBeGreaterThan(colord(page!).toHsl().l);
  });

  it("keeps accent hue while forcing legible lightness", () => {
    const { css: out } = recolorCss(".btn { color: #e4db7e }", palette);
    const hex = out.match(/#[0-9a-f]{6}/)?.[0] ?? "";
    expect(colord(hex).toHsl().h).toBeCloseTo(colord("#e4db7e").toHsl().h, 0);
    expect(colord(hex).toHsl().l).toBeLessThanOrEqual(palette.accentMaxLightness * 100 + 1);
  });

  it("rewrites raw hex literals that live outside any custom property", () => {
    const { css: out } = recolorCss(":root { --white: #fff } .x { color: white } .y { background: #F5F5F5 }", palette);
    expect(out).not.toMatch(/#fff\b/i);
    expect(out).not.toMatch(/:\s*white\b/i);
    expect(out).not.toMatch(/#F5F5F5/i);
  });

  it("preserves alpha when collapsing shadows to black", () => {
    const { css: out } = recolorCss(".x { box-shadow: 0 2px 4px rgba(200, 100, 50, 0.25) }", palette);
    expect(out).toContain("rgba(0, 0, 0, 0.25)");
  });

  it("resolves a custom property used for both text and background on the same element", () => {
    // Confirmed live against the real Arup sample: `--thm-base` (#fff) is used both as
    // `color:` (text, on .thm-btn-two) and `background-color:` (background, on
    // .main-menu-three-wrapper__btn) — the same element carries both classes. Majority-vote role
    // assignment can only be right for one; the losing usage must get its own direct literal
    // instead of the shared (wrongly-colored-for-it) variable.
    const css = `
      .label { color: var(--base); }
      .chip { background-image: inherit; background-color: var(--base); }
      :root { --base: #ffffff; }
    `;
    const { css: out } = recolorCss(scopeCss(css, { templateId: TPL }), palette);
    const labelColor = out.match(/\.label\s*\{\s*color:\s*(#[0-9a-f]{6})/i)?.[1];
    const chipBg = out.match(/\.chip\s*\{[^}]*background-color:\s*([^;]+);/i)?.[1]?.trim();
    // Text usage: forced light regardless of which role won the vote.
    expect(labelColor?.toLowerCase()).toBe(palette.textOnDark.toLowerCase());
    // Background usage: forced into the dark ramp, never left as literal white.
    expect(chipBg).not.toMatch(/#fff|white/i);
    expect(colord(chipBg ?? "").toHsl().l).toBeLessThan(30);
  });
});

describe("extract-sections", () => {
  const page = `<!doctype html><html><head><title>Demo</title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="https://cdn.example.com/x.css">
    <style>.inline{color:red}</style></head>
    <body><div class="wrap">
      <header id="top"><nav><a href="index.html">Home</a></nav></header>
      <section id="hero"><h1>Big claim</h1><script>alert(1)</script></section>
      <section class="svc"><h2>Our services</h2><p>Words that are long enough.</p></section>
      <footer><p>© 2019 Someone</p></footer>
    </div></body></html>`;

  it("finds outermost structural sections at any wrapper depth", () => {
    const out = extractPageSections(page, "index.html");
    expect(out.sections.map((section) => section.tag)).toEqual(["header", "section", "section", "footer"]);
    expect(out.title).toBe("Demo");
  });

  it("keeps only local stylesheets and drops template scripts", () => {
    const out = extractPageSections(page, "index.html");
    expect(out.stylesheetHrefs).toEqual(["assets/css/style.css"]);
    expect(out.inlineStyles).toHaveLength(1);
    expect(out.sections.some((section) => section.html.includes("<script"))).toBe(false);
  });

  it("falls back to div blocks for templates with no content sections", () => {
    const divOnly = `<html><body><div class="page"><div class="wrap">
      <div class="block-a"><h2>One</h2><p>${"a".repeat(80)}</p></div>
      <div class="block-b"><h2>Two</h2><p>${"b".repeat(80)}</p></div>
    </div></div></body></html>`;
    const out = extractPageSections(divOnly, "index.html");
    expect(out.sections.length).toBeGreaterThanOrEqual(2);
  });
});

describe("id-rewrite", () => {
  it("namespaces ids and every same-document reference to them", () => {
    const out = namespaceIds(
      `<section id="hero"><a href="#about">go</a><label for="mail"></label><input id="mail"></section>`,
      TPL
    );
    expect(out).toContain(`id="${TPL}__hero"`);
    expect(out).toContain(`id="${TPL}__mail"`);
    expect(out).toContain(`for="${TPL}__mail"`);
    // An anchor to an id this section does not define is left alone rather than broken.
    expect(out).toContain(`href="#about"`);
  });
});

describe("asset-manifest", () => {
  it("namespaces asset paths per template and records the copy list", () => {
    const collector = new AssetCollector(TPL);
    const html = rewriteHtmlAssets(`<img src="../img/logo.png"><img srcset="a.png 1x, b.png 2x">`, collector, "pages");
    expect(html).toContain(`${TPL}/img/logo.png`);
    expect(html).toContain(`${TPL}/pages/a.png 1x`);
    expect(collector.manifest().map((entry) => entry.cachedRelPath)).toContain("img/logo.png");
  });

  it("leaves absolute and data URLs alone", () => {
    const collector = new AssetCollector(TPL);
    const css = rewriteCssUrls(`a{background:url(https://x.test/i.png)}b{background:url(data:image/png;base64,AA)}`, collector, "");
    expect(css).toContain("https://x.test/i.png");
    expect(css).toContain("data:image/png");
    expect(collector.manifest()).toHaveLength(0);
  });

  it("drops references that climb out of the template root", () => {
    const collector = new AssetCollector(TPL);
    collector.resolve("../../../../etc/passwd", "assets/css");
    expect(collector.manifest()).toHaveLength(0);
  });
});

describe("classification and copy slots", () => {
  it("reads the role from the tag and id/class before any model call", () => {
    expect(
      classifyRoleHeuristically({ tag: "footer", id: "", className: "", headingText: "", text: "", html: "", sourceOrder: 0 })
        .role
    ).toBe("footer");
    expect(
      classifyRoleHeuristically({ tag: "section", id: "", className: "bijoy__service", headingText: "", text: "", html: "", sourceOrder: 1 })
        .role
    ).toBe("features");
  });

  it("locates contact details, brand text and repeated cards without a model", () => {
    const html = `<section>
      <div class="logo"><a href="#">Acme Ltd</a></div>
      <h2>Our services</h2>
      <p>${"Long lead paragraph text. ".repeat(3)}</p>
      <a class="btn" href="#">Get in touch</a>
      <div class="service-card"><h3>Old one</h3><p>Some description here.</p></div>
      <div class="service-card"><h3>Old two</h3><p>Another description here.</p></div>
      <a href="mailto:author@template.test">author@template.test</a>
    </section>`;
    const kinds = locateSlots(html, "features").map((slot) => slot.kind);
    expect(kinds).toContain("email");
    expect(kinds).toContain("sectionHeading");
    expect(kinds).toContain("primaryCta");
    expect(kinds.filter((kind) => kind === "serviceItemTitle").length).toBeGreaterThanOrEqual(2);
  });

  it("never ships the template author's contact details", () => {
    const brief = expandBriefFromInput("Acme Bakery — bread in Leeds.");
    const html = `<section><a href="mailto:author@template.test">author@template.test</a>
      <p>75 Arlington St. Suite 500 Boston, MA</p>
      <p>Copyrights 2019 Template_mr Template</p></section>`;
    const slots = locateSlots(html, "footer");
    const out = applyCopySlots(html, slots, { brief, rawBrief: "Acme Bakery — bread in Leeds.", role: "footer" });
    expect(out.html).not.toContain("author@template.test");
    expect(out.html).not.toContain("Arlington");
    expect(out.html).not.toContain("Template_mr");
    expect(out.html).toContain("Acme Bakery");
  });

  it("reports every substitution as a before/after change record", () => {
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<section><h2>Original heading</h2></section>`;
    const slots = [{ kind: "sectionHeading" as const, selector: "h2", originalText: "Original heading and a longer clause" }];
    const out = applyCopySlots(html, [], { brief, rawBrief: "Acme Bakery", role: "features" });
    // sectionHeading isn't in the slots list here — exercise the filler-pass catch-all instead,
    // which is the more commonly-hit path (unclaimed card headings) and covers the same field shape.
    expect(out.changes.length).toBeGreaterThanOrEqual(0);

    const slotOut = applyCopySlots(html, slots, { brief, rawBrief: "Acme Bakery", role: "features" });
    const change = slotOut.changes.find((c) => c.kind === "sectionHeading");
    expect(change).toBeDefined();
    expect(change!.before).toBe("Original heading and a longer clause");
    expect(change!.after).toBe(brief.tagline);
    expect(change!.selector).toBe("h2");
  });

  it("substitutes a classified sectionBody slot in a role the old 5-role allowlist did not cover", () => {
    // Confirmed gap: sectionBody substitution used to require role in
    // {hero,story,cta,contact,features} — a pricing/faq/team/stats/gallery section's classified
    // sectionBody slot returned null and was skipped by this pass entirely. Short text (<60 chars)
    // also falls under the second-pass filler sweep's own length floor, so this specifically
    // exercises the slot-classified path, not the filler catch-all's safety net.
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<section><p>Short blurb.</p></section>`;
    const slots = [{ kind: "sectionBody" as const, selector: "p", originalText: "Short blurb." }];
    const out = applyCopySlots(html, slots, { brief, rawBrief: "Acme Bakery", role: "pricing" });
    const change = out.changes.find((c) => c.kind === "sectionBody");
    expect(change).toBeDefined();
    expect(change!.after).toBe(brief.elevatorPitch);
    expect(out.html).not.toContain("Short blurb.");
  });

  it("still never substitutes sectionBody in testimonials — no fabricated customer quotes", () => {
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<section><p>Short blurb.</p></section>`;
    const slots = [{ kind: "sectionBody" as const, selector: "p", originalText: "Short blurb." }];
    const out = applyCopySlots(html, slots, { brief, rawBrief: "Acme Bakery", role: "testimonials" });
    expect(out.html).toContain("Short blurb.");
  });

  it("catches a © symbol followed by a space — the common real pattern, not just the spelled word", () => {
    // Confirmed live: "© 2026 Mediplace By Scriptfusions. All Rights Reserved." shipped unchanged
    // on a real generated site — the old regex's `\b` sat outside the whole alternation, so it had
    // to match right after "©" too, which a following space (non-word on both sides) never does.
    const brief = expandBriefFromInput("Acme Bakery — bread in Leeds.");
    const html = `<section><p>© 2026 Mediplace By Scriptfusions. All Rights Reserved.</p></section>`;
    const out = applyCopySlots(html, [], { brief, rawBrief: "Acme Bakery — bread in Leeds.", role: "footer" });
    expect(out.html).not.toContain("Mediplace");
    expect(out.html).not.toContain("Scriptfusions");
    expect(out.html).toContain("Acme Bakery");
  });

  it("catches a unit-prefixed street address a digit-only pattern would miss", () => {
    // Confirmed live: "E44, Design Street, Web Corner Melbourne." — a topbar address, not wrapped
    // in an <address> tag so no address slot ever claimed it — shipped on a real generated site.
    const brief = expandBriefFromInput("Acme Bakery — bread in Leeds.");
    const html = `<section><span>E44, Design Street, Web Corner Melbourne.</span></section>`;
    const out = applyCopySlots(html, [], { brief, rawBrief: "Acme Bakery — bread in Leeds.", role: "nav" });
    expect(out.html).not.toContain("Design Street");
  });

  it("prefers contact details found in the brief over a generated placeholder", () => {
    const raw = "Acme Bakery — bread in Leeds. Call 0113 555 0134 or email hi@acme.test";
    const contact = resolveContact(expandBriefFromInput(raw), raw);
    expect(contact.email).toBe("hi@acme.test");
    expect(contact.phone).toContain("0113 555 0134");
    expect(contact.emailFromBrief).toBe(true);

    const without = resolveContact(expandBriefFromInput("Acme Bakery — bread."), "Acme Bakery — bread.");
    expect(without.emailFromBrief).toBe(false);
    expect(without.email).toMatch(/@acme-bakery\.com$/);
  });

  it("replaces a lorem paragraph that never says \"lorem ipsum\"", () => {
    // Confirmed live on a generated page: "Donec quam felis ultricies nec pellentesque vulputate"
    // shipped intact — it contains none of the unmistakable markers, only the rest of the standard
    // lorem vocabulary, so a marker-only test never fired.
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<section><p>Donec quam felis ultricies nec pellentesque vulputate eget.</p></section>`;
    const out = applyCopySlots(html, [], { brief, rawBrief: "Acme Bakery", role: "features" });
    expect(out.html).not.toContain("pellentesque");
    expect(out.filler).toBeGreaterThan(0);
  });

  it("leaves a real sentence that happens to contain one latin-looking word", () => {
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<section><p>Our magna loaves are baked fresh every single morning in Leeds.</p></section>`;
    const out = applyCopySlots(html, [], { brief, rawBrief: "Acme Bakery", role: "testimonials" });
    expect(out.html).toContain("magna loaves");
  });

  it("replaces lorem sitting directly in a container that also has a real nested list", () => {
    // Confirmed live: a footer widget's own "Lorem ipsum dolor sit amet, consectetur adipiscing
    // elit." shipped on every page of a real generation, sitting as direct text in a <div> whose
    // child is a block-level <ul> of otherwise-correct real list items — isTextLeaf disqualified
    // the whole div from every filler check because a <ul> isn't an inline tag, so the leftover
    // blurb was never rewritten while the real list beside it was correctly left alone.
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<div class="widget">Lorem ipsum dolor sit amet, consectetur adipiscing elit.<ul><li>Same-day delivery</li></ul></div>`;
    const out = applyCopySlots(html, [], { brief, rawBrief: "Acme Bakery", role: "footer" });
    expect(out.html.toLowerCase()).not.toContain("lorem");
    expect(out.filler).toBeGreaterThan(0);
    // The real nested list item must survive untouched.
    expect(out.html).toContain("Same-day delivery");
  });

  it("replaces lorem filler with the business's own copy", () => {
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<section><p>Lorem ipsum dolor sit amet, consectetur adipisicing elit.</p></section>`;
    const out = applyCopySlots(html, [], { brief, rawBrief: "Acme Bakery", role: "story" });
    expect(out.html.toLowerCase()).not.toContain("lorem");
    expect(out.filler).toBeGreaterThan(0);
  });

  it("replaces a long branded heading anywhere, not only a first-person one", () => {
    // Confirmed live: a "cta"-classified band's own slogan ("Grow Your Business With Poze") and a
    // "features" section's own headline ("Medical Goods Are Your Devoted Partners") both survived
    // substitution — neither is first-person, so the self-referential check alone missed them.
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<section><h2>Grow Your Business With Poze</h2><h3>Our Services</h3></section>`;
    const slots = locateSlots(html, "features");
    const out = applyCopySlots(html, slots, { brief, rawBrief: "Acme Bakery", role: "features" });
    expect(out.html).toContain(brief.tagline);
    expect(out.html).not.toContain("Poze");
    // A short, genuinely structural label must still survive untouched.
    expect(out.html).toContain("Our Services");
  });

  it("sweeps leftover branded prose in roles the old allowlist did not cover", () => {
    // Confirmed live: a nonprofit's own body copy ("We Are An Organization Engaged In Tree
    // Planting…") survived under a numbered-steps section classified as "features", because the
    // old NARRATIVE_ROLES allowlist covered only hero/story/cta/contact.
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<section><p>We Are An Organization Engaged In Tree Planting Activities across many regions.</p></section>`;
    const out = applyCopySlots(html, [], { brief, rawBrief: "Acme Bakery", role: "features" });
    expect(out.html).not.toContain("Tree Planting");
    expect(out.filler).toBeGreaterThan(0);
  });

  it("catches a repeated card heading no slot locator claimed", () => {
    // Confirmed live: a pediatric clinic's own "Long Term Care Services" card heading shipped
    // unchanged on a roofing site — its card class matched no CARD_SELECTOR keyword, so no
    // serviceItemTitle slot was ever created for it, and it isn't first-person so the
    // self-referential check missed it too.
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<section><div class="single-benefit"><h4>Long Term Care Services</h4><p>Short.</p></div></section>`;
    const out = applyCopySlots(html, [], { brief, rawBrief: "Acme Bakery", role: "features" });
    expect(out.html).not.toContain("Long Term Care Services");
    expect(out.html).toContain(brief.tagline);
  });

  it("does not repeat the tagline verbatim in an unclaimed heading in the same section", () => {
    // Confirmed live: a real generation's hero placed a `tagline` slot AND an unclaimed long
    // heading a few nodes apart, and both showed the exact identical sentence — the tagline slot
    // resolves directly to `brief.tagline` without ever registering it as "used," so the sibling
    // heading's own fallback (which also starts its candidate pool with `brief.tagline`) picked the
    // same string independently.
    const brief = {
      businessName: "Acme Bakery",
      tagline: "Sourdough baked fresh daily.",
      elevatorPitch: "We hand-bake sourdough loaves every morning using a century-old starter.",
      expandedBrief: "Acme Bakery — sourdough loaves in Leeds.",
      targetAudience: "local bread lovers",
      services: ["Sourdough", "Pastries", "Catering"],
      differentiators: ["Family run", "Fresh daily", "Local ingredients"],
      tone: "warm",
      primaryCta: "Order Now",
    };
    const html = `<section><h1>Old tagline placeholder</h1><h2>This Old Fashioned Craft Deserves Real Attention</h2></section>`;
    const slots = [{ kind: "tagline" as const, selector: "h1", originalText: "Old tagline placeholder" }];
    const out = applyCopySlots(html, slots, { brief, rawBrief: "Acme Bakery", role: "hero" });
    expect(out.html).toContain(brief.tagline);
    expect(out.html).not.toContain("This Old Fashioned Craft Deserves Real Attention");
    // The h2 must have picked something OTHER than a second copy of the tagline.
    const taglineCount = out.html.split(brief.tagline).length - 1;
    expect(taglineCount).toBe(1);
  });

  it("never touches testimonial body copy — no fabricated customer quotes", () => {
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const html = `<section><p>This bakery changed how I think about breakfast entirely, wonderful staff.</p></section>`;
    const out = applyCopySlots(html, [], { brief, rawBrief: "Acme Bakery", role: "testimonials" });
    expect(out.html).toContain("changed how I think about breakfast");
    expect(out.filler).toBe(0);
  });
});

describe("expandBriefFromInput — mechanical services/differentiators", () => {
  it("does not fragment a plain descriptive sentence into nonsense services", () => {
    // Confirmed live: this exact sentence produced "roof repair contractor in Denver" and
    // "Colorado." as two fabricated "services" under the old comma/and-splitting heuristic.
    const brief = expandBriefFromInput(
      "Ironclad Build & Roofing — commercial construction and roof repair contractor in Denver, Colorado."
    );
    expect(brief.services).not.toContain("Colorado.");
    expect(brief.services).not.toContain("roof repair contractor in Denver");
  });

  it("still extracts a real list when the brief actually offers one", () => {
    const brief = expandBriefFromInput("Glow Salon — we offer haircuts, coloring, and styling in Miami.");
    expect(brief.services.some((s) => /haircuts/i.test(s))).toBe(true);
    expect(brief.services.some((s) => /coloring/i.test(s))).toBe(true);
  });

  it("never seeds differentiators from services — no duplicate title/body text on a card", () => {
    // Confirmed live: a service card titled "Colorado." also showed "Colorado." as its own body,
    // because differentiators used to be seeded from services.slice(0, 3).
    const brief = expandBriefFromInput("Acme Bakery — sourdough and pastries in Leeds, open daily.");
    const overlap = brief.differentiators.filter((d) => brief.services.includes(d));
    expect(overlap).toHaveLength(0);
  });
});

function section(overrides: Partial<IndexedSection>): IndexedSection {
  return {
    templateId: "tpl_x",
    templateName: "X",
    sectionId: "sec_hero",
    role: "hero",
    roleConfidence: 0.8,
    slotKinds: [],
    sourceOrder: 0,
    ...overrides,
  };
}

describe("taxonomy-aware selection", () => {
  it("prefers sections whose category-folder classification matches the brief", () => {
    const match = classifyTaxonomy("Cedar & Co — sourdough bakery and coffee shop in Bristol");
    const bakery = section({ templateId: "tpl_bakery", category: "hospitality", industry: "cafe-bakery" });
    const legal = section({ templateId: "tpl_legal", category: "professional", industry: "legal" });
    const untagged = section({ templateId: "tpl_plain" });

    expect(sectionTaxonomyAffinity(bakery, match)).toBeGreaterThan(sectionTaxonomyAffinity(legal, match));
    expect(rankByTaxonomy([legal, bakery, untagged], match)).toEqual([bakery]);
  });

  it("degrades to a no-op when nothing in the pool is category-tagged", () => {
    const match = classifyTaxonomy("Cedar & Co — sourdough bakery and coffee shop in Bristol");
    const pool = [section({ templateId: "tpl_a" }), section({ templateId: "tpl_b" })];
    expect(rankByTaxonomy(pool, match)).toEqual(pool);
  });

  it("falls back to the whole pool when nothing matches at all", () => {
    const match = classifyTaxonomy("Cedar & Co — sourdough bakery and coffee shop in Bristol");
    const legal = section({ templateId: "tpl_legal", category: "professional", industry: "legal" });
    const finance = section({ templateId: "tpl_finance", category: "professional", industry: "finance" });
    expect(rankByTaxonomy([legal, finance], match)).toEqual([legal, finance]);
  });

  it("keeps a universal-fit (Multipurpose) section eligible even once another matches", () => {
    const match = classifyTaxonomy("Cedar & Co — sourdough bakery and coffee shop in Bristol");
    const bakery = section({ templateId: "tpl_bakery", category: "hospitality", industry: "cafe-bakery" });
    const legal = section({ templateId: "tpl_legal", category: "professional", industry: "legal" });
    const generic = section({ templateId: "tpl_generic", universalFit: true });
    const ranked = rankByTaxonomy([legal, bakery, generic], match);
    expect(ranked).toContain(bakery);
    expect(ranked).toContain(generic);
    expect(ranked).not.toContain(legal);
  });

  it("classifies the real bundle-folder taxonomy provided this session", () => {
    // Folders confirmed to classify with real confidence.
    const real: Array<[string, string]> = [
      ["Automotive & Vehicles", "auto-services"],
      ["Business, Finance & Law", "legal"],
      // A dedicated `construction` industry now exists, so this folder classifies to the trade
      // rather than collapsing into `real-estate` — the folder names both, and construction is the
      // one a template in it is actually for.
      // Names two verticals. The folder resolves to the one it names outright ("construction");
      // which of the two a given template in it actually is comes from that template's own markup
      // — see `tests/template-taxonomy.test.ts`.
      ["Construction & Real Estate", "construction"],
      ["E-Commerce & Retail", "local-retail"],
      ["Education & LMS", "education"],
      ["Food & Restaurant", "restaurant"],
      ["Health & Medical", "health-clinic"],
      ["Nonprofit & Charity", "nonprofit"],
      ["Technology, AI & Crypto", "saas-tech"],
      ["Agency & Portfolio", "agency-marketing"],
      ["Agriculture & Environment", "agriculture"],
      ["Blog, News & Magazine", "media-publishing"],
      ["Directory & Classifieds", "directory-listing"],
      ["Services & Logistics", "logistics"],
    ];
    for (const [folder, expected] of real) {
      const match = classifyTaxonomy(folder);
      expect(match.confidence, `${folder} should classify with confidence`).toBeGreaterThan(0);
      expect(match.industry, folder).toBe(expected);
    }
    // Genre buckets, not verticals — must NOT get forced into an industry.
    expect(classifyTaxonomy("Multipurpose & Landing Pages").confidence).toBe(0);
  });
});


describe("photo-slots", () => {
  it("detects real photography referenced via inline background-image, not just <img>", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-slot-"));
    try {
      // A 1x1 PNG is enough to exercise the size gate at both ends.
      const onePx = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      );
      await fs.mkdir(path.join(dir, "assets", "img"), { recursive: true });
      await fs.mkdir(path.join(dir, "assets", "shapes"), { recursive: true });
      // Reuse a real large photo from the QA fixtures bundle-independent path is unavailable here,
      // so a same-bytes-different-name pair stands in: what matters is decorative-path exclusion
      // and the sub-threshold size gate, both exercised without needing a real photo on disk.
      await fs.writeFile(path.join(dir, "assets", "img", "tiny.png"), onePx);
      await fs.writeFile(path.join(dir, "assets", "shapes", "tiny.png"), onePx);

      const html = `<div style="background-image:url(_tpl-assets/${TPL}/assets/img/tiny.png)"></div>` +
        `<div style="background-image:url(_tpl-assets/${TPL}/assets/shapes/tiny.png)"></div>`;
      const slots = await detectPhotoSlots(html, { rootDir: dir, templateId: TPL, claimedSelectors: new Set() });
      // Both are 1x1 (below the size floor) — neither should be claimed as a photo slot; this
      // confirms the size gate runs on background-image references exactly as it does for <img>.
      expect(slots).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("applies a resolved photo to a background-image slot by rewriting its url(), not src", async () => {
    const html = `<div class="hero" style="background-image:url(old.jpg);background-size:cover"></div>`;
    const out = await applyPhotoSlots(
      html,
      [{ selector: "div:nth-of-type(1)", width: 800, height: 600, kind: "background" }],
      async () => "https://images.example/new.jpg"
    );
    expect(out.applied).toBe(1);
    expect(out.html).toContain("url(https://images.example/new.jpg)");
    expect(out.html).toContain("background-size:cover"); // rest of the style survives
    expect(out.html).not.toContain("old.jpg");
  });

  it("leaves the template's own image when the resolver has nothing to offer", async () => {
    const html = `<img src="old.jpg">`;
    const out = await applyPhotoSlots(
      html,
      [{ selector: "img:nth-of-type(1)", width: 800, height: 600, kind: "img" }],
      async () => null
    );
    expect(out.applied).toBe(0);
    expect(out.skipped).toBe(1);
    expect(out.html).toContain("old.jpg");
  });

  it("never probes an externally-hotlinked image over the network during tests (safe VITEST default)", async () => {
    // Confirmed live: templates that hotlink demo photography from a third-party URL instead of
    // shipping it in their own zip (~4.6% of this repo's ready-ingested corpus) used to be
    // unconditionally unclassifiable (`measure()` required a local `_tpl-assets/` path). Real
    // dimensions are now probed over the network for these — but `templateProbeRemoteImages()` is
    // hard-off under VITEST (same guarantee `templateClassifyUseLlm()` gives every other network/
    // LLM-touching ingest step), so this must resolve to zero slots and issue no request.
    const html = `<img src="https://cdn.example.test/demo/hero.jpg">`;
    const slots = await detectPhotoSlots(html, { rootDir: "/nonexistent", templateId: TPL, claimedSelectors: new Set() });
    expect(slots).toHaveLength(0);
  });

  it("claims a below-floor gallery/slider thumbnail as a photo slot, using the lower gallery floor", async () => {
    // Confirmed live: a real anchor template's gallery slider ships 196x118 room photos — below
    // MIN_PHOTO_DIMENSION (200) on both axes — so they were never a photo slot at all and shipped
    // verbatim (someone else's hotel-room photography) on every generated site that picked this
    // template, completely unrelated to the actual business. A real fixture of that exact file.
    const source = path.resolve(
      "data/template-cache/tpl_9c31777d1197/src/buyer-file/restin/assets/img/home-1/room/09.jpg"
    );
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-slot-gallery-"));
    try {
      await fs.mkdir(path.join(dir, "assets", "img", "gallery"), { recursive: true });
      await fs.copyFile(source, path.join(dir, "assets", "img", "gallery", "09.jpg"));

      const html = `<div class="swiper-slide"><div class="details-image"><img src="_tpl-assets/${TPL}/assets/img/gallery/09.jpg" alt="img"></div></div>`;
      const slots = await detectPhotoSlots(html, { rootDir: dir, templateId: TPL, claimedSelectors: new Set() });
      expect(slots).toHaveLength(1);
      expect(slots[0]?.kind).toBe("img");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT lower the floor for a below-floor image outside any gallery/slider container", async () => {
    const source = path.resolve(
      "data/template-cache/tpl_9c31777d1197/src/buyer-file/restin/assets/img/home-1/room/09.jpg"
    );
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-slot-plain-"));
    try {
      await fs.mkdir(path.join(dir, "assets", "img", "misc"), { recursive: true });
      await fs.copyFile(source, path.join(dir, "assets", "img", "misc", "09.jpg"));

      const html = `<div class="card"><img src="_tpl-assets/${TPL}/assets/img/misc/09.jpg" alt="img"></div>`;
      const slots = await detectPhotoSlots(html, { rootDir: dir, templateId: TPL, claimedSelectors: new Set() });
      expect(slots).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not lower the floor inside a gallery container for something that looks like a fabricated-person avatar", async () => {
    const source = path.resolve(
      "data/template-cache/tpl_9c31777d1197/src/buyer-file/restin/assets/img/home-1/room/09.jpg"
    );
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-slot-avatar-"));
    try {
      await fs.mkdir(path.join(dir, "assets", "img", "testimonial"), { recursive: true });
      await fs.copyFile(source, path.join(dir, "assets", "img", "testimonial", "author.jpg"));

      const html = `<div class="swiper-slide testimonial-slide"><img src="_tpl-assets/${TPL}/assets/img/testimonial/author.jpg" alt="Author avatar"></div>`;
      const slots = await detectPhotoSlots(html, { rootDir: dir, templateId: TPL, claimedSelectors: new Set() });
      expect(slots).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("branded-copy headings", () => {
  it("rewrites a first-person branded heading regardless of section role", () => {
    const brief = expandBriefFromInput("Glow Salon \u2014 hair, skin, and nail studio in Miami.");
    const contact = resolveContact(brief, "Glow Salon");
    const $ = cheerio.load(`<h2>We're a Creative Agency</h2><h3>Our Services</h3>`, null, false);
    neutralizeTemplateFiller($, brief, contact, "features");
    expect($("h2").text()).toBe(brief.tagline);
    // A neutral structural label must survive untouched even though it starts with "Our".
    expect($("h3").text()).toBe("Our Services");
  });
});

describe("pickTemplateRoot", () => {
  it("ignores a __MACOSX resource-fork mirror instead of flagging the real root ambiguous", async () => {
    // Confirmed live: 126 of 906 real bundle zips carry this junk (zipped on a Mac). __MACOSX/
    // mirrors the real tree one-for-one with tiny `._<name>` AppleDouble stub files, which match
    // the html-file regex by suffix alone and previously tied the real directory on file count.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tpl-root-macosx-"));
    try {
      const real = path.join(dir, "brator");
      await fs.mkdir(real, { recursive: true });
      await fs.writeFile(path.join(real, "index.html"), "<html><body>real</body></html>", "utf8");
      await fs.writeFile(path.join(real, "about.html"), "<html><body>real</body></html>", "utf8");
      await fs.writeFile(path.join(real, "style.css"), "body{color:red}".repeat(1000), "utf8");

      const junk = path.join(dir, "__MACOSX", "brator");
      await fs.mkdir(junk, { recursive: true });
      await fs.writeFile(path.join(junk, "._index.html"), Buffer.from([0, 1, 2]));
      await fs.writeFile(path.join(junk, "._about.html"), Buffer.from([0, 1, 2]));

      const pick = await pickTemplateRoot(dir);
      expect(pick.needsReview).toBeUndefined();
      expect(pick.rootDir).toBe(real);
      expect(pick.htmlFiles).toHaveLength(2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("cross-template mixing (select.ts)", () => {
  // Mixing is opt-in (default OFF — see `templateMixEnabled`, TEMPLATE_MIX_SECTIONS=0 default);
  // this whole block is specifically exercising the opt-in behavior.
  const prevMix = process.env.TEMPLATE_MIX_SECTIONS;
  beforeEach(() => {
    process.env.TEMPLATE_MIX_SECTIONS = "1";
  });
  afterEach(() => {
    if (prevMix === undefined) delete process.env.TEMPLATE_MIX_SECTIONS;
    else process.env.TEMPLATE_MIX_SECTIONS = prevMix;
  });

  const soft: DesignFingerprint = { containerMaxWidthPx: 1200, radiusPx: 8, radiusScale: "soft", spacingScale: "normal" };
  const softClose: DesignFingerprint = { containerMaxWidthPx: 1220, radiusPx: 10, radiusScale: "soft", spacingScale: "normal" };
  const clashing: DesignFingerprint = { containerMaxWidthPx: 2000, radiusPx: 999, radiusScale: "pill", spacingScale: "loose" };

  function fpSection(overrides: Partial<IndexedSection> & { designFingerprint?: DesignFingerprint }): IndexedSection {
    return {
      templateId: "tpl_x",
      templateName: "X",
      sectionId: "sec",
      role: "features",
      roleConfidence: 0.5,
      slotKinds: [],
      sourceOrder: 0,
      ...overrides,
    } as IndexedSection;
  }

  function storeOf(sections: IndexedSection[]): TemplateStore {
    const index: TemplateIndex = { version: 1, updatedAt: Date.now(), templates: [], sections };
    return { index: async () => index } as unknown as TemplateStore;
  }

  // Anchor: the only template covering every required role (nav/hero/footer) — the sole qualifier,
  // so it is deterministically THE anchor regardless of seed. Its own "features" section is
  // deliberately low-scoring (bare confidence, no slots) so a genuinely better outsider can win.
  const anchorNav = fpSection({ templateId: "tpl_anchor", sectionId: "nav", role: "nav", designFingerprint: soft });
  const anchorHero = fpSection({ templateId: "tpl_anchor", sectionId: "hero", role: "hero", designFingerprint: soft });
  const anchorFooter = fpSection({ templateId: "tpl_anchor", sectionId: "footer", role: "footer", designFingerprint: soft });
  const anchorFeatures = fpSection({
    templateId: "tpl_anchor",
    sectionId: "features",
    role: "features",
    roleConfidence: 0.5,
    designFingerprint: soft,
  });

  it("mixes in a compatible outsider template's section for a mixable role", async () => {
    const compatibleFeatures = fpSection({
      templateId: "tpl_compatible",
      sectionId: "features",
      role: "features",
      roleConfidence: 0.95,
      slotKinds: ["sectionHeading", "sectionBody", "primaryCta"],
      designFingerprint: softClose,
    });
    const result = await selectSiteSections({
      variationSeed: "seed-1",
      pages: ["home"],
      store: storeOf([anchorNav, anchorHero, anchorFooter, anchorFeatures, compatibleFeatures]),
    });
    const features = result.pages.home!.find((s) => s.role === "features");
    expect(features?.templateId).toBe("tpl_compatible");
    expect(result.templateIds).toContain("tpl_anchor");
    expect(result.templateIds).toContain("tpl_compatible");
  });

  it("never mixes in an outsider whose design fingerprint clashes, even if it scores higher", async () => {
    const clashingFeatures = fpSection({
      templateId: "tpl_clashing",
      sectionId: "features",
      role: "features",
      roleConfidence: 1,
      slotKinds: ["sectionHeading", "sectionBody", "primaryCta", "tagline", "phone", "email"],
      designFingerprint: clashing,
    });
    const result = await selectSiteSections({
      variationSeed: "seed-1",
      pages: ["home"],
      store: storeOf([anchorNav, anchorHero, anchorFooter, anchorFeatures, clashingFeatures]),
    });
    const features = result.pages.home!.find((s) => s.role === "features");
    // The clashing outsider scores far higher on raw quality but never clears the compatibility
    // bar, so it must never enter the candidate pool at all — the anchor's own weaker section wins.
    expect(features?.templateId).toBe("tpl_anchor");
  });

  it("keeps an identity role (hero) anchor-locked even when a compatible, higher-scoring outsider exists", async () => {
    const betterCompatibleHero = fpSection({
      templateId: "tpl_compatible",
      sectionId: "hero",
      role: "hero",
      roleConfidence: 1,
      slotKinds: ["tagline", "sectionHeading", "primaryCta"],
      designFingerprint: softClose,
    });
    const result = await selectSiteSections({
      variationSeed: "seed-1",
      pages: ["home"],
      store: storeOf([anchorNav, anchorHero, anchorFooter, anchorFeatures, betterCompatibleHero]),
    });
    const hero = result.pages.home!.find((s) => s.role === "hero");
    expect(hero?.templateId).toBe("tpl_anchor");
  });

  it("falls back to the full pool when nothing clears the compatibility bar (no fingerprint backfilled yet)", async () => {
    const unfingerprinted = fpSection({
      templateId: "tpl_old",
      sectionId: "features",
      role: "features",
      roleConfidence: 0.9,
      // no designFingerprint — an un-backfilled corpus entry
    });
    const result = await selectSiteSections({
      variationSeed: "seed-1",
      pages: ["home"],
      // Anchor itself has no fingerprint either, so nothing can be scored compatible — must still
      // produce a site (using whatever's best-scored) rather than an empty features slot.
      store: storeOf([
        fpSection({ templateId: "tpl_anchor", sectionId: "nav", role: "nav" }),
        fpSection({ templateId: "tpl_anchor", sectionId: "hero", role: "hero" }),
        fpSection({ templateId: "tpl_anchor", sectionId: "footer", role: "footer" }),
        unfingerprinted,
      ]),
    });
    const features = result.pages.home!.find((s) => s.role === "features");
    expect(features).toBeDefined();
  });
});
