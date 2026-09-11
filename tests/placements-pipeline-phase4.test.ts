/**
 * Phase 4 (docs/PLACEMENTS_ORCHESTRATION_PLAN.md, "post-fill QA") on the CURATED path
 * (`src/orchestrator/placements-pipeline.ts`). Proves the real bug this phase found and fixed —
 * `runCodeQA` used to be called with no `pageUrl`, and `files` was never returned to the
 * orchestrator at all, so a real generation on this path shipped with NO stylesheet/script copied
 * into output. `collectTemplateAssets` + staged real QA is what closes both at once: an actually
 * missing asset now fails QA (see `tests/code-qa-missing-asset.test.ts` for that check itself), and
 * a genuinely present one — the normal, correct case for every unmodified `real-estate/*` template
 * — must NOT get flagged.
 *
 * `llm.chat` is mocked the same way `tests/placements-corpus-fill.test.ts` does: answers the exact
 * flat shape `fillPlacementsFile` sends, sized to each field's own `minChars`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
        isImage ? "a photo of a modern home exterior" : "x".repeat(Math.max(minChars ?? 1, 3));
      return JSON.stringify({
        copy_values: Object.fromEntries(Object.entries(copyFields).map(([id, f]) => [id, fill(f.minChars, f.type === "image")])),
        example_values: Object.fromEntries(Object.entries(exampleFields).map(([id, f]) => [id, fill(f.minChars, false)])),
      });
    }),
    getCompositionModel: vi.fn(() => "test-model"),
    getEstimatedCostUsd: vi.fn(() => 0),
  },
}));

import path from "node:path";
import { collectTemplateAssets, runPlacementsPipeline } from "../src/orchestrator/placements-pipeline.js";
import type { SiteContext } from "../src/types.js";

const TEMPLATE_DIR = path.resolve(process.cwd(), "real-estate", "real-estate-agency");
const RAW_BRIEF = "Harbor Homes is a boutique residential brokerage in Alameda, CA, helping first-time buyers and downsizers.";

function fakeCtx(): SiteContext {
  return { pages: {} } as unknown as SiteContext;
}

describe("collectTemplateAssets", () => {
  it("finds the template's own CSS and JS, excluding page HTML and placements JSON", async () => {
    const files = await collectTemplateAssets(TEMPLATE_DIR);
    const to = files.map((f) => f.to);
    expect(to).toContain(path.join("assets", "css", "style.css"));
    expect(to).toContain(path.join("assets", "js", "main.js"));
    expect(to.some((t) => t.endsWith(".html"))).toBe(false);
    expect(to.some((t) => t.endsWith(".json"))).toBe(false);
  });

  it("every `from` path actually exists on disk", async () => {
    const fs = await import("node:fs/promises");
    const files = await collectTemplateAssets(TEMPLATE_DIR);
    for (const file of files) {
      await expect(fs.access(file.from)).resolves.toBeUndefined();
    }
  });
});

describe("runPlacementsPipeline — Phase 4 asset + QA wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns files to copy — the fix for a curated site shipping with no stylesheet at all", async () => {
    const result = await runPlacementsPipeline(fakeCtx(), RAW_BRIEF);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files.some((f) => f.to.includes("style.css"))).toBe(true);
  }, 30_000);

  it("QA runs against the REAL staged files — an unmodified template's own genuine assets never flag MISSING_ASSET", async () => {
    const result = await runPlacementsPipeline(fakeCtx(), RAW_BRIEF);
    for (const [slug, qa] of Object.entries(result.qaResults)) {
      const missing = qa.issues.filter((i) => i.code === "MISSING_ASSET");
      expect(missing, `page ${slug} incorrectly flagged: ${JSON.stringify(missing)}`).toEqual([]);
    }
  }, 30_000);

  it("does not false-positive a brand leak on a real business whose own name differs from the template's demo brand", async () => {
    const result = await runPlacementsPipeline(fakeCtx(), RAW_BRIEF);
    for (const qa of Object.values(result.qaResults)) {
      expect(qa.issues.filter((i) => i.code === "BRAND_LEAK")).toEqual([]);
    }
  }, 30_000);

  it("ships real per-business copy, not the template's own demo text", async () => {
    const result = await runPlacementsPipeline(fakeCtx(), RAW_BRIEF);
    const home = result.htmlPages.home ?? "";
    expect(home).toContain("Harbor Homes");
  }, 30_000);
});
