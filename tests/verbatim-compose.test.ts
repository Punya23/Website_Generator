import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expandBriefFromInput } from "../src/agents/expand-brief-agent.js";
import type { TemplateManifest } from "../src/templates/types.js";

/**
 * Selection + composition over a synthetic two-template cache: enough to prove sections really do
 * come from different templates, that chrome is shared across pages, and that each page links only
 * the stylesheets its own sections need.
 */
let cacheDir: string;
let storePath: string;

function manifestFor(
  templateId: string,
  name: string,
  taxonomy?: { category: TemplateManifest["category"]; industry: TemplateManifest["industry"] },
  theme?: TemplateManifest["theme"]
): TemplateManifest {
  const now = 1_700_000_000_000;
  const section = (id: string, role: TemplateManifest["sections"][number]["role"]) => ({
    id,
    templateId,
    role,
    roleConfidence: 0.9,
    roleSource: "heuristic" as const,
    htmlCachePath: path.join("sections", `${id}.html`),
    slots: [
      { kind: "sectionHeading" as const, selector: "h2", originalText: "Original heading" },
      { kind: "primaryCta" as const, selector: "a", originalText: "Click here" },
    ],
    sourceOrder: 0,
  });
  return {
    templateId,
    name,
    sourceZipPath: `/tmp/${templateId}.zip`,
    sourceRootRelPath: "root",
    status: "ready",
    paletteId: "all-black",
    ...(taxonomy ? { category: taxonomy.category, industry: taxonomy.industry, sourceCategoryHint: taxonomy.industry } : {}),
    ...(theme ? { theme } : {}),
    cssCachePath: "styles.css",
    sourceCssHash: "hash",
    assets: [
      { cachedRelPath: "img/logo.png", outputRelPath: `_tpl-assets/${templateId}/img/logo.png` },
      // Registered at ingest (this template did ship it, on some other page) but never referenced
      // by any section this fixture composes, nor by the stylesheet — the unused-asset case.
      { cachedRelPath: "img/unused-page-photo.jpg", outputRelPath: `_tpl-assets/${templateId}/img/unused-page-photo.jpg` },
    ],
    sections: [section("sec_nav", "nav"), section("sec_hero", "hero"), section("sec_footer", "footer")],
    createdAt: now,
    updatedAt: now,
  };
}

/** Same shape as `manifestFor`, but lets a test dial in exactly the two signals the anchor scorer
 *  now compares beyond raw coverage: per-section role confidence and how many distinct copy-slot
 *  kinds a section carries. No taxonomy tag — these tests isolate their own cache dir instead of
 *  relying on the taxonomy gate to separate their fixtures from the rest of this file's corpus. */
function manifestWithQuality(templateId: string, name: string, roleConfidence: number, slotKindCount: number): TemplateManifest {
  const now = 1_700_000_000_000;
  const kinds = ["sectionHeading", "primaryCta", "businessName", "tagline", "email", "phone"] as const;
  const slots = kinds
    .slice(0, Math.max(1, Math.min(slotKindCount, kinds.length)))
    .map((kind) => ({ kind, selector: kind === "sectionHeading" ? "h2" : "a", originalText: "Original" }));
  const section = (id: string, role: TemplateManifest["sections"][number]["role"]) => ({
    id,
    templateId,
    role,
    roleConfidence,
    roleSource: "heuristic" as const,
    htmlCachePath: path.join("sections", `${id}.html`),
    slots,
    sourceOrder: 0,
  });
  return {
    templateId,
    name,
    sourceZipPath: `/tmp/${templateId}.zip`,
    sourceRootRelPath: "root",
    status: "ready",
    paletteId: "all-black",
    cssCachePath: "styles.css",
    sourceCssHash: "hash",
    assets: [],
    sections: [section("sec_nav", "nav"), section("sec_hero", "hero"), section("sec_footer", "footer")],
    createdAt: now,
    updatedAt: now,
  };
}

