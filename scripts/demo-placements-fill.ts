/**
 * Proves the placements pipeline end to end, without a real LLM call: synthesizes deliberately
 * ADVERSARIAL "model output" (some values 3x too long, some empty/too-short) for every `llm`
 * placement, a couple of fake `data` overrides, and a whole fake business `brief` — then runs
 * `applyPlacements` for real against every page of one template and writes `<page>.filled.html`
 * next to the original (same folder, so relative `assets/css/...` links keep working — open it
 * straight in a browser to compare against the untouched `<page>.html`).
 *
 * This is a dev/QA tool, not part of the shipped pipeline — see `real-estate/PLACEMENTS_SCHEMA.md`
 * for what a REAL LLM integration sends/receives.
 *
 *   npx tsx scripts/demo-placements-fill.ts [templateId]   # default: real-estate-agency
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  PlacementsFileSchema,
  type ImagePlacement,
  type PagePlacements,
  type PlacementsFile,
  type TextPlacement,
} from "../src/templates/placements/schema.js";
import { applyPlacements, type ApplyPlacementsOptions, type ClampNote } from "../src/templates/placements/fill.js";

const templateId = process.argv[2] ?? "real-estate-agency";
const templateDir = path.resolve(process.cwd(), "real-estate", templateId);

const FAKE_BRIEF = {
  businessName: "Bay Breeze Realty",
  tagline: "Coastal homes, straightforward advice",
  phone: "(510) 555-0199",
  email: "hello@baybreezerealty.com",
  address: "220 Harbor View Blvd, Alameda, CA",
  licenseNumber: "DRE #55501234",
  hours: "Mon - Sat: 9:00am - 6:00pm",
};

/** Deliberately adversarial per-placement value: cycles through "way too long" (must be
 *  truncated), "way too short" (must be rejected, original kept), and "normal" (a visibly
 *  different but well-behaved rewrite) so one run exercises every branch in `fill.ts`. */
function stressValue(original: string, maxChars: number, index: number): string {
  const mode = index % 4;
  if (mode === 0) {
    const filler =
      " — and honestly, when you really stop to think about it, this is genuinely one of the most remarkable, truly outstanding things we have ever had the pleasure of offering to absolutely anyone, ever, in the history of this entire business.";
    return `${original}${filler}`.repeat(2).slice(0, maxChars * 4);
  }
  if (mode === 1) return "Hi";
  return `[NEW] ${original}`;
}

function buildLlmValues(file: PlacementsFile): Record<string, string> {
  const values: Record<string, string> = {};
  let i = 0;
  for (const page of Object.values(file.pages)) {
    for (const p of page.text) {
      if (p.fillSource !== "llm") continue;
      values[p.id] = stressValue(p.original, p.constraints.maxChars, i++);
    }
  }
  return values;
}

/** Overrides exactly the first property-card price/title and the first agent-roster name, so the
 *  `data` resolver path is visibly exercised too — every other `data` placement returns null and
 *  correctly falls back to the template's own demo content (the documented default). */
function makeDataResolver(): ApplyPlacementsOptions["resolveData"] {
  const overrides: Record<string, string> = {
    "home.featured.0.price": "$2,695,000",
    "home.featured.0.title": "Sunset Ridge Retreat",
    "agents.roster.0.name": "Jordan Blake",
  };
  return async (placement: TextPlacement | ImagePlacement) => overrides[placement.id] ?? null;
}

async function main(): Promise<void> {
  const raw = JSON.parse(await fs.readFile(path.join(templateDir, "placements.json"), "utf8"));
  const file = PlacementsFileSchema.parse(raw);
  const llmValues = buildLlmValues(file);
  const resolveData = makeDataResolver();

  const allClamped: ClampNote[] = [];
  let totalApplied = 0;

  for (const pageFile of file.pageOrder) {
    const pageSet = file.pages[pageFile];
    const chrome = file.pages.chrome;
    if (!pageSet || !chrome) continue;

    const merged: PagePlacements = {
      page: pageFile,
      text: [...chrome.text, ...pageSet.text],
      images: [...chrome.images, ...pageSet.images],
    };

    const html = await fs.readFile(path.join(templateDir, pageFile), "utf8");
    const result = await applyPlacements(html, merged, { brief: FAKE_BRIEF, resolveData, llmValues });
    allClamped.push(...result.clamped);
    totalApplied += result.appliedText + result.appliedImages;

    const outFile = pageFile.replace(/\.html$/, ".filled.html");
    await fs.writeFile(path.join(templateDir, outFile), result.html, "utf8");
    console.log(
      `[demo] ${pageFile.padEnd(22)} text=${result.appliedText} images=${result.appliedImages} ` +
        `clamped=${result.clamped.length} skipped=${result.skipped.length} rejectedFixed=${result.rejectedFixed.length} -> ${outFile}`
    );
  }

  console.log(`\n[demo] ${totalApplied} values applied across ${file.pageOrder.length} pages`);
  console.log(`[demo] ${allClamped.length} clamp events (proof the length budget was enforced, not just declared):`);
  for (const note of allClamped.slice(0, 12)) console.log(`  - ${note.id}: ${note.reason}`);
  if (allClamped.length > 12) console.log(`  ... and ${allClamped.length - 12} more`);
  console.log(`\nOpen real-estate/${templateId}/index.filled.html in a browser and compare it to index.html.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
