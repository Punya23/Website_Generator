/**
 * Backfill section ROLE classification for already-ingested templates, without a full re-ingest.
 * Two independent classifier fixes live behind this, both found live against the real corpus:
 *
 * 1. `classifyRoleHeuristically`'s `<header>`-tag branch only recognised "nav"/"menu"/"header" as
 *    whole words in a section's id+class. Bootstrap's own canonical nav class "navbar" (glued to
 *    "nav", no separator) and an underscore-joined prefix like "site_header" ("_" is a `\w`
 *    character, no boundary before "header") both slipped through — a real, usable nav was landing
 *    as an extra "hero" instead, making the template ineligible to ever anchor a site at all (needs
 *    nav+hero+footer — see `select.ts`). LLM-free: this branch always resolves at 0.6 or 0.9.
 * 2. The bare-singular keywords in `ID_CLASS_RULES` / `LANDMARK_RULES` (`admin/extract-outline.ts`)
 *    missed their own plural the same way ("s" is a `\w` char too) — a template's own "<h1>FAQs</h1>"
 *    inner-page header landed in role "other", an entire real page invisible to selection, purely
 *    because `\bfaq\b` cannot match inside "FAQs". Widened with `s?`/irregular alternatives plus a
 *    few vertical-specific synonyms (class/instructor/trainer) found the same way. This one CAN
 *    reach for the LLM (`classifySection` falls back to it below 0.6 confidence, and a newly-
 *    matched-only-at-the-0.45-text-fallback-tier section stays under that bar) — bounded, though:
 *    scoped below to only previously-"other" sections, so it costs nothing for the ~99% of the
 *    corpus these two fixes don't touch at all.
 *
 * Every already-ingested template's raw section fragments are still sitting in its cache exactly
 * as extracted — this only needs to re-run the role heuristic against the affected subset and
 * patch the manifest in place if the verdict changed. No zip, no re-extraction, no recolor, no
 * asset re-collection.
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
  reclassified: Array<{ templateId: string; sectionId: string; from: string; to: string; source: "heuristic" | "llm" }>;
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
      if (!raw) continue;
      // Two independent fixes live behind this heuristic now: the tag === "header" branch (nav vs
      // hero — see the file header above) can change verdict for any section with that tag; the
      // ID_CLASS_RULES / LANDMARK_RULES plural-boundary + vocabulary widening can only ever turn a
      // previously-UNCLASSIFIED ("other", confidence 0.2 — nothing matched at all) section into a
      // real role, never change an already-classified one (the fixes only ADD alternatives, they
      // remove none, and rule order is unchanged). So: always re-test "other" sections (bounded,
      // cheap even where it falls through to an LLM call — see below), and header-tag sections
      // regardless of current role (that fix's own scope). Every other combination is provably
      // unaffected, so skipping it isn't a shortcut, it's correct.
      if (section.role !== "other" && raw.tag !== "header") continue;
      const reheuristic = classifyRoleHeuristically(raw);
      if (reheuristic.role === section.role) continue;

      try {
        const reclassification = await classifySection(raw, fragment);
        reclassified.push({
          templateId,
          sectionId: section.id,
          from: section.role,
          to: reclassification.role,
          source: reclassification.source,
        });
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
        console.log(`  ${r.templateId} ${r.sectionId}: ${r.from} -> ${r.to} (${r.source})`);
      }
      for (const e of summary.errors) {
        console.log(`  ERROR ${e.templateId} ${e.sectionId}: ${e.reason}`);
      }
      const llmCalls = summary.reclassified.filter((r) => r.source === "llm").length;
      console.log(`[role-backfill] of those, ${llmCalls} needed an LLM call (still under 0.6 heuristic confidence)`);
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
