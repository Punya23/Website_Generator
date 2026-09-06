/**
 * Backfill `TemplateManifest.designFingerprint` for templates ingested before that field existed.
 *
 * Same shape as `backfill-theme.ts`: reads the already-cached scoped+recolored stylesheet
 * (`styles.css` under the template's cache directory — recolor does not change structural
 * properties, so reading the post-recolor sheet gives the identical fingerprint a re-ingest would)
 * and patches the manifest in place. No zip, no HTML, no LLM, no asset re-collection.
 *
 * Idempotent: skips any manifest that already carries a `designFingerprint`, so re-running after a
 * real re-ingest (which now sets it directly) or a partial prior backfill run is a no-op for those.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { templateCacheDir, templateIngestConcurrency, mapPool } from "../config.js";
import { TemplateManifestSchema, type TemplateManifest } from "../types.js";
import { extractDesignFingerprint } from "./design-fingerprint.js";

export interface DesignTokenBackfillSummary {
  scanned: number;
  patched: number;
  alreadyTagged: number;
  skipped: number;
  results: Array<{ templateId: string; reason?: string }>;
}

export async function backfillDesignTokensForTemplate(
  templateId: string
): Promise<{ ok: boolean; reason?: string }> {
  const dir = path.join(templateCacheDir(), templateId);
  const manifestFile = path.join(dir, "manifest.json");
  let manifest: TemplateManifest;
  try {
    manifest = TemplateManifestSchema.parse(JSON.parse(await fs.readFile(manifestFile, "utf8")));
  } catch {
    return { ok: false, reason: "unreadable manifest" };
  }
  if (manifest.status !== "ready") return { ok: false, reason: `status is ${manifest.status}, not ready` };
  if (manifest.designFingerprint) return { ok: true, reason: "already tagged" };
  if (!manifest.cssCachePath) return { ok: false, reason: "no cached stylesheet on manifest" };

  let css: string;
  try {
    css = await fs.readFile(path.join(dir, manifest.cssCachePath), "utf8");
  } catch {
    return { ok: false, reason: "cached stylesheet missing on disk" };
  }

  const designFingerprint = extractDesignFingerprint(css);
  const patched = TemplateManifestSchema.parse({ ...manifest, designFingerprint, updatedAt: Date.now() });
  await fs.writeFile(manifestFile, JSON.stringify(patched, null, 2), "utf8");
  return { ok: true };
}

export async function backfillDesignTokens(
  options: { onProgress?: (line: string) => void } = {}
): Promise<DesignTokenBackfillSummary> {
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
    const result = await backfillDesignTokensForTemplate(templateId);
    log(
      `[design-token-backfill] ${index + 1}/${ids.length} ${templateId} ${result.ok ? "ok" : "skip"}${result.reason ? ` (${result.reason})` : ""}`
    );
    return { templateId, ...result };
  });

  const summary: DesignTokenBackfillSummary = {
    scanned: ids.length,
    patched: results.filter((r) => r.ok && r.reason !== "already tagged").length,
    alreadyTagged: results.filter((r) => r.reason === "already tagged").length,
    skipped: results.filter((r) => !r.ok).length,
    results: results.map((r) => ({ templateId: r.templateId, ...(r.reason ? { reason: r.reason } : {}) })),
  };
  log(
    `[design-token-backfill] patched=${summary.patched} already_tagged=${summary.alreadyTagged} skipped=${summary.skipped} of ${summary.scanned}`
  );
  return summary;
}

const isDirectRun = process.argv[1] && process.argv[1].includes("backfill-design-tokens");
if (isDirectRun) {
  backfillDesignTokens()
    .then(async () => {
      // Selection reads the flat index, not the manifests — a backfill that does not rebuild it
      // patches files nobody reads. See `backfill-taxonomy.ts`'s identical rebuild step.
      const { templateStore } = await import("../store.js");
      const store = templateStore();
      store.invalidate();
      const index = await store.rebuild();
      console.log(`[design-token-backfill] index rebuilt: ${index.sections.length} sections`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
