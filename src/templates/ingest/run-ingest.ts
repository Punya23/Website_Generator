/**
 * CLI: ingest every zip in the bundle directory.
 *
 * Idempotent by content hash, so re-running over a bundle that grew by 50 templates only does
 * work for those 50. Failures are per-template: a broken archive lands as `needs_review` in the
 * store and the run continues.
 */
import path from "node:path";
import { mapPool, templateIngestConcurrency, templatesBundleDir } from "../config.js";
import { templateStore } from "../store.js";
import { findFiles } from "./normalize-archive.js";
import { ingestTemplateZip } from "./ingest-template.js";
import type { TemplateManifest } from "../types.js";

/** The bundle's own top-level subfolder a zip sits in, e.g. `templates_bundle/Restaurants/x.zip`
 *  -> "Restaurants". A zip at the bundle root, or one nested more than one level deep inside a
 *  category folder, resolves to the first path segment either way — "how deep" is not meaningful
 *  here, only "which top-level bucket did the operator put this in". */
function categoryHintFor(zipPath: string, bundleDir: string): string | undefined {
  const rel = path.relative(bundleDir, zipPath);
  const [first, ...rest] = rel.split(path.sep);
  return rest.length > 0 && first ? first : undefined;
}

export interface IngestRunSummary {
  scanned: number;
  ready: number;
  needsReview: number;
  failed: number;
  results: TemplateManifest[];
}

export async function runBundleIngest(
  options: { bundleDir?: string; force?: boolean; limit?: number; onProgress?: (line: string) => void } = {}
): Promise<IngestRunSummary> {
  const bundleDir = options.bundleDir ?? templatesBundleDir();
  const log = options.onProgress ?? ((line: string) => console.log(line));

  let entries: string[] = [];
  try {
    entries = (await findFiles(bundleDir, (name) => name.toLowerCase().endsWith(".zip"))).sort();
  } catch {
    throw new Error(`Template bundle directory not found: ${bundleDir}`);
  }
  if (options.limit) entries = entries.slice(0, options.limit);
  const categories = new Set(entries.map((zipPath) => categoryHintFor(zipPath, bundleDir)).filter(Boolean));
  log(
    `[templates] ${entries.length} archive(s) in ${bundleDir}` +
      (categories.size > 0 ? ` across ${categories.size} categor${categories.size === 1 ? "y" : "ies"}` : "")
  );

  const results = await mapPool(entries, templateIngestConcurrency(), async (zipPath, index) => {
    const name = path.basename(zipPath);
    const categoryHint = categoryHintFor(zipPath, bundleDir);
    try {
      const manifest = await ingestTemplateZip(zipPath, { force: options.force, ...(categoryHint ? { categoryHint } : {}) });
      log(
        `[templates] ${index + 1}/${entries.length} ${manifest.status.padEnd(12)} ${manifest.name} ` +
          `(${manifest.sections.length} sections${manifest.category ? `, ${manifest.category}/${manifest.industry}` : ""})` +
          `${manifest.reviewReason ? ` — ${manifest.reviewReason}` : ""}`
      );
      return manifest;
    } catch (err) {
      log(`[templates] ${index + 1}/${entries.length} failed      ${name} — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });

  const manifests = results.filter((row): row is TemplateManifest => Boolean(row));
  const store = templateStore();
  store.invalidate();
  const index = await store.rebuild();

  const summary: IngestRunSummary = {
    scanned: entries.length,
    ready: manifests.filter((row) => row.status === "ready").length,
    needsReview: manifests.filter((row) => row.status === "needs_review").length,
    failed: entries.length - manifests.length,
    results: manifests,
  };
  log(
    `[templates] ready=${summary.ready} needs_review=${summary.needsReview} failed=${summary.failed} ` +
      `— index holds ${index.sections.length} sections across ${index.templates.length} templates`
  );
  return summary;
}

const isDirectRun = process.argv[1] && process.argv[1].includes("run-ingest");
if (isDirectRun) {
  const force = process.argv.includes("--force");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1] ?? "", 10) : undefined;
  runBundleIngest({ force, ...(Number.isFinite(limit) ? { limit } : {}) }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
