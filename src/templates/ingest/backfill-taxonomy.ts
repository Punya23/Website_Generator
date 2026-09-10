/**
 * Reclassify already-ingested templates from their own markup.
 *
 * Templates ingested before content-based classification carry, at best, whatever their bundle
 * folder name happened to say — and nothing at all if they sat at the bundle root or in a
 * "Multipurpose" folder. With selection now hard-gating on taxonomy, an untagged corpus does not
 * degrade gracefully: every brief falls straight through to the last-resort tier and the gate
 * buys nothing. So the corpus has to be re-tagged before the gate is worth switching on.
 *
 * A full `--force` re-ingest would do it, but it would also re-extract every zip, re-split every
 * page and re-run LLM role classification across ~900 templates to recompute a handful of string
 * fields. Everything this needs is already cached: the section fragments (with their roles) are on
 * disk, and so is each template's own extracted source for the page `<title>`s. Same shortcut the
 * theme backfill takes, same idempotence — a manifest that already carries `taxonomySource` is
 * skipped unless `--force`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { mapPool, templateCacheDir, templateIngestConcurrency } from "../config.js";
import { TemplateManifestSchema, type TemplateManifest } from "../types.js";
import { classifyTemplateTaxonomy, type TaxonomyEvidenceSection } from "./classify-taxonomy.js";
import { findFiles } from "./normalize-archive.js";

/** Pages read for their `<title>`. Titles repeat heavily across a template's pages; a dozen is
 *  already more than enough to see what the template calls itself. */
const MAX_TITLE_PAGES = 12;

/** Matches the per-section cap ingest applies when it collects the same evidence live. */
const MAX_SECTION_TEXT = 600;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Rebuild the evidence set from what ingest already wrote to disk. */
async function evidenceFromCache(
  dir: string,
  manifest: TemplateManifest
): Promise<{ sections: TaxonomyEvidenceSection[]; pageTitles: string[] }> {
  const sections: TaxonomyEvidenceSection[] = [];
  for (const section of manifest.sections) {
    let html: string;
    try {
      html = await fs.readFile(path.join(dir, section.htmlCachePath), "utf8");
    } catch {
      // A section fragment missing from the cache costs that section's evidence, not the template.
      continue;
    }
    const $ = cheerio.load(html, null, false);
    sections.push({
      role: section.role,
      headingText: collapse($("h1, h2, h3").first().text()),
      text: collapse($.root().text()).slice(0, MAX_SECTION_TEXT),
      // Only the nav's markup is read again, for its link labels.
      ...(section.role === "nav" ? { html } : {}),
    });
  }

  const pageTitles: string[] = [];
  try {
    const srcRoot = path.join(dir, "src", manifest.sourceRootRelPath);
    const pages = (await findFiles(srcRoot, (name) => /\.html?$/i.test(name)))
      .filter((file) => path.dirname(file) === srcRoot)
      .sort()
      .slice(0, MAX_TITLE_PAGES);
    for (const file of pages) {
      const title = collapse(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(await fs.readFile(file, "utf8"))?.[1] ?? "");
      if (title) pageTitles.push(title);
    }
  } catch {
    // The extracted source is a nice-to-have here — section text carries the classification.
  }

  return { sections, pageTitles };
}

export interface TaxonomyBackfillResult {
  templateId: string;
  industry?: string;
  source?: TemplateManifest["taxonomySource"];
  /** Set when the new classification disagrees with what the folder name had produced — the
   *  interesting rows in a backfill run, and the ones worth eyeballing. */
  changedFrom?: string;
  reason?: string;
}