async function writeTemplate(manifest: TemplateManifest): Promise<void> {
  const dir = path.join(cacheDir, manifest.templateId);
  await fs.mkdir(path.join(dir, "sections"), { recursive: true });
  await fs.mkdir(path.join(dir, "src", "root", "img"), { recursive: true });
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest), "utf8");
  // A rule the composed markup can match, plus one only some other page of this template used.
  await fs.writeFile(
    path.join(dir, "styles.css"),
    `[data-tpl="${manifest.templateId}"] h2{color:#fff}\n` +
      `[data-tpl="${manifest.templateId}"] .shop-checkout-panel{display:grid}`,
    "utf8"
  );
  await fs.writeFile(path.join(dir, "src", "root", "img", "logo.png"), "png", "utf8");
  await fs.writeFile(path.join(dir, "src", "root", "img", "unused-page-photo.jpg"), "jpg", "utf8");
  for (const section of manifest.sections) {
    // The nav section carries the only real reference to the manifest's declared asset — matches
    // a real ingested template, where composition scopes the asset copy list to what the site's
    // actual composed markup (or CSS) cites, not everything the template ever registered.
    const img =
      section.role === "nav" ? `<img src="_tpl-assets/${manifest.templateId}/img/logo.png" alt="logo">` : "";
    await fs.writeFile(
      path.join(dir, section.htmlCachePath),
      `<section class="${section.role}">${img}<h2>Original heading</h2><p>Lorem ipsum dolor sit amet.</p>` +
        `<a href="services.html">Click here</a></section>`,
      "utf8"
    );
  }
}

beforeAll(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "verbatim-cache-"));
  storePath = path.join(cacheDir, "index.json");
  process.env.TEMPLATE_CACHE_DIR = cacheDir;
  process.env.TEMPLATE_STORE_PATH = storePath;
  process.env.TEMPLATE_SECTION_HISTORY_PATH = path.join(cacheDir, "history.json");
  await writeTemplate(manifestFor("tpl_aaaaaaaaaaaa", "Alpha"));
  await writeTemplate(manifestFor("tpl_bbbbbbbbbbbb", "Beta"));
});

afterAll(async () => {
  delete process.env.TEMPLATE_CACHE_DIR;
  delete process.env.TEMPLATE_STORE_PATH;
  delete process.env.TEMPLATE_SECTION_HISTORY_PATH;
  await fs.rm(cacheDir, { recursive: true, force: true });
});

