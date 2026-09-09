/**
 * The real round trip, no synthesized data: `placements.llm.json` -> a real OpenRouter call (via
 * this project's own `src/llm/client.ts`, the same client every other agent in the pipeline uses)
 * -> `fill.ts`. One call per page (each page's own editable-field payload is small; a single
 * whole-template call would risk truncating against OpenRouter's max_tokens cap — see
 * `src/llm/token-budget.ts`'s per-provider clamp).
 *
 * Writes `<page>.generated.html` next to each original (same folder, relative asset links keep
 * working). Dev/QA tool, not part of the shipped pipeline.
 *
 *   npx tsx scripts/generate-real-site.ts [templateId]   # default: real-estate-agency
 */
import "../src/load-env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { llm } from "../src/llm/client.js";
import { chatJsonWithRetry } from "../src/llm/json-agent.js";
import {
  PlacementsFileSchema,
  type ImagePlacement,
  type PagePlacements,
  type TextPlacement,
} from "../src/templates/placements/schema.js";
import { applyPlacements } from "../src/templates/placements/fill.js";
import { applyFlatLlmResponse, buildFlatPromptPayload, buildLlmView, type LlmTemplateView } from "../src/templates/placements/llm-view.js";

const templateId = process.argv[2] ?? "real-estate-agency";
const templateDir = path.resolve(process.cwd(), "real-estate", templateId);

const BRIEF = {
  businessName: "Bay Breeze Realty",
  tagline: "Coastal homes, straightforward advice",
  phone: "(510) 555-0199",
  email: "hello@baybreezerealty.com",
  address: "220 Harbor View Blvd, Alameda, CA",
  licenseNumber: "DRE #55501234",
  hours: "Mon - Sat: 9:00am - 6:00pm",
};

const BUSINESS_SUMMARY = `Bay Breeze Realty is a boutique residential brokerage covering Alameda, Oakland, and the East Bay
waterfront communities. Founded by two former teachers who got tired of watching first-time buyers
get outbid and confused, the team focuses on patient, plain-English guidance rather than
high-pressure sales. Known locally for weekend "open house crawl" tours and a free first-time-buyer
class held monthly at the Alameda library. Tone: warm, direct, a little informal — never corporate.`;

const SYSTEM_PROMPT = `You are a copywriter filling in the real content for one page of a real business's website.

You will receive a short business summary and a JSON object shaped {"<id>": {"current": "...", ...}}
— one entry per piece of text or photo that needs your answer. "current" is the placeholder text it
will replace; a text entry also has "minChars"/"maxChars"; an image entry has "aspectRatio"/"subject"
instead (answer with a short plain-English stock-photo search query, 2-6 words, never a URL).

Return ONLY a JSON object shaped {"values": {"<id>": "<your answer>", ...}} — the exact same ids you
were given, each mapped to a plain string. Do not add, remove, or rename any id, and do not add any
other top-level key. Do not wrap the JSON in markdown fences or add any other text.

Rules:
- Sound like this specific business — warm, direct, plain-English. Never generic template
  boilerplate ("We're passionate about excellence...").
- Stay at or under maxChars for every text field — a value that doesn't fit will be truncated
  automatically, so a shorter answer that reads well beats a longer one that gets cut off.
- Never invent a specific price, a specific street address, an exact statistic, or a named customer
  quote — you will not be given any fields like that; if you somehow are, leave "current" as the
  value rather than inventing one.`;

function buildUserPrompt(pageKey: string, payload: unknown, parseError?: string): string {
  const retrySuffix = parseError
    ? `\n\nYour previous response was not valid JSON matching the required shape (${parseError}). Return ONLY the JSON object, no prose, no markdown fences.`
    : "";
  return `Business summary:\n${BUSINESS_SUMMARY}\n\nPage: ${pageKey}\n\nFields to fill:\n${JSON.stringify(payload)}${retrySuffix}`;
}

async function fillPageWithRealLlm(view: LlmTemplateView, pageKey: string): Promise<Record<string, string>> {
  const page = view.pages[pageKey];
  if (!page) return {};
  const payload = buildFlatPromptPayload(page);
  if (Object.keys(payload).length === 0) return {};

  const response = await chatJsonWithRetry(
    `real-site-fill:${pageKey}`,
    SYSTEM_PROMPT,
    (parseError) => buildUserPrompt(pageKey, payload, parseError),
    { tokenRole: "page", model: llm.getCompositionModel(), initialTemperature: 0.7 },
    (raw) => JSON.parse(raw) as unknown
  );

  const scopedView: LlmTemplateView = { template: view.template, pages: { [pageKey]: page } };
  return applyFlatLlmResponse(scopedView, response);
}

async function main(): Promise<void> {
  if (!llm.isAvailable) {
    throw new Error("No LLM configured — set OPENROUTER_API_KEY (or another provider key) in .env");
  }
  console.log(`[real-fill] provider=${llm.provider} model=${llm.getCompositionModel()}`);

  const raw = JSON.parse(await fs.readFile(path.join(templateDir, "placements.json"), "utf8"));
  const file = PlacementsFileSchema.parse(raw);
  const view = buildLlmView(file);

  const llmValues: Record<string, string> = {};
  for (const pageKey of ["chrome", ...file.pageOrder]) {
    if (!view.pages[pageKey]) continue;
    try {
      const values = await fillPageWithRealLlm(view, pageKey);
      Object.assign(llmValues, values);
      console.log(`[real-fill] ${pageKey.padEnd(22)} ${Object.keys(values).length} field(s) filled by ${llm.provider}`);
    } catch (err) {
      console.warn(`[real-fill] ${pageKey.padEnd(22)} FAILED (${err instanceof Error ? err.message : String(err)}) — keeping template's own copy for this page`);
    }
  }

  console.log(`\n[real-fill] ${Object.keys(llmValues).length} total values from the real model — writing pages...\n`);

  const overrides: Record<string, string> = {
    "home.featured.0.price": "$1,895,000",
    "home.featured.0.title": "Sunset Ridge Cottage",
    "agents.roster.0.name": "Jordan Blake",
  };
  const resolveData = async (placement: TextPlacement | ImagePlacement) => overrides[placement.id] ?? null;

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
    const result = await applyPlacements(html, merged, { brief: BRIEF, resolveData, llmValues });

    const outFile = pageFile.replace(/\.html$/, ".generated.html");
    await fs.writeFile(path.join(templateDir, outFile), result.html, "utf8");
    console.log(
      `[real-fill] ${pageFile.padEnd(22)} text=${result.appliedText} images=${result.appliedImages} ` +
        `clamped=${result.clamped.length} -> ${outFile}`
    );
    if (result.clamped.length > 0) {
      for (const note of result.clamped) console.log(`               - ${note.id}: ${note.reason}`);
    }
  }

  console.log(`\n[real-fill] cost estimate: $${llm.getEstimatedCostUsd().toFixed(4)}`);
  console.log(`\nOpen real-estate/${templateId}/index.generated.html in a browser.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
