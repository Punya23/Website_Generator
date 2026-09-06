/**
 * Backfill `TemplateManifest.theme` for templates ingested before that field existed.
 *
 * `recolorCss` already computes the source template's original light/dark theme as a side effect
 * of deciding which direction to invert its background ramp — ingest just used to discard it. A
 * full re-ingest would recompute that correctly (and cheaply) as a matter of course, but re-running
 * the slow parts (zip extraction, section splitting, LLM role classification, asset collection)
 * across an already-ingested corpus just to pick up one boolean is real time this does not need:
 * the raw source stylesheets are still sitting in the cache's own `src/` copy, untouched since
 * ingest. This reads those directly, reruns only the CSS parse + recolor-stats step, and patches
 * the cached manifest in place — no zip, no HTML, no LLM, no asset re-collection.
 *
 * Idempotent: skips any manifest that already carries a `theme`, so re-running after a real
 * re-ingest (which now sets `theme` itself) or a partial prior backfill run is a no-op for those.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { templateCacheDir, templateIngestConcurrency, mapPool } from "../config.js";
import { getPalette } from "../palette.js";
import { templatePaletteId } from "../config.js";
import { TemplateManifestSchema, type TemplateManifest } from "../types.js";
import { findFiles } from "./normalize-archive.js";
import { sanitizeCss } from "./scope-css.js";
import { recolorCss } from "./recolor-css.js";

export interface BackfillSummary {
  scanned: number;
  patched: number;
  alreadyTagged: number;
  skipped: number;
  results: Array<{ templateId: string; theme?: "light" | "dark"; reason?: string }>;
}

export async function backfillThemeForTemplate(templateId: string): Promise<{ theme?: "light" | "dark"; reason?: string }> {
  const dir = path.join(templateCacheDir(), templateId);
  const manifestFile = path.join(dir, "manifest.json");
  let manifest: TemplateManifest;
  try {
    manifest = TemplateManifestSchema.parse(JSON.parse(await fs.readFile(manifestFile, "utf8")));
  } catch {
    return { reason: "unreadable manifest" };
  }
  if (manifest.status !== "ready") return { reason: `status is ${manifest.status}, not ready` };
  if (manifest.theme) return { theme: manifest.theme, reason: "already tagged" };

  const srcRoot = path.join(dir, "src", manifest.sourceRootRelPath);
  let cssFiles: string[] = [];
  try {
    cssFiles = await findFiles(srcRoot, (name) => name.toLowerCase().endsWith(".css"));
  } catch {
    return { reason: "source directory missing" };
  }
  if (cssFiles.length === 0) return { reason: "no stylesheet found in cached source" };

  const parts: string[] = [];
  for (const file of cssFiles.slice(0, 60)) {
    try {
      parts.push(sanitizeCss(await fs.readFile(file, "utf8")));
    } catch {
      // One unreadable stylesheet among several does not sink the whole theme read.
    }
  }
  if (parts.length === 0) return { reason: "no stylesheet could be read" };

  let theme: "light" | "dark";
  try {
    const palette = getPalette(manifest.paletteId ?? templatePaletteId());
    const { stats } = recolorCss(parts.join("\n\n"), palette);
    theme = stats.sourceWasDark ? "dark" : "light";
  } catch (err) {
    return { reason: `recolor-stats failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const patched = TemplateManifestSchema.parse({ ...manifest, theme, updatedAt: Date.now() });
  await fs.writeFile(manifestFile, JSON.stringify(patched, null, 2), "utf8");
  return { theme };
}

export async function backfillThemes(options: { onProgress?: (line: string) => void } = {}): Promise<BackfillSummary> {
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
    const result = await backfillThemeForTemplate(templateId);
    log(`[theme-backfill] ${index + 1}/${ids.length} ${templateId} ${result.theme ?? "—"}${result.reason ? ` (${result.reason})` : ""}`);
    return { templateId, ...result };
  });

  const summary: BackfillSummary = {
    scanned: ids.length,
    patched: results.filter((r) => r.theme && r.reason !== "already tagged").length,
    alreadyTagged: results.filter((r) => r.reason === "already tagged").length,
    skipped: results.filter((r) => !r.theme).length,
    results,
  };
  log(
    `[theme-backfill] patched=${summary.patched} already_tagged=${summary.alreadyTagged} skipped=${summary.skipped} of ${summary.scanned}`
  );
  return summary;
}

const isDirectRun = process.argv[1] && process.argv[1].includes("backfill-theme");
if (isDirectRun) {
  backfillThemes()
    .then(async () => {
      // Selection reads the flat index, not the manifests — a backfill that does not rebuild it
      // patches files nobody reads until the next unrelated cache invalidation happens to occur.
      // Confirmed live: this script shipped without this for as long as `backfill-taxonomy.ts`
      // (which does have it) existed alongside it.
      const { templateStore } = await import("../store.js");
      const store = templateStore();
      store.invalidate();
      const index = await store.rebuild();
      console.log(`[theme-backfill] index rebuilt: ${index.sections.length} sections`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