export async function backfillTaxonomyForTemplate(
  templateId: string,
  options: { force?: boolean } = {}
): Promise<TaxonomyBackfillResult> {
  const dir = path.join(templateCacheDir(), templateId);
  const manifestFile = path.join(dir, "manifest.json");
  let manifest: TemplateManifest;
  try {
    manifest = TemplateManifestSchema.parse(JSON.parse(await fs.readFile(manifestFile, "utf8")));
  } catch {
    return { templateId, reason: "unreadable manifest" };
  }
  if (manifest.status !== "ready") return { templateId, reason: `status is ${manifest.status}, not ready` };
  if (manifest.taxonomySource && !options.force) {
    return { templateId, ...(manifest.industry ? { industry: manifest.industry } : {}), reason: "already classified" };
  }

  const { sections, pageTitles } = await evidenceFromCache(dir, manifest);
  if (sections.length === 0) return { templateId, reason: "no cached sections to read" };

  const taxonomy = classifyTemplateTaxonomy({
    ...(manifest.sourceCategoryHint ? { folderHint: manifest.sourceCategoryHint } : {}),
    templateName: manifest.name,
    pageTitles,
    sections,
  });

  const previous = manifest.industry;
  const tagged =
    taxonomy.source === "none"
      ? { taxonomySource: "none" as const }
      : {
          category: taxonomy.match.category,
          industry: taxonomy.match.industry,
          archetype: taxonomy.match.archetype,
          industryRunnersUp: taxonomy.match.runnersUp,
          industryConfidence: taxonomy.match.confidence,
          taxonomySource: taxonomy.source,
          // See `ingest-template.ts`: a folder-declared "fits anything" does not survive the
          // template's own markup naming a vertical.
          universalFit: false,
        };

  const patched = TemplateManifestSchema.parse({ ...manifest, ...tagged, updatedAt: Date.now() });
  await fs.writeFile(manifestFile, JSON.stringify(patched, null, 2), "utf8");

  return {
    templateId,
    ...(patched.industry ? { industry: patched.industry } : {}),
    source: patched.taxonomySource,
    ...(previous && previous !== patched.industry ? { changedFrom: previous } : {}),
  };
}

export interface TaxonomyBackfillSummary {
  scanned: number;
  classified: number;
  reclassified: number;
  unclassifiable: number;
  skipped: number;
  /** Corpus coverage per industry after the run — the number that says whether a hard taxonomy
   *  lock can actually be satisfied for a given vertical. */
  byIndustry: Record<string, number>;
  results: TaxonomyBackfillResult[];
}

export async function backfillTaxonomy(
  options: { force?: boolean; onProgress?: (line: string) => void } = {}
): Promise<TaxonomyBackfillSummary> {
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
    const result = await backfillTaxonomyForTemplate(templateId, { force: options.force ?? false });
    log(
      `[taxonomy-backfill] ${index + 1}/${ids.length} ${templateId} ${result.industry ?? "—"}` +
        `${result.source ? ` (${result.source})` : ""}` +
        `${result.changedFrom ? ` was ${result.changedFrom}` : ""}` +
        `${result.reason ? ` — ${result.reason}` : ""}`
    );
    return result;
  });

  const byIndustry: Record<string, number> = {};
  for (const row of results) {
    if (row.industry) byIndustry[row.industry] = (byIndustry[row.industry] ?? 0) + 1;
  }

  const summary: TaxonomyBackfillSummary = {
    scanned: ids.length,
    classified: results.filter((row) => row.source && row.source !== "none").length,
    reclassified: results.filter((row) => row.changedFrom).length,
    unclassifiable: results.filter((row) => row.source === "none").length,
    skipped: results.filter((row) => row.reason).length,
    byIndustry,
    results,
  };

  log(
    `[taxonomy-backfill] classified=${summary.classified} reclassified=${summary.reclassified} ` +
      `unclassifiable=${summary.unclassifiable} skipped=${summary.skipped} of ${summary.scanned}`
  );
  log(
    `[taxonomy-backfill] corpus coverage: ` +
      Object.entries(byIndustry)
        .sort((a, b) => b[1] - a[1])
        .map(([industry, count]) => `${industry}=${count}`)
        .join(" ")
  );
  return summary;
}

const isDirectRun = process.argv[1] && process.argv[1].includes("backfill-taxonomy");
if (isDirectRun) {
  const force = process.argv.includes("--force");
  backfillTaxonomy({ force })
    .then(async () => {
      // Selection reads the flat index, not the manifests — a backfill that does not rebuild it
      // patches files nobody reads.
      const { templateStore } = await import("../store.js");
      const store = templateStore();
      store.invalidate();
      const index = await store.rebuild();
      console.log(`[taxonomy-backfill] index rebuilt: ${index.sections.length} sections`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
