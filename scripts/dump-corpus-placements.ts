/**
 * Writes a `placements.json` + `placements.llm.json` pair (same shape/tooling as the curated
 * `real-estate/*` templates — see `real-estate/PLACEMENTS_SCHEMA.md`) for every ALREADY-INGESTED
 * corpus template under a given source folder, so a bulk-ingested batch (real-estate-2, and
 * whatever category comes next) is reviewable the same way the 4 hand-mapped templates are.
 *
 * Not part of the runtime generation pipeline — the corpus path never reads these files, it builds
 * the identical shape in memory per generation (`from-corpus.ts`'s `buildPlacementsFromSelection`).
 * This is a review/demo artifact only: reuses `textPlacementFromSlot`/`imagePlacementFromPhotoSlot`
 * (the exact functions a real generation calls) over EVERY section in the template's own manifest,
 * not just whatever one generation happened to select — so it shows the full field inventory a
 * given template can ever contribute, not one composition's slice of it.
 *
 * One difference from the curated files: no real "page" grouping exists for an auto-discovered
 * template (`TemplateSection` carries a `role`, never a source page — see this file's own header
 * comment in `from-corpus.ts` for why that's deliberate). Everything lands under one page, keyed
 * "content"; each field's own `id`/`section` still encode exactly which section it came from.
 *
 *   npx tsx scripts/dump-corpus-placements.ts "<source folder of raw template subfolders>" [outDir]
 *
 * Matches each subfolder name against an already-ingested manifest's `name`/`sourceZipPath` (run
 * `npm run templates:ingest` first) and writes the pair next to that subfolder — `outDir` overrides
 * where the pair is written (default: back into the source folder itself).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { templateStore } from "../src/templates/store.js";
import { textPlacementFromSlot, imagePlacementFromPhotoSlot } from "../src/templates/placements/from-corpus.js";
import { buildLlmView } from "../src/templates/placements/llm-view.js";
import { PagePlacementsSchema, PlacementsFileSchema, SCHEMA_VERSION } from "../src/templates/placements/schema.js";
import type { ImagePlacement, TextPlacement } from "../src/templates/placements/schema.js";
import type { TemplateManifest } from "../src/templates/types.js";

const CHROME_ROLES = new Set(["nav", "footer"]);

/** Same normalization on both sides (case, spaces, dashes stripped) so "kestrel-and-vance-law" and
 *  "Kestrel And Vance Law Html Template" (the manifest's own title-cased, suffix-carrying `name`)
 *  match without either side needing to guess the other's exact formatting. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findManifestForFolder(folderName: string, all: TemplateManifest[]): TemplateManifest | undefined {
  const key = normalize(folderName);
  return (
    all.find((m) => normalize(m.name) === key) ??
    all.find((m) => m.sourceZipPath && normalize(path.basename(m.sourceZipPath, ".zip")) === key) ??
    all.find((m) => normalize(m.name).includes(key) || key.includes(normalize(m.name)))
  );
}

function dumpForTemplate(manifest: TemplateManifest) {
  const text: TextPlacement[] = [];
  const images: ImagePlacement[] = [];
  for (const section of manifest.sections) {
    if (CHROME_ROLES.has(section.role)) continue; // same exclusion the real generation pipeline uses
    const ref = { id: section.id, templateId: section.templateId, role: section.role };
    for (const slot of section.slots) text.push(textPlacementFromSlot(slot, ref, "content"));
    section.photoSlots.forEach((photo, index) => {
      images.push(imagePlacementFromPhotoSlot(photo, index, ref, "content", "", manifest.industry ?? manifest.category ?? "this business"));
    });
  }

  const file = PlacementsFileSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    vertical: manifest.industry ?? manifest.category ?? "unknown",
    templateId: manifest.templateId,
    templateName: manifest.name,
    generatedAt: new Date().toISOString(),
    pageOrder: ["content"],
    pages: { content: PagePlacementsSchema.parse({ page: "content", text, images }) },
  });

  return { file, view: buildLlmView(file) };
}

async function main(): Promise<void> {
  const sourceDir = process.argv[2];
  const outDirArg = process.argv[3];
  if (!sourceDir) {
    console.error('Usage: npx tsx scripts/dump-corpus-placements.ts "<source folder>" [outDir]');
    process.exit(1);
  }

  const store = templateStore();
  const index = await store.index();
  const all: TemplateManifest[] = [];
  for (const templateId of new Set(index.sections.map((s) => s.templateId))) {
    const m = await store.manifest(templateId);
    if (m) all.push(m);
  }

  const folders = (await fs.readdir(sourceDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  console.log(`[dump] ${folders.length} source folder(s) in ${sourceDir}`);

  let ok = 0;
  let missing = 0;
  for (const folder of folders) {
    const manifest = findManifestForFolder(folder, all);
    if (!manifest) {
      console.log(`[dump] SKIP  ${folder} — no ingested manifest found (run npm run templates:ingest first)`);
      missing += 1;
      continue;
    }
    const { file, view } = dumpForTemplate(manifest);
    const outDir = outDirArg ? path.join(outDirArg, folder) : path.join(sourceDir, folder);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "placements.json"), JSON.stringify(file, null, 2), "utf8");
    await fs.writeFile(path.join(outDir, "placements.llm.json"), JSON.stringify(view, null, 2), "utf8");
    const fieldCount = file.pages.content!.text.length + file.pages.content!.images.length;
    const editableCount = [...file.pages.content!.text, ...file.pages.content!.images].filter(
      (p) => p.fillSource === "llm" || p.fillSource === "llmQuery"
    ).length;
    console.log(`[dump] OK    ${folder.padEnd(35)} ${manifest.templateId} — ${fieldCount} fields (${editableCount} editable)`);
    ok += 1;
  }

  console.log(`[dump] done — ${ok} written, ${missing} skipped (not yet ingested)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
