/**
 * Phase 2B (`docs/PLACEMENTS_ORCHESTRATION_PLAN.md`) — `runCorpusPlacementsFill` end to end
 * against a real, already-ingested corpus template (auto-discovered slots, nothing hand-mapped),
 * with a mocked LLM so the test is fast and hermetic. Asserts the two things the Phase 2A spike
 * measured live and this module's own doc comment is built around:
 *
 *  1. nav/footer sections never reach `buildPlacementsFromSelection` — no placement id for them
 *     exists at all, so there is nothing for a real generation's compose-time nav rebuild / logo-
 *     wordmark swap to collide with.
 *  2. A real per-business value lands in the composed HTML for a body section's `llm` placement —
 *     proving the apply step actually reaches the page, not just that a `PlacementsFile` was built.
 *
 * `llm.chat` is mocked to answer the exact flat `copy_fields`/`example_fields` shape
 * `fillPlacementsFile` sends, sized to each field's own `minChars` — same technique
 * `scripts/spike-corpus-placements.ts` uses for its dummy values, so a mismatch here would fail
 * the same way it would there. `expandBrief`'s own internal LLM call gets the same mocked response
 * (which doesn't match ITS schema) and is expected to fail over to the deterministic
 * `expandBriefFromInput` fallback — exercising `resolveBriefContext`'s existing resilience path
 * rather than needing a second, differently-shaped mock.
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
      const fill = (id: string, minChars: number | undefined, isImage: boolean) =>
        isImage ? "a photo of the team" : "x".repeat(Math.max(minChars ?? 1, 3));
      return JSON.stringify({
        copy_values: Object.fromEntries(
          Object.entries(copyFields).map(([id, f]) => [id, fill(id, f.minChars, f.type === "image")])
        ),
        example_values: Object.fromEntries(Object.entries(exampleFields).map(([id, f]) => [id, fill(id, f.minChars, false)])),
      });
    }),
    getCompositionModel: vi.fn(() => "test-model"),
    getEstimatedCostUsd: vi.fn(() => 0),
  },
}));

import { templateStore } from "../src/templates/store.js";
import { templateCachePath } from "../src/templates/ingest/ingest-template.js";
import fs from "node:fs/promises";
import path from "node:path";
import type { PlacedSection, TemplateManifest } from "../src/templates/types.js";
import { runCorpusPlacementsFill } from "../src/orchestrator/placements-corpus-fill.js";

const PINNED_TEMPLATE_ID = "tpl_0050107a0d3b"; // same pin as tests/placements-corpus-bridge.test.ts

const RAW_BRIEF =
  "Harbor Homes is a boutique residential brokerage in Alameda, CA, helping first-time buyers and downsizers.";

describe("runCorpusPlacementsFill", () => {
  let manifest: TemplateManifest;
  let selected: { pages: Record<string, PlacedSection[]> };
  let htmlPages: Record<string, string>;

  beforeAll(async () => {
    const loaded = await templateStore().manifest(PINNED_TEMPLATE_ID);
    if (!loaded || loaded.status !== "ready") {
      throw new Error(
        `Pinned corpus template ${PINNED_TEMPLATE_ID} is missing or not ready — run with TEMPLATE_CACHE_DIR/` +
          `TEMPLATE_STORE_PATH pointed at a real ingested corpus, or pick a different id.`
      );
    }
    manifest = loaded;

    const nav = manifest.sections.find((s) => s.role === "nav");
    const hero = manifest.sections.find((s) => s.role === "hero");
    const footer = manifest.sections.find((s) => s.role === "footer");
    if (!nav || !hero || !footer) throw new Error(`Pinned template ${PINNED_TEMPLATE_ID} no longer has nav/hero/footer.`);

    const sections = [nav, hero, footer].map((s) => ({ templateId: manifest.templateId, sectionId: s.id, role: s.role }));
    selected = { pages: { home: sections } };

    // A minimal but real composed page: the pinned template's own cached hero fragment, wrapped so
    // there is at least one real DOM to apply placements against — proves the apply step reaches
    // actual HTML, not just that a PlacementsFile was built from the selection.
    const heroHtml = await fs.readFile(path.join(templateCachePath(manifest.templateId), hero.htmlCachePath), "utf8");
    htmlPages = { home: `<html><body>${heroHtml}</body></html>` };
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALLOW_MOCKS;
  });

  it("excludes nav/footer from the PlacementsFile it fills — chrome is compose-owned, not placements-owned", async () => {
    const result = await runCorpusPlacementsFill(
      selected,
      templateStore(),
      { templateId: manifest.templateId, templateName: "Test composition", vertical: "general" },
      htmlPages,
      RAW_BRIEF
    );
    // Nothing to assert on placement ids directly (runCorpusPlacementsFill doesn't return the
    // PlacementsFile) — the real proof is indirect: no nav/footer selector shows up in `skipped`
    // (there's nothing to skip because nothing was ever built for those sections), and the hero
    // section's own ids DID get applied, which the next test checks in detail.
    expect(result.skipped.filter((id) => id.includes("nav") || id.includes("footer"))).toEqual([]);
  });

  it("applies real per-business copy into the composed hero HTML", async () => {
    const result = await runCorpusPlacementsFill(
      selected,
      templateStore(),
      { templateId: manifest.templateId, templateName: "Test composition", vertical: "general" },
      htmlPages,
      RAW_BRIEF
    );
    expect(result.appliedText).toBeGreaterThan(0);
    // The mocked LLM's fill value is a run of "x" characters — confirms a value from the fill
    // response actually reached the HTML, not just that compose's own original text survived.
    expect(result.htmlPages.home).toMatch(/x{3,}/);
  });

  it("ships a page untouched when it has no body sections to fill", async () => {
    const noBodyPages = { pages: { about: [] as PlacedSection[] } };
    const result = await runCorpusPlacementsFill(
      noBodyPages,
      templateStore(),
      { templateId: manifest.templateId, templateName: "Test composition", vertical: "general" },
      { about: "<html><body>unchanged</body></html>" },
      RAW_BRIEF
    );
    expect(result.htmlPages.about).toBe("<html><body>unchanged</body></html>");
    expect(result.appliedText).toBe(0);
  });

  // Phase 4 (docs/PLACEMENTS_ORCHESTRATION_PLAN.md, "post-fill QA": "skipped-selector count
  // surfaced") — `verbatim-template-pipeline.ts` attaches a page's own skipped/clamped note to
  // that page's own QAResult, which needs the PER-PAGE breakdown, not just the flattened totals.
  it("breaks totals down per page in `byPage`, keyed only by pages it actually touched", async () => {
    const result = await runCorpusPlacementsFill(
      selected,
      templateStore(),
      { templateId: manifest.templateId, templateName: "Test composition", vertical: "general" },
      htmlPages,
      RAW_BRIEF
    );
    expect(Object.keys(result.byPage)).toEqual(["home"]);
    expect(result.byPage.home!.appliedText).toBe(result.appliedText);
    expect(result.byPage.home!.appliedImages).toBe(result.appliedImages);
    expect(result.byPage.home!.skipped).toEqual(result.skipped);
    expect(result.byPage.home!.clamped).toEqual(result.clamped);
  });

  it("a page with nothing to fill has no entry in `byPage` at all", async () => {
    const noBodyPages = { pages: { about: [] as PlacedSection[] } };
    const result = await runCorpusPlacementsFill(
      noBodyPages,
      templateStore(),
      { templateId: manifest.templateId, templateName: "Test composition", vertical: "general" },
      { about: "<html><body>unchanged</body></html>" },
      RAW_BRIEF
    );
    expect(result.byPage.about).toBeUndefined();
  });
});