describe("verbatim selection + composition", () => {
  it("indexes ready templates and their sections", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const index = await new TemplateStore(storePath).rebuild();
    expect(index.templates).toHaveLength(2);
    expect(index.sections).toHaveLength(6);
  });

  it("draws a page from one anchor template only — a role the anchor lacks is dropped, never borrowed", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const store = new TemplateStore(storePath);
    // Alpha/Beta both cover nav/hero/footer identically — cta only Gamma has, faq only Delta has.
    // With mixing off (the default — see select.ts's module comment), neither role should ever
    // pull a section from Gamma/Delta into a site anchored on Alpha or Beta: the anchor lacking a
    // role means that role is dropped from the page, not borrowed from elsewhere.
    const gamma = manifestFor("tpl_gggggggggggg", "Gamma");
    gamma.sections = [...gamma.sections, { ...gamma.sections[1]!, id: "sec_cta", role: "cta" }];
    await writeTemplate(gamma);
    const delta = manifestFor("tpl_hhhhhhhhhhhh", "Delta");
    delta.sections = [...delta.sections, { ...delta.sections[1]!, id: "sec_faq", role: "faq" }];
    await writeTemplate(delta);
    await store.rebuild();

    const selected = await selectSiteSections({ variationSeed: 7, store, pages: ["home", "services"] });
    expect(Object.keys(selected.pages).sort()).toEqual(["home", "services"]);

    // Every section on every page — nav/hero/footer AND every optional role — comes from exactly
    // ONE template: the anchor. This is the fix: selection used to fall back to the whole corpus
    // for any role the anchor lacked even with cross-template mixing disabled.
    expect(selected.templateIds).toEqual([selected.anchorTemplateId]);
    for (const page of Object.values(selected.pages)) {
      for (const section of page) expect(section.templateId).toBe(selected.anchorTemplateId);
    }

    // Neither Gamma's cta nor Delta's faq made it onto any page — the anchor has neither, and with
    // mixing off there is nowhere else for `pick()` to look.
    const allRoles = Object.values(selected.pages).flatMap((page) => page.map((s) => s.role));
    expect(allRoles).not.toContain("cta");
    expect(allRoles).not.toContain("faq");

    // Chrome is still picked once for the whole site, not per page.
    const navs = Object.values(selected.pages).map(
      (page) => page.find((section) => section.role === "nav")?.sectionId
    );
    expect(new Set(navs).size).toBe(1);
  });

  it("is deterministic for a seed and varies across seeds", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    const a = await selectSiteSections({ variationSeed: 11, store });
    const b = await selectSiteSections({ variationSeed: 11, store });
    expect(b.pages.home).toEqual(a.pages.home);
  });

  it("composes pages that link only the stylesheets their own sections need", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const { composeSite } = await import("../src/templates/compose.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    const brief = expandBriefFromInput("Acme Bakery — sourdough in Leeds. Email hi@acme.test");
    const selected = await selectSiteSections({ variationSeed: 3, store });
    const composed = await composeSite({
      brief,
      rawBrief: "Acme Bakery — sourdough in Leeds. Email hi@acme.test",
      pages: selected.pages,
      store,
    });

    const home = composed.htmlPages.home!;
    expect(home).toContain("<!doctype html>");
    expect(home).toContain('data-role="nav"');
    expect(home).toContain('data-role="footer"');
    // Copy substitution ran: the template's placeholder prose is gone.
    expect(home.toLowerCase()).not.toContain("lorem ipsum");
    expect(home).toContain("Acme Bakery");

    // Stylesheet names carry the markup signature they were reduced against
    // (`tpl_<id>.<signature>.css`), so several pages placing the same sections share one file.
    const linked = [...home.matchAll(/href="(tpl_\w+?)\.\w+\.css"/g)].map((match) => match[1]);
    const used = new Set(selected.pages.home!.map((section) => section.templateId));
    expect(new Set(linked)).toEqual(used);

    // The stylesheet each page links is reduced to the rules its own markup can match: the
    // template's `h2` rule survives, the checkout panel that only some other page of that
    // template ever used does not ship.
    const cssFile = composed.files.find((file) => /tpl_\w+?\.\w+\.css$/.test(file.to))!;
    const shippedCss = await fs.readFile(cssFile.from, "utf8");
    expect(shippedCss).toContain("h2");
    expect(shippedCss).not.toContain("shop-checkout-panel");

    // The logo, actually referenced by the composed nav markup, is on the copy list.
    expect(composed.files.some((file) => file.to.endsWith("img/logo.png"))).toBe(true);
    // An asset the template registered at ingest (shipped on some other page of that template)
    // but that never appears in this site's composed HTML or CSS is not copied — a borrowed hero
    // must not drag along that template's entire unrelated asset footprint.
    expect(composed.files.some((file) => file.to.endsWith("unused-page-photo.jpg"))).toBe(false);
    expect(composed.stats.sectionsPlaced).toBeGreaterThan(0);

    // Provenance: which template every placed section came from, and the real before/after text
    // for what changed in it — the data a stored generation record shows in admin.
    const homeProvenance = composed.provenance.home!;
    expect(homeProvenance.length).toBe(selected.pages.home!.length);
    const hero = homeProvenance.find((row) => row.role === "hero")!;
    expect(hero.templateId).toBe(selected.pages.home!.find((s) => s.role === "hero")!.templateId);
    const ctaChange = hero.changes.find((c) => c.kind === "primaryCta");
    expect(ctaChange?.before).toBe("Click here");
    expect(ctaChange?.after).toBe(brief.primaryCta);

    // slotsSkipped is per-section too (not just an aggregate) — it's what
    // `verbatim-template-pipeline.ts` feeds section-repair-agent to target the exact sections a
    // skipped slot left with the template author's own text, with no QA pattern-matching involved.
    const totalSectionSkips = Object.values(composed.provenance)
      .flat()
      .reduce((n, row) => n + row.slotsSkipped, 0);
    expect(totalSectionSkips).toBe(composed.stats.slotsSkipped);
  });

  it("rewrites chrome navigation to the generated pages", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const { composeSite } = await import("../src/templates/compose.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    const brief = expandBriefFromInput("Acme Bakery — sourdough in Leeds.");
    const selected = await selectSiteSections({ variationSeed: 5, store });
    const composed = await composeSite({ brief, rawBrief: "Acme Bakery", pages: selected.pages, store });
    const nav = composed.htmlPages.home!.split('data-role="nav"')[1]!.split("data-role")[0]!;
    expect(nav).toMatch(/href="(index|about|services|contact)\.html"/);
  });

  it("prefers the category-matching template when the brief clearly fits one", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const store = new TemplateStore(storePath);
    // A third, category-tagged pair on top of the untagged Alpha/Beta from beforeAll: one bakery,
    // one law firm, each with their own hero — the taxonomy tier should pick the bakery one for a
    // bakery brief even though nothing else distinguishes them.
    await writeTemplate(manifestFor("tpl_cccccccccccc", "Bakery Co", { category: "hospitality", industry: "cafe-bakery" }));
    await writeTemplate(manifestFor("tpl_dddddddddddd", "Law Co", { category: "professional", industry: "legal" }));
    await store.rebuild();

    const brief = expandBriefFromInput("Cedar & Co — sourdough bakery and coffee shop in Bristol");
    const selected = await selectSiteSections({
      brief,
      variationSeed: 21,
      store,
      pages: ["home"],
    });
    const hero = selected.pages.home!.find((section) => section.role === "hero")!;
    expect(hero.templateId).toBe("tpl_cccccccccccc");
  });

  it("never mixes an originally-light template with an originally-dark one on the same site", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const store = new TemplateStore(storePath);
    // Both templates carry all three of this fixture's roles (nav/hero/footer), so without a
    // theme lock the freshness preference in `pick()` would actively spread nav/hero/footer
    // across both templates — the same mechanism that produces a healthy cross-template mix
    // would, unconstrained, just as happily mix a light-origin template with a dark one.
    await writeTemplate(manifestFor("tpl_eeeeeeeeeeee", "Light Co", undefined, "light"));
    await writeTemplate(manifestFor("tpl_ffffffffffff", "Dark Co", undefined, "dark"));
    await store.rebuild();

    const themeByTemplate: Record<string, "light" | "dark"> = {
      tpl_eeeeeeeeeeee: "light",
      tpl_ffffffffffff: "dark",
    };

    for (const seed of [1, 2, 3, 4, 5]) {
      const selected = await selectSiteSections({ variationSeed: `theme-lock-${seed}`, store, pages: ["home"] });
      const usedThemes = new Set(
        selected.pages.home!.map((section) => themeByTemplate[section.templateId]).filter(Boolean)
      );
      expect(usedThemes.size).toBeLessThanOrEqual(1);
    }
  });

  it("builds the whole site from the brief's own vertical, not just prefers it", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    // The cache at this point holds a bakery template, a law-firm one, two untagged ones and a
    // light/dark pair. Ranking alone used to let the untagged and mis-fitting templates fill any
    // role the bakery template was not the single best candidate for — the freshness preference in
    // `pick()` actively spreads across templates. Under the hard scope they are not candidates.
    const brief = expandBriefFromInput("Cedar & Co — sourdough bakery and coffee shop in Bristol");
    const selected = await selectSiteSections({ brief, variationSeed: 31, store });

    expect(selected.taxonomy?.industry).toBe("cafe-bakery");
    expect(selected.taxonomy?.tier).toBe("industry");
    expect(selected.taxonomy?.widened).toBe(false);
    expect(selected.templateIds).toEqual(["tpl_cccccccccccc"]);
    for (const [slug, sections] of Object.entries(selected.pages)) {
      expect(sections.length, slug).toBeGreaterThan(0);
      expect(sections.every((section) => section.templateId === "tpl_cccccccccccc"), slug).toBe(true);
    }
  });

  it("reports when the corpus has nothing in the brief's vertical instead of silently mixing", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const store = new TemplateStore(storePath);
    // A creative-category template carrying only a hero: the brief's own vertical exists in the
    // corpus but cannot produce nav or footer, and no other creative template can either.
    const photo = manifestFor("tpl_999999999999", "Photo Co", { category: "creative", industry: "photography" });
    photo.sections = photo.sections.filter((section) => section.role === "hero");
    await writeTemplate(photo);
    await store.rebuild();

    const brief = expandBriefFromInput("Halden Studio — editorial photography and videography portfolio");
    const selected = await selectSiteSections({ brief, variationSeed: 33, store, pages: ["home"] });

    // The lock yields rather than refusing to generate — but it is recorded, so the corpus gap is
    // visible in the generation history instead of surfacing as a mysteriously off-vertical site.
    expect(selected.taxonomy?.industry).toBe("photography");
    expect(selected.taxonomy?.widened).toBe(true);
    // A page is still produced. Once the lock is broken there is no in-vertical mix left to
    // protect, so the site-wide theme lock — the other hard constraint — decides what fills each
    // role; a visually incoherent page would be a worse answer than an off-vertical one.
    expect(selected.pages.home!.some((section) => section.role === "hero")).toBe(true);
  });

  it("swaps a section for one from another template on revision", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const { applyVerbatimRevisions } = await import("../src/templates/revise.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    const brief = expandBriefFromInput("Acme Bakery — sourdough in Leeds.");
    const selected = await selectSiteSections({ variationSeed: 9, store });
    const before = selected.pages.home!.find((section) => section.role === "hero")!;

    const result = await applyVerbatimRevisions(
      { brief, rawBrief: "Acme Bakery", pages: selected.pages },
      [{ kind: "swapSection", target: `${before.templateId}:${before.sectionId}` }],
      { store, page: "home" }
    );
    const after = result.state.pages.home!.find((section) => section.role === "hero")!;
    expect(after.sectionId === before.sectionId && after.templateId === before.templateId).toBe(false);
    expect(result.applied).toHaveLength(1);
    expect(result.site.htmlPages.home).toContain('data-role="hero"');
  });

  it("saves a text edit against its preview anchor and re-applies it on recompose", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const { applyVerbatimRevisions } = await import("../src/templates/revise.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    const brief = expandBriefFromInput("Acme Bakery — sourdough in Leeds.");
    const selected = await selectSiteSections({ variationSeed: 13, store });
    const hero = selected.pages.home!.find((section) => section.role === "hero")!;
    const target = `${hero.templateId}:${hero.sectionId}#0`;

    const result = await applyVerbatimRevisions(
      { brief, rawBrief: "Acme Bakery", pages: selected.pages },
      [{ kind: "text", target, value: "Sourdough, every morning" }],
      { store, page: "home" }
    );
    expect(result.rejected).toHaveLength(0);
    expect(result.state.overrides![target]).toBe("Sourdough, every morning");
    // The edit is in the composed HTML, not just the state — this is what the old override path
    // never managed (it recorded the value and then wrote brief copy over it).
    expect(result.site.htmlPages.home).toContain("Sourdough, every morning");
    expect(result.site.stats.editsApplied).toBeGreaterThan(0);
  });

  it("keeps the authoring layer out of composed HTML unless it is asked for", async () => {
    // What gets published and exported is this HTML. The Edit bar belongs to the preview copy only.
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const { composeSite, withEditLayer } = await import("../src/templates/compose.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    const brief = expandBriefFromInput("Acme Bakery — sourdough in Leeds.");
    const selected = await selectSiteSections({ variationSeed: 31, store, pages: ["home"] });
    const clean = await composeSite({ brief, rawBrief: "Acme Bakery", pages: selected.pages, store });
    expect(clean.htmlPages.home).not.toContain("wg-edit-style");
    expect(clean.htmlPages.home).not.toContain("/api/edit");

    const editable = await composeSite({
      brief,
      rawBrief: "Acme Bakery",
      pages: selected.pages,
      store,
      editable: true,
    });
    expect(editable.htmlPages.home).toContain("wg-edit-style");

    // Adding the layer twice must not double it (the preview is re-persisted on every edit).
    const once = withEditLayer(clean.htmlPages.home!);
    expect(withEditLayer(once)).toBe(once);
  });

  it("adds a section of a requested role, preferring a template the page has not used", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const { applyVerbatimRevisions } = await import("../src/templates/revise.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    const brief = expandBriefFromInput("Acme Bakery — sourdough in Leeds.");
    const selected = await selectSiteSections({ variationSeed: 23, store, pages: ["home"] });
    const before = selected.pages.home!.length;

    const result = await applyVerbatimRevisions(
      { brief, rawBrief: "Acme Bakery", pages: selected.pages },
      [{ kind: "addSection", page: "home", role: "hero" }],
      { store, page: "home" }
    );
    expect(result.rejected).toHaveLength(0);
    expect(result.state.pages.home!.length).toBe(before + 1);
    // A new band goes above the footer, never after it.
    const roles = result.state.pages.home!.map((section) => section.role);
    expect(roles.lastIndexOf("hero")).toBeLessThan(roles.indexOf("footer"));
  });

  it("refuses to add a section the corpus cannot fill", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const { applyVerbatimRevisions } = await import("../src/templates/revise.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    const brief = expandBriefFromInput("Acme Bakery — sourdough in Leeds.");
    const selected = await selectSiteSections({ variationSeed: 29, store, pages: ["home"] });
    // The fixture corpus only has nav/hero/footer sections — nothing can fill a pricing band.
    const result = await applyVerbatimRevisions(
      { brief, rawBrief: "Acme Bakery", pages: selected.pages },
      [{ kind: "addSection", page: "home", role: "pricing" }],
      { store, page: "home" }
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]).toContain("no pricing section");
  });

  it("moves a section and removes shared chrome from every page it sits on", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const { applyVerbatimRevisions } = await import("../src/templates/revise.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    const brief = expandBriefFromInput("Acme Bakery — sourdough in Leeds.");
    const selected = await selectSiteSections({ variationSeed: 17, store });
    const home = selected.pages.home!;
    const hero = home.find((section) => section.role === "hero")!;
    const heroAt = home.indexOf(hero);

    const moved = await applyVerbatimRevisions(
      { brief, rawBrief: "Acme Bakery", pages: selected.pages },
      [{ kind: "moveSection", target: `${hero.templateId}:${hero.sectionId}`, direction: "up" }],
      { store, page: "home" }
    );
    expect(moved.state.pages.home!.indexOf(moved.state.pages.home!.find((s) => s.role === "hero")!)).toBe(heroAt - 1);

    const footer = home.find((section) => section.role === "footer")!;
    const removed = await applyVerbatimRevisions(
      { brief, rawBrief: "Acme Bakery", pages: selected.pages },
      [{ kind: "removeSection", target: `${footer.templateId}:${footer.sectionId}` }],
      { store }
    );
    for (const sections of Object.values(removed.state.pages)) {
      expect(sections.some((s) => s.role === "footer")).toBe(false);
    }
  });

  /** Runs `fn` against a brand-new, empty template cache/store — full isolation from the rest of
   *  this file's shared, ever-growing corpus, so anchor-scoring assertions don't have to reason
   *  about every other test's fixtures also qualifying as candidates. */
  async function withIsolatedStore<T>(
    templates: TemplateManifest[],
    fn: (store: InstanceType<typeof import("../src/templates/store.js").TemplateStore>) => Promise<T>
  ): Promise<T> {
    const { TemplateStore } = await import("../src/templates/store.js");
    const isoDir = await fs.mkdtemp(path.join(os.tmpdir(), "verbatim-anchor-iso-"));
    const prevModuleCacheDir = cacheDir;
    const prevEnvCacheDir = process.env.TEMPLATE_CACHE_DIR;
    cacheDir = isoDir;
    process.env.TEMPLATE_CACHE_DIR = isoDir;
    try {
      for (const manifest of templates) await writeTemplate(manifest);
      const store = new TemplateStore(path.join(isoDir, "index.json"));
      await store.rebuild();
      return await fn(store);
    } finally {
      cacheDir = prevModuleCacheDir;
      process.env.TEMPLATE_CACHE_DIR = prevEnvCacheDir;
      await fs.rm(isoDir, { recursive: true, force: true });
    }
  }

  it("scores anchor candidates on section quality, not just role coverage — a materially better-quality template wins even at equal coverage", async () => {
    const { selectSiteSections } = await import("../src/templates/select.js");
    await withIsolatedStore(
      [
        manifestWithQuality("tpl_quality_hi", "High Quality", 1.0, 6),
        manifestWithQuality("tpl_quality_lo", "Low Quality", 0.3, 1),
      ],
      async (store) => {
        // Coverage is tied (both fully cover nav/hero/footer, nothing else planned): only the
        // quality signal can separate them. Across several seeds the high-quality template must
        // always win — the quality gap (score 2.9 vs 0.75) is far wider than the default
        // exploration band (0.12), so the low-quality one never even makes the shortlist.
        for (const seed of [1, 2, 3, 4, 5]) {
          const selected = await selectSiteSections({ variationSeed: seed, store, pages: ["contact"] });
          expect(selected.anchorTemplateId).toBe("tpl_quality_hi");
        }
      }
    );
  });

  it("excludeAnchorTemplateIds forces a different anchor when a second qualifying candidate exists", async () => {
    const { selectSiteSections } = await import("../src/templates/select.js");
    await withIsolatedStore(
      [
        manifestWithQuality("tpl_excl_a", "Candidate A", 0.9, 3),
        manifestWithQuality("tpl_excl_b", "Candidate B", 0.9, 3),
      ],
      async (store) => {
        const first = await selectSiteSections({ variationSeed: 42, store, pages: ["contact"] });
        expect(first.anchorTemplateId).toBeDefined();

        const redo = await selectSiteSections({
          variationSeed: 42,
          store,
          pages: ["contact"],
          excludeAnchorTemplateIds: [first.anchorTemplateId!],
        });
        expect(redo.anchorTemplateId).toBeDefined();
        expect(redo.anchorTemplateId).not.toBe(first.anchorTemplateId);
      }
    );
  });

  it("excluding every qualifying candidate falls back to the unfiltered pool rather than shipping no anchor", async () => {
    const { selectSiteSections } = await import("../src/templates/select.js");
    await withIsolatedStore([manifestWithQuality("tpl_only", "Only Candidate", 0.9, 3)], async (store) => {
      const selected = await selectSiteSections({
        variationSeed: 1,
        store,
        pages: ["contact"],
        excludeAnchorTemplateIds: ["tpl_only"],
      });
      expect(selected.anchorTemplateId).toBe("tpl_only");
    });
  });

  it("reports every qualifying anchor candidate considered, sorted best-score-first", async () => {
    const { selectSiteSections } = await import("../src/templates/select.js");
    await withIsolatedStore(
      [
        manifestWithQuality("tpl_report_hi", "High", 1.0, 6),
        manifestWithQuality("tpl_report_mid", "Mid", 0.6, 3),
        manifestWithQuality("tpl_report_lo", "Low", 0.2, 1),
      ],
      async (store) => {
        const selected = await selectSiteSections({ variationSeed: 9, store, pages: ["contact"] });
        expect(selected.anchorCandidates).toBeDefined();
        const ids = selected.anchorCandidates!.map((c) => c.templateId);
        expect(new Set(ids)).toEqual(new Set(["tpl_report_hi", "tpl_report_mid", "tpl_report_lo"]));
        const scores = selected.anchorCandidates!.map((c) => c.score);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));
        expect(selected.anchorCandidates![0]!.templateId).toBe("tpl_report_hi");
      }
    );
  });

  it("resolves distinct images for two photo slots in the same section, deduped via the registry", async () => {
    const { selectSiteSections } = await import("../src/templates/select.js");
    const { composeSite } = await import("../src/templates/compose.js");
    const { MediaRegistry } = await import("../src/media/media-registry.js");

    const templateId = "tpl_photo_iiiiiiiii";
    const manifest: TemplateManifest = {
      templateId,
      name: "Photo Co",
      sourceZipPath: `/tmp/${templateId}.zip`,
      sourceRootRelPath: "root",
      status: "ready",
      paletteId: "all-black",
      cssCachePath: "styles.css",
      sourceCssHash: "hash",
      assets: [],
      sections: [
        {
          id: "sec_nav",
          templateId,
          role: "nav",
          roleConfidence: 0.9,
          roleSource: "heuristic",
          htmlCachePath: path.join("sections", "sec_nav.html"),
          slots: [],
          photoSlots: [],
          sourceOrder: 0,
        },
        {
          id: "sec_hero",
          templateId,
          role: "hero",
          roleConfidence: 0.9,
          roleSource: "heuristic",
          htmlCachePath: path.join("sections", "sec_hero.html"),
          slots: [],
          photoSlots: [
            { selector: ".photo-a", width: 800, height: 600, kind: "img" },
            { selector: ".photo-b", width: 800, height: 600, kind: "img" },
          ],
          sourceOrder: 0,
        },
        {
          id: "sec_footer",
          templateId,
          role: "footer",
          roleConfidence: 0.9,
          roleSource: "heuristic",
          htmlCachePath: path.join("sections", "sec_footer.html"),
          slots: [],
          photoSlots: [],
          sourceOrder: 0,
        },
      ],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };

    await withIsolatedStore([], async (store) => {
      // withIsolatedStore only sets up the cache dir; write this bespoke manifest/HTML by hand so
      // the hero section's markup actually has two distinct `<img>` elements to resolve into.
      const dir = path.join(cacheDir, templateId);
      await fs.mkdir(path.join(dir, "sections"), { recursive: true });
      await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest), "utf8");
      await fs.writeFile(path.join(dir, "styles.css"), "", "utf8");
      await fs.writeFile(path.join(dir, "sections", "sec_nav.html"), `<section class="nav"></section>`, "utf8");
      await fs.writeFile(
        path.join(dir, "sections", "sec_hero.html"),
        `<section class="hero"><img class="photo-a" alt="a"><img class="photo-b" alt="b"></section>`,
        "utf8"
      );
      await fs.writeFile(path.join(dir, "sections", "sec_footer.html"), `<section class="footer"></section>`, "utf8");
      await store.rebuild();

      const brief = expandBriefFromInput("Photo Co — product photography studio in Leeds.");
      const selected = await selectSiteSections({ variationSeed: 1, store, pages: ["home"] });
      const registry = new MediaRegistry();
      const composed = await composeSite({
        brief,
        rawBrief: "Photo Co",
        pages: selected.pages,
        store,
        registry,
      });

      const home = composed.htmlPages.home!;
      const srcA = home.match(/class="photo-a"[^>]*src="([^"]+)"|src="([^"]+)"[^>]*class="photo-a"/)?.[1];
      const srcB = home.match(/class="photo-b"[^>]*src="([^"]+)"|src="([^"]+)"[^>]*class="photo-b"/)?.[1];
      expect(srcA).toBeTruthy();
      expect(srcB).toBeTruthy();
      expect(srcA).not.toBe(srcB);
      expect(composed.stats.photosApplied).toBe(2);
    });
  });

  it("applies ComposeOptions.overrides on a recompose — the mechanism the compulsory copy-polish stage relies on", async () => {
    const { TemplateStore } = await import("../src/templates/store.js");
    const { selectSiteSections } = await import("../src/templates/select.js");
    const { composeSite } = await import("../src/templates/compose.js");
    const store = new TemplateStore(storePath);
    await store.rebuild();

    const brief = expandBriefFromInput("Acme Bakery — sourdough in Leeds.");
    const selected = await selectSiteSections({ variationSeed: 3, store, pages: ["home"] });
    const first = await composeSite({ brief, rawBrief: "Acme Bakery", pages: selected.pages, store });

    // Find any real `data-wg-edit` address the first pass anchored, and the text it holds today —
    // exactly what a copy-polish pass would read via `[data-wg-edit]`, per `copy-polish-agent.ts`.
    const match = first.htmlPages.home!.match(/data-wg-edit="([^"]+)">([^<]{3,})</);
    expect(match).toBeTruthy();
    const [, key, originalText] = match!;

    const recomposed = await composeSite({
      brief,
      rawBrief: "Acme Bakery",
      pages: selected.pages,
      store,
      overrides: { [key!]: "A totally distinct polished sentence." },
      photos: first.photos,
    });

    // The overridden node, specifically, now carries the new text instead of the old one — other
    // sections that happen to share the same literal placeholder text ("Original heading" appears
    // on more than one section in this fixture) are untouched, proving the override targeted only
    // the one key it addressed.
    const escapedKey = key!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(recomposed.htmlPages.home).toMatch(
      new RegExp(`data-wg-edit="${escapedKey}">A totally distinct polished sentence\\.<`)
    );
    expect(recomposed.htmlPages.home).not.toMatch(
      new RegExp(`data-wg-edit="${escapedKey}">${originalText!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`)
    );
    expect(recomposed.stats.editsApplied).toBeGreaterThan(0);
  });
});
