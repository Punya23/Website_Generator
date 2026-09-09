/**
 * CLI: regenerate `placements.json` for every template under `real-estate/`.
 *
 *   npm run templates:placements:real-estate
 *
 * Safe to re-run any time `real-estate-map.ts` or a template's own HTML/CSS changes — output is
 * fully deterministic from the source files, and a selector that no longer resolves to exactly one
 * element fails the run loudly (see `extract.ts`) rather than shipping a wrong or stale map.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { extractRealEstateTemplate } from "./extract.js";
import { buildLlmView } from "./llm-view.js";

const REAL_ESTATE_DIR = path.resolve(process.cwd(), "real-estate");
const TEMPLATE_FOLDERS = ["real-estate-agency", "luxury-real-estate", "commercial-real-estate", "property-management"];

export async function generateRealEstatePlacements(
  options: { onProgress?: (line: string) => void } = {}
): Promise<{ templateId: string; textCount: number; imageCount: number; editableCount: number; outPath: string }[]> {
  const log = options.onProgress ?? ((line: string) => console.log(line));
  const results: { templateId: string; textCount: number; imageCount: number; editableCount: number; outPath: string }[] = [];

  for (const folder of TEMPLATE_FOLDERS) {
    const dir = path.join(REAL_ESTATE_DIR, folder);
    const file = await extractRealEstateTemplate(dir, folder);
    const textCount = Object.values(file.pages).reduce((n, p) => n + p.text.length, 0);
    const imageCount = Object.values(file.pages).reduce((n, p) => n + p.images.length, 0);
    const editableCount =
      Object.values(file.pages).reduce((n, p) => n + p.text.filter((t) => t.fillSource === "llm").length, 0) +
      Object.values(file.pages).reduce((n, p) => n + p.images.filter((i) => i.fillSource === "llmQuery").length, 0);

    const outPath = path.join(dir, "placements.json");
    await fs.writeFile(outPath, JSON.stringify(file, null, 2), "utf8");

    // The actual deliverable for an LLM integration: nested by page -> section -> field, editable
    // decided per field, none of the internal selector/fillSource wiring — see llm-view.ts and
    // real-estate/PLACEMENTS_SCHEMA.md.
    const llmViewPath = path.join(dir, "placements.llm.json");
    await fs.writeFile(llmViewPath, JSON.stringify(buildLlmView(file), null, 2), "utf8");

    results.push({ templateId: folder, textCount, imageCount, editableCount, outPath });
    log(
      `[placements] ${folder}: ${textCount} text + ${imageCount} image placements (${editableCount} editable by an LLM) ` +
        `-> ${path.relative(process.cwd(), outPath)}, ${path.relative(process.cwd(), llmViewPath)}`
    );
  }

  const totalText = results.reduce((n, r) => n + r.textCount, 0);
  const totalImages = results.reduce((n, r) => n + r.imageCount, 0);
  log(`[placements] done — ${totalText} text + ${totalImages} image placements across ${results.length} templates`);
  return results;
}

const isDirectRun = process.argv[1] && process.argv[1].includes("generate-real-estate");
if (isDirectRun) {
  generateRealEstatePlacements().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
