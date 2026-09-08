/**
 * Backfill `TemplateManifest.qualityScore` / `qualityFlags` for templates ingested before that
 * field existed.
 *
 * Same shape as `backfill-design-tokens.ts`: reads the already-cached scoped+recolored stylesheet
 * plus the already-classified sections sitting on the manifest, and patches the manifest in place.
 * No zip, no HTML re-extraction, no LLM, no asset re-collection.
 *
 * Idempotent: skips any manifest that already carries a `qualityFlags`, so re-running after a real
 * re-ingest (which now sets it directly) or a partial prior backfill run is a no-op for those.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { templateCacheDir, templateIngestConcurrency, mapPool } from "../config.js";
import { TemplateManifestSchema, type TemplateManifest } from "../types.js";
import { computeTemplateQuality } from "./quality-score.js";

export interface QualityBackfillSummary {
  scanned: number;
  patched: number;
  alreadyTagged: number;
  skipped: number;
  excluded: number;
  results: Array<{ templateId: string; reason?: string }>;
}

export async function backfillQualityForTemplate(
  templateId: string
): Promise<{ ok: boolean; excluded?: boolean; reason?: string }> {
  const dir = path.join(templateCacheDir(), templateId);
  const manifestFile = path.join(dir, "manifest.json");
  let manifest: TemplateManifest;
  try {
    manifest = TemplateManifestSchema.parse(JSON.parse(await fs.readFile(manifestFile, "utf8")));
  } catch {
    return { ok: false, reason: "unreadable manifest" };
  }
  if (manifest.status !== "ready") return { ok: false, reason: `status is ${manifest.status}, not ready` };
  if (manifest.qualityFlags) return { ok: true, reason: "already tagged" };
  if (!manifest.cssCachePath) return { ok: false, reason: "no cached stylesheet on manifest" };

  let css: string;
  try {
    css = await fs.readFile(path.join(dir, manifest.cssCachePath), "utf8");
  } catch {
    return { ok: false, reason: "cached stylesheet missing on disk" };
  }

  const quality = computeTemplateQuality(manifest.sections, css);
  const patched = TemplateManifestSchema.parse({
    ...manifest,
    qualityScore: quality.score,
    qualityFlags: quality.flags,
    updatedAt: Date.now(),
  });
  await fs.writeFile(manifestFile, JSON.stringify(patched, null, 2), "utf8");
  const flagCount = Object.values(quality.flags).filter(Boolean).length;
  return { ok: true, excluded: flagCount >= 2 };
}

export async function backfillQuality(
  options: { onProgress?: (line: string) => void } = {}
): Promise<QualityBackfillSummary> {
  const log = options.onProgress ?? ((line: string) => console.log(line));
  let ids: string[] = [];
  try {
    ids = (await fs.readdir(templateCacheDir(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    throw new Error(`Template cache directory not found: ${templateCacheDir()}`);
  }

  const results = await mapPool(ids, templateIngestConcurrency(), async (templateId, index) => {
    const result = await backfillQualityForTemplate(templateId);
    log(
      `[quality-backfill] ${index + 1}/${ids.length} ${templateId} ${result.ok ? (result.excluded ? "ok (below quality gate)" : "ok") : "skip"}${result.reason ? ` (${result.reason})` : ""}`
    );
    return { templateId, ...result };
  });

  const summary: QualityBackfillSummary = {
    scanned: ids.length,
    patched: results.filter((r) => r.ok && r.reason !== "already tagged").length,
    alreadyTagged: results.filter((r) => r.reason === "already tagged").length,
    skipped: results.filter((r) => !r.ok).length,
    excluded: results.filter((r) => r.excluded).length,
    results: results.map((r) => ({ templateId: r.templateId, ...(r.reason ? { reason: r.reason } : {}) })),
  };
  log(
    `[quality-backfill] patched=${summary.patched} already_tagged=${summary.alreadyTagged} skipped=${summary.skipped} below_gate=${summary.excluded} of ${summary.scanned}`
  );
  return summary;
}

const isDirectRun = process.argv[1] && process.argv[1].includes("backfill-quality");
if (isDirectRun) {
  backfillQuality()
    .then(async () => {
      // Selection reads the flat index, not the manifests — a backfill that does not rebuild it
      // patches files nobody reads. See `backfill-taxonomy.ts`'s identical rebuild step.
      const { templateStore } = await import("../store.js");
      const store = templateStore();
      store.invalidate();
      const index = await store.rebuild();
      console.log(`[quality-backfill] index rebuilt: ${index.sections.length} sections`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
