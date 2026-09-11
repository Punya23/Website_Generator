/**
 * Closes the edit/recompose parity gap `placements-corpus-fill.ts` and `placements-pipeline.ts`
 * used to document as open: "a later edit/recompose session would rebuild from compose.ts's own
 * deterministic copy-slots pass with no placements copy at all." These tests exercise the REAL
 * public path an edit takes (`revise.ts`'s `composeVerbatimSite`/`applyVerbatimRevisions`) against a
 * real, already-ingested corpus template, with a mocked LLM so the fill itself is fast and
 * hermetic — same technique and same pinned template as `tests/placements-corpus-fill.test.ts`.
 *
 * Also covers `from-corpus.ts`'s `composePhotoKey` and `brand-leak.ts`'s generic
 * `collectTemplateBrandNames`/`checkBrandLeakAgainst` — the corpus-side brand-leak detection gap.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: true,
    chat: vi.fn(async (_system: string, user: string) => {
      const start = user.indexOf('{"copy_fields"');
      if (start === -1) throw new Error("test mock: no copy_fields payload found in prompt");
      const { copy_fields: copyFields, example_fields: exampleFields } = JSON.parse(user.slice(start)) as {
        copy_fields: Record<string, { minChars?: number; type?: string }>;
        example_fields: Record<string, { minChars?: number }>;
      };
      const fill = (minChars: number | undefined, isImage: boolean) =>
        isImage ? "a photo of the team" : "x".repeat(Math.max(minChars ?? 1, 3));
      return JSON.stringify({
        copy_values: Object.fromEntries(Object.entries(copyFields).map(([id, f]) => [id, fill(f.minChars, f.type === "image")])),
        example_values: Object.fromEntries(Object.entries(exampleFields).map(([id, f]) => [id, fill(f.minChars, false)])),
      });
    }),
    getCompositionModel: vi.fn(() => "test-model"),
    // Unlike placements-corpus-fill.test.ts, this file calls the real composeSite (needed for real
    // data-wg-edit attributes) — that path's own photo-query curation calls getSectionModel, which
    // this mock otherwise lacks; stubbed so the test output isn't full of its (harmless, resilient)
    // fallback warning.
    getSectionModel: vi.fn(() => "test-model"),
    getEstimatedCostUsd: vi.fn(() => 0),
  },
}));

import * as cheerio from "cheerio";
import { llm } from "../src/llm/client.js";
import { templateStore } from "../src/templates/store.js";
import { composeSite } from "../src/templates/compose.js";
import { applyVerbatimRevisions, composeVerbatimSite, type VerbatimSiteState } from "../src/templates/revise.js";
import { runCorpusPlacementsFill } from "../src/orchestrator/placements-corpus-fill.js";
import { composePhotoKey } from "../src/templates/placements/from-corpus.js";
import { checkBrandLeakAgainst, collectTemplateBrandNames } from "../src/templates/placements/brand-leak.js";
import { expandBriefFromInput } from "../src/agents/expand-brief-agent.js";
import type { PlacedSection, TemplateManifest } from "../src/templates/types.js";

const PINNED_TEMPLATE_ID = "tpl_0050107a0d3b"; // same pin as tests/placements-corpus-fill.test.ts
const RAW_BRIEF =
  "Harbor Homes is a boutique residential brokerage in Alameda, CA, helping first-time buyers and downsizers.";

describe("composePhotoKey", () => {
  it("turns a corpus ImagePlacement id back into compose.ts's own photo-pinning key", () => {
    expect(composePhotoKey("tpl_abc:sec_hero.photo.0")).toBe("tpl_abc:sec_hero#0");
    expect(composePhotoKey("tpl_abc:sec_team.photo.3")).toBe("tpl_abc:sec_team#3");
  });

  it("returns null for an id with no .photo.<n> suffix — a hand-mapped real-estate/* placement", () => {
    expect(composePhotoKey("home.hero.background")).toBeNull();
    expect(composePhotoKey("chrome.nav.brand")).toBeNull();
  });
});

describe("brand-leak.ts: corpus generalization", () => {
  it("collects a real template's own demo brand name straight from its ingested manifest", async () => {
    const names = await collectTemplateBrandNames([PINNED_TEMPLATE_ID], templateStore());
    // Ground truth: this template's own businessName slot originals, as ingestion recorded them —
    // no hand-typed brand list, unlike the curated path's KNOWN_DEMO_BRAND_NAMES.
    expect(names.length).toBeGreaterThan(0);
  });

  it("flags a collected brand name appearing outside any recognized copy slot", async () => {
    const names = await collectTemplateBrandNames([PINNED_TEMPLATE_ID], templateStore());
    const [brand] = names;
    if (!brand) throw new Error("pinned template has no businessName slot to test against — pick a different fixture");
    const leaks = checkBrandLeakAgainst(`<footer>Photos courtesy of ${brand} Studios</footer>`, names, "Harbor Homes");
    expect(leaks.some((l) => l.brand === brand)).toBe(true);
  });

  it("never flags a business that happens to share a source template's own demo brand name", async () => {
    const names = await collectTemplateBrandNames([PINNED_TEMPLATE_ID], templateStore());
    const [brand] = names;
    if (!brand) throw new Error("pinned template has no businessName slot to test against — pick a different fixture");
    const leaks = checkBrandLeakAgainst(`<footer>${brand}</footer>`, names, brand);
    expect(leaks).toEqual([]);
  });

  it("reports clean when none of the composition's own brand names appear", () => {
    expect(checkBrandLeakAgainst("<footer>Harbor Homes</footer>", ["Rakar", "Some Other Brand"], "Harbor Homes")).toEqual([]);
  });
});

describe("edit/recompose parity: a placements-filled site keeps its real copy through a recompose", () => {
  let manifest: TemplateManifest;
  let selected: { pages: Record<string, PlacedSection[]> };
  let baseState: VerbatimSiteState;

  beforeAll(async () => {
    const loaded = await templateStore().manifest(PINNED_TEMPLATE_ID);
    if (!loaded || loaded.status !== "ready") {
      throw new Error(`Pinned corpus template ${PINNED_TEMPLATE_ID} is missing or not ready — see placements-corpus-fill.test.ts.`);
    }
    manifest = loaded;
    const nav = manifest.sections.find((s) => s.role === "nav");
    const hero = manifest.sections.find((s) => s.role === "hero");
    const footer = manifest.sections.find((s) => s.role === "footer");
    if (!nav || !hero || !footer) throw new Error(`Pinned template ${PINNED_TEMPLATE_ID} no longer has nav/hero/footer.`);
    selected = {
      pages: { home: [nav, hero, footer].map((s) => ({ templateId: manifest.templateId, sectionId: s.id, role: s.role })) },
    };

    const brief = expandBriefFromInput(RAW_BRIEF);
    const composed = await composeSite({ brief, rawBrief: RAW_BRIEF, pages: selected.pages, store: templateStore() });

    const meta = { templateId: manifest.templateId, templateName: "Test composition", vertical: "general" };
    const filled = await runCorpusPlacementsFill(selected, templateStore(), meta, composed.htmlPages, RAW_BRIEF);

    baseState = {
      brief,
      rawBrief: RAW_BRIEF,
      pages: selected.pages,
      overrides: {},
      photos: composed.photos,
      placementsFill: {
        meta,
        brief: filled.brief,
        locale: filled.locale,
        llmValues: filled.llmValues,
        illustrativeValues: filled.illustrativeValues,
      },
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Recompose also runs `composeSite`'s own, entirely unrelated photo-query curation LLM call —
   *  real, pre-existing behavior on every compose, not something this replay path adds. Isolating
   *  placements' OWN fill call by its distinctive system prompt (`fillPageWithRealLlm`'s
   *  `SYSTEM_PROMPT`) is what actually proves "replay costs no new LLM call", robust to that
   *  unrelated call happening alongside it. */
  function placementsFillCallCount(): number {
    return vi
      .mocked(llm.chat)
      .mock.calls.filter(([system]) => typeof system === "string" && system.includes("filling in the real content")).length;
  }

  it("composeVerbatimSite replays the real business copy with NO new placements LLM call", async () => {
    const site = await composeVerbatimSite(baseState, templateStore());
    // The mock's own marker for an LLM-filled field — proves the REPLAYED html still carries the
    // real fill, not compose.ts's own generic original template text.
    expect(site.htmlPages.home).toMatch(/x{3,}/);
    expect(placementsFillCallCount()).toBe(0);
  });

  it("a swap/palette recompose (via applyVerbatimRevisions) keeps the placements copy too", async () => {
    const result = await applyVerbatimRevisions(baseState, [{ kind: "palette", value: "custom:#336699" }], {
      store: templateStore(),
    });
    expect(result.site.htmlPages.home).toMatch(/x{3,}/);
    expect(placementsFillCallCount()).toBe(0);
  });

  it("a manual text edit on a placements-filled node survives a later recompose, not reverted by replay", async () => {
    // Find a node the fill actually wrote to (carries the mock's "xxx..." marker) AND already has a
    // data-wg-edit key (stamped by the FIRST compose pass, before placements ever ran) — the same
    // node an in-preview click-to-edit would address.
    const first = await composeVerbatimSite(baseState, templateStore());
    const $ = cheerio.load(first.htmlPages.home!, null, false);
    const target = $("[data-wg-edit]")
      .filter((_, el) => /^x{3,}$/.test($(el).text().trim()))
      .first();
    const key = target.attr("data-wg-edit");
    if (!key) throw new Error("no placements-filled node with a data-wg-edit key found — fixture assumption broke");

    const edited = await applyVerbatimRevisions(baseState, [{ kind: "text", target: key, value: "The user's own edit" }], {
      store: templateStore(),
    });
    expect(edited.applied).toContain(`text ${key}`);
    expect(edited.site.htmlPages.home).toContain("The user's own edit");

    // Recompose AGAIN from the edited state (e.g. a second, unrelated edit) — the manual edit must
    // still be there, not silently reverted back to the replayed placements value.
    const recomposed = await composeVerbatimSite(edited.state, templateStore());
    expect(recomposed.htmlPages.home).toContain("The user's own edit");
  });

  it("an added section (no placements value exists for its new ids) still composes cleanly", async () => {
    const homeSections = baseState.pages.home ?? [];
    const footer = homeSections.find((s) => s.role === "footer");
    const result = await applyVerbatimRevisions(
      baseState,
      [{ kind: "addSection", page: "home", role: "features", ...(footer ? { after: undefined } : {}) }],
      { store: templateStore() }
    );
    // Either a compatible "features" section existed to add (applied) or none did (rejected) — both
    // are legitimate outcomes; what matters is the call completes and still carries the real fill.
    expect(result.applied.length + result.rejected.length).toBeGreaterThan(0);
    expect(result.site.htmlPages.home).toMatch(/x{3,}/);
  });
});
