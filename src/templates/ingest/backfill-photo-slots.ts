/**
 * Re-runs photo-slot detection over already-ingested templates, in place.
 *
 * A full `--force` re-ingest would redo this too, but it would also re-run LLM section
 * classification across ~900 templates just to recompute a purely local/deterministic pass — real
 * cost and time for zero behavior change on the part that actually costs money. Everything
 * `detectPhotoSlots` needs is already on disk: the section HTML `ingest-template.ts` cached, the
 * `alt`-attr slots already classified (for `claimedSelectors`), and the extracted source tree
 * (for real pixel dimensions). Same shortcut `backfill-taxonomy.ts` takes, same idempotence is not
 * attempted here on purpose — this always re-detects (detection is cheap and this is meant to be
 * re-run whenever `photo-slots.ts`'s own logic changes, not gated behind a "already backfilled"
 * flag that would need bumping by hand every time).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { mapPool, templateCacheDir, templateIngestConcurrency } from "../config.js";
import { TemplateManifestSchema, type TemplateManifest } from "../types.js";
import { detectPhotoSlots } from "./photo-slots.js";
import { templateCachePath } from "./ingest-template.js";

export interface PhotoSlotBackfillResult {
  templateId: string;
  before: number;
  after: number;
  reason?: string;
}

export async function backfillPhotoSlotsForTemplate(templateId: string): Promise<PhotoSlotBackfillResult> {
  const dir = templateCachePath(templateId);
  const manifestFile = path.join(dir, "manifest.json");
  let manifest: TemplateManifest;
  try {
    manifest = TemplateManifestSchema.parse(JSON.parse(await fs.readFile(manifestFile, "utf8")));
  } catch {
    return { templateId, before: 0, after: 0, reason: "unreadable manifest" };
  }
  if (manifest.status !== "ready") {
    return { templateId, before: 0, after: 0, reason: `status is ${manifest.status}, not ready` };
  }

  const rootDir = path.join(dir, "src", manifest.sourceRootRelPath);
  const before = manifest.sections.reduce((n, s) => n + s.photoSlots.length, 0);
  let changed = false;

  const nextSections = await Promise.all(
    manifest.sections.map(async (section) => {
      let html: string;
      try {
        html = await fs.readFile(path.join(dir, section.htmlCachePath), "utf8");
      } catch {
        return section; // fragment missing from cache — leave this section exactly as it was
      }
      const claimedSelectors = new Set(
        section.slots.filter((slot) => slot.attr === "alt").map((slot) => slot.selector)
      );
      const photoSlots = await detectPhotoSlots(html, { rootDir, templateId, claimedSelectors });
      if (photoSlots.length !== section.photoSlots.length) changed = true;
      return { ...section, photoSlots };
    })
  );

  const after = nextSections.reduce((n, s) => n + s.photoSlots.length, 0);
  if (!changed) return { templateId, before, after };

  const patched = TemplateManifestSchema.parse({ ...manifest, sections: nextSections, updatedAt: Date.now() });
  await fs.writeFile(manifestFile, JSON.stringify(patched, null, 2), "utf8");
  return { templateId, before, after };
}

export interface PhotoSlotBackfillSummary {
  scanned: number;
  changed: number;
  slotsAdded: number;
  skipped: number;
  results: PhotoSlotBackfillResult[];
}

export async function backfillPhotoSlots(
  options: { onProgress?: (line: string) => void } = {}
): Promise<PhotoSlotBackfillSummary> {
  const log = options.onProgress ?? ((line: string) => console.log(line));
  let ids: string[] = [];
  try {
    ids = (await fs.readdir(templateCacheDir(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("tpl_"))
      .map((entry) => entry.name);
  } catch {
    throw new Error(`Template cache directory not found: ${templateCacheDir()}`);
  }

  const results = await mapPool(ids, templateIngestConcurrency(), async (templateId, index) => {
    const result = await backfillPhotoSlotsForTemplate(templateId);
    const delta = result.after - result.before;
    log(
      `[photo-slot-backfill] ${index + 1}/${ids.length} ${templateId} ${result.before}→${result.after} slot(s)` +
        `${delta > 0 ? ` (+${delta})` : ""}${result.reason ? ` — ${result.reason}` : ""}`
    );
    return result;
  });

  const summary: PhotoSlotBackfillSummary = {
    scanned: ids.length,
    changed: results.filter((r) => r.after !== r.before).length,
    slotsAdded: results.reduce((n, r) => n + Math.max(0, r.after - r.before), 0),
    skipped: results.filter((r) => r.reason).length,
    results,
  };
  log(
    `[photo-slot-backfill] ${summary.changed} template(s) changed, +${summary.slotsAdded} slot(s) total, ` +
      `${summary.skipped} skipped, of ${summary.scanned} scanned`
  );
  return summary;
}

const isDirectRun = process.argv[1] && process.argv[1].includes("backfill-photo-slots");
if (isDirectRun) {
  backfillPhotoSlots().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
