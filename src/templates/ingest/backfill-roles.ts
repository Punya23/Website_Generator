/**
 * Backfill section ROLE classification for already-ingested templates, without a full re-ingest.
 *
 * `classifyRoleHeuristically`'s `<header>`-tag branch only recognised "nav"/"menu"/"header" as
 * whole words in a section's id+class (see `classify-section.ts`). Two real, common naming
 * patterns slipped through — Bootstrap's own canonical nav class "navbar" (glued to "nav" with no
 * separator) and an underscore-joined prefix like "site_header" (underscore is a `\w` character,
 * so the old regex found no word boundary before "header"). Confirmed live: real templates' own
 * nav bar was landing as an extra "hero" section instead of "nav", which made them ineligible to
 * ever anchor a site at all (an anchor needs nav+hero+footer coverage — see `select.ts`) even
 * though a real, usable nav existed on disk the whole time.
 *
 * Every already-ingested template's raw section fragments are still sitting in its cache exactly
 * as extracted — this only needs to re-run the role heuristic against every already-`<header>`-
 * tagged fragment and patch the manifest in place if the verdict changed. No zip, no
 * re-extraction, no recolor, no asset re-collection — and no network call either: `classifySection`
 * only reaches for the LLM when heuristic confidence is below 0.6, and the `<header>` branch always
 * resolves at 0.6 or 0.9, so this never triggers one.
 *
 * Idempotent: re-running after a real re-ingest (which now classifies correctly itself) or a
 * partial prior backfill run finds nothing left to change for templates it already patched.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { templateCacheDir, templateIngestConcurrency, mapPool } from "../config.js";
import { TemplateManifestSchema, type TemplateManifest } from "../types.js";
import { classifyRoleHeuristically, classifySection } from "./classify-section.js";
import type { RawSection } from "./extract-sections.js";

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Re-derives the RawSection `extractPageSections` (extract-sections.ts) would have produced for
 *  an already-cached fragment — the fragment file IS that exact outerHTML, so this just re-reads
 *  the same metadata back off it. Mirrors that function's own extraction logic exactly. */
function rawSectionFromFragment(html: string): RawSection | undefined {
  const $ = cheerio.load(html, null, false);
  const root = $.root().children().first();
  if (root.length === 0) return undefined;
  const tag = (root.get(0) as { tagName?: string } | undefined)?.tagName?.toLowerCase() ?? "section";
  return {
    html,
    tag,
    id: root.attr("id") ?? "",
    className: root.attr("class") ?? "",
    headingText: collapse(root.find("h1, h2, h3").first().text()),
    text: collapse(root.text()).slice(0, 600),
    sourceOrder: 0,
  };
}

export interface RoleBackfillSummary {
  scanned: number;
  reclassified: Array<{ templateId: string; sectionId: string; from: string; to: string }>;
  errors: Array<{ templateId: string; sectionId: string; reason: string }>;
}

export async function backfillRoles(options: { onProgress?: (line: string) => void } = {}): Promise<RoleBackfillSummary> {
  const log = options.onProgress ?? ((line: string) => console.log(line));
  let ids: string[] = [];
  try {
    ids = (await fs.readdir(templateCacheDir(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    throw new Error(`Template cache directory not found: ${templateCacheDir()}`);
  }

  const reclassified: RoleBackfillSummary["reclassified"] = [];
  const errors: RoleBackfillSummary["errors"] = [];

  await mapPool(ids, templateIngestConcurrency(), async (templateId, index) => {
    const dir = path.join(templateCacheDir(), templateId);
    const manifestFile = path.join(dir, "manifest.json");
    let manifest: TemplateManifest;
    try {
      manifest = TemplateManifestSchema.parse(JSON.parse(await fs.readFile(manifestFile, "utf8")));
    } catch {
      return;
    }
    if (manifest.status !== "ready") return;

    let changed = false;
    for (const section of manifest.sections) {
      let fragment: string;
      try {
        fragment = await fs.readFile(path.join(dir, section.htmlCachePath), "utf8");
      } catch {
        continue; // fragment missing on disk — leave the recorded classification alone
      }
      const raw = rawSectionFromFragment(fragment);
      // Only the fixed branch (tag === "header") can possibly produce a different verdict now —
      // every other tag's classification path is unchanged, so re-testing it would only waste time.
      if (!raw || raw.tag !== "header") continue;
      const reheuristic = classifyRoleHeuristically(raw);
      if (reheuristic.role === section.role) continue;

      try {
        const reclassification = await classifySection(raw, fragment);
        reclassified.push({ templateId, sectionId: section.id, from: section.role, to: reclassification.role });
        section.role = reclassification.role;
        section.roleConfidence = reclassification.confidence;
        section.roleSource = reclassification.source;
        section.slots = reclassification.slots;
        changed = true;
      } catch (err) {
        errors.push({ templateId, sectionId: section.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    if (changed) {
      const patched = TemplateManifestSchema.parse({ ...manifest, updatedAt: Date.now() });
      await fs.writeFile(manifestFile, JSON.stringify(patched, null, 2), "utf8");
      log(`[role-backfill] ${index + 1}/${ids.length} ${templateId} — patched`);
    }
  });

  log(`[role-backfill] scanned=${ids.length} reclassified=${reclassified.length} errors=${errors.length}`);
  return { scanned: ids.length, reclassified, errors };
}

const isDirectRun = process.argv[1] && process.argv[1].includes("backfill-roles");
if (isDirectRun) {
  backfillRoles()
    .then(async (summary) => {
      for (const r of summary.reclassified) {
        console.log(`  ${r.templateId} ${r.sectionId}: ${r.from} -> ${r.to}`);
      }
      for (const e of summary.errors) {
        console.log(`  ERROR ${e.templateId} ${e.sectionId}: ${e.reason}`);
      }
      // Selection reads the flat index, not the manifests — a backfill that does not rebuild it
      // patches files nobody reads until the next unrelated cache invalidation happens to occur
      // (the exact gotcha backfill-theme.ts's own history already ran into).
      const { templateStore } = await import("../store.js");
      const store = templateStore();
      store.invalidate();
      const index = await store.rebuild();
      console.log(`[role-backfill] index rebuilt: ${index.sections.length} sections`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
