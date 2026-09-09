/**
 * Proves the FULL placements contract end to end, without a real LLM call:
 *
 *   placements.llm.json -> buildPromptPayload (what actually goes to OpenRouter)
 *                        -> [here: synthesize adversarial "model output" instead of a real call]
 *                        -> applyLlmResponse (back to real placement ids)
 *                        -> fill.ts's applyPlacements (unchanged — clamps/rejects, writes markup)
 *
 * The synthesized "model output" is deliberately adversarial: some values 3x too long (must be
 * truncated), some empty/too-short (must be rejected, original kept), the rest a visibly different
 * normal rewrite — cycled across every editable field, on the REAL nested shape a model would
 * actually return, so this exercises the whole round trip, not just fill.ts in isolation.
 *
 * Writes `<page>.filled.html` next to each original (same folder, so relative `assets/css/...`
 * links keep working — open it straight in a browser to compare against the untouched original).
 * Dev/QA tool, not part of the shipped pipeline — see `real-estate/PLACEMENTS_SCHEMA.md`.
 *
 *   npx tsx scripts/demo-placements-fill.ts [templateId]   # default: real-estate-agency
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  PlacementsFileSchema,
  type ImagePlacement,
  type PagePlacements,
  type TextPlacement,
} from "../src/templates/placements/schema.js";
import { applyPlacements, type ApplyPlacementsOptions, type ClampNote } from "../src/templates/placements/fill.js";
import { applyLlmResponse, buildLlmView, buildPromptPayload, type PromptPayload, type PromptSection } from "../src/templates/placements/llm-view.js";

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

/** Deliberately adversarial per-field value: cycles through "way too long" (must be truncated),
 *  "way too short" (must be rejected, original kept), and "normal" (a visibly different but
 *  well-behaved rewrite) so one run exercises every branch in `fill.ts`. */
function stressValue(current: string, maxChars: number, index: number): string {
  const mode = index % 4;
  if (mode === 0) {
    const filler =
      " — and honestly, when you really stop to think about it, this is genuinely one of the most remarkable, truly outstanding things we have ever had the pleasure of offering to absolutely anyone, ever, in the history of this entire business.";
    return `${current}${filler}`.repeat(2).slice(0, maxChars * 4);
  }
  if (mode === 1) return "Hi";
  return `[NEW] ${current}`;
}

/** Walks a `PromptSection` (the exact shape a model receives) and produces a matching "answer" in
 *  the exact shape `applyLlmResponse` expects back — a real integration replaces this whole
 *  function with one OpenRouter call. */
function stressSection(section: PromptSection, next: () => number): { fields?: Record<string, string>; instances?: Array<Record<string, string>> } {
  const out: { fields?: Record<string, string>; instances?: Array<Record<string, string>> } = {};
  if (section.fields) {
    out.fields = Object.fromEntries(
      Object.entries(section.fields).map(([key, field]) => [
        key,
        field.type === "text" ? stressValue(field.current, field.maxChars ?? 200, next()) : field.current,
      ])
    );
  }
  if (section.instances) {
    out.instances = section.instances.map((instance) =>
      Object.fromEntries(
        Object.entries(instance).map(([key, field]) => [
          key,
          field.type === "text" ? stressValue(field.current, field.maxChars ?? 200, next()) : field.current,
        ])
      )
    );
  }
  return out;
}

function buildFakeModelResponse(prompt: PromptPayload): unknown {
  let counter = 0;
  const next = () => counter++;
  const pages: Record<string, { sections: Record<string, unknown> }> = {};
  for (const [pageKey, page] of Object.entries(prompt.pages)) {
    const sections: Record<string, unknown> = {};
    for (const [sectionKey, section] of Object.entries(page.sections)) sections[sectionKey] = stressSection(section, next);
    pages[pageKey] = { sections };
  }
  return { pages };
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

  // The actual contract: build the LLM-facing view, derive the prompt payload (what a real
  // OpenRouter call would receive), synthesize a fake nested answer in that same shape, then
  // resolve it back to real placement ids — exactly what a real integration's response-handling
  // code would do with the model's real JSON reply.
  const view = buildLlmView(file);
  const prompt = buildPromptPayload(view);
  const fakeResponse = buildFakeModelResponse(prompt);
  const llmValues = applyLlmResponse(view, fakeResponse);

  console.log(
    `[demo] prompt payload: ${JSON.stringify(prompt).length} bytes (vs ${JSON.stringify(view).length} for the full ` +
      `placements.llm.json) — nav-shaped sections are absent because nothing in them is ever editable`
  );
  console.log(`[demo] resolved ${Object.keys(llmValues).length} values from the fake model response back to real placement ids\n`);

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
