/**
 * The real round trip, no synthesized data: a business brief -> `placements.llm.json` -> a real
 * OpenRouter call (via this project's own `src/llm/client.ts`, the same client every other agent in
 * the pipeline uses) -> `fill.ts`. One call per page (each page's own editable-field payload is
 * small; a single whole-template call would risk truncating against OpenRouter's max_tokens cap —
 * see `src/llm/token-budget.ts`'s per-provider clamp).
 *
 * Writes `<page>.generated.html` next to each original (same folder, relative asset links keep
 * working). Dev/QA tool, not part of the shipped pipeline.
 *
 *   npx tsx scripts/generate-real-site.ts [templateId] ["<raw business brief>"]
 *
 * `templateId` is one of the four folders under `real-estate/` (default: real-estate-agency). The
 * brief is free text, same shape this project's own `expandBrief` already accepts elsewhere in the
 * pipeline — a line or two is enough ("Golden Gate Realty, a family-run agency in San Francisco
 * specializing in first-time buyers..."). Omit it to run the built-in demo business. Contact details
 * (phone/email/address) are pulled out of the SAME raw text if present — never invented; a business
 * fact with nothing found in the brief is left as the template's own demo value, same as any other
 * `data`/`brief` placement with nothing to resolve to.
 */
import "../src/load-env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { llm } from "../src/llm/client.js";
import { chatJsonWithRetry } from "../src/llm/json-agent.js";
import { expandBrief, expandBriefFromInput, briefToContext } from "../src/agents/expand-brief-agent.js";
import { STREET_ADDRESS_RE } from "../src/templates/filler-patterns.js";
import {
  PlacementsFileSchema,
  type ImagePlacement,
  type PagePlacements,
  type TextPlacement,
} from "../src/templates/placements/schema.js";
import type { PlacementBrief } from "../src/templates/placements/fill.js";
import { applyPlacements } from "../src/templates/placements/fill.js";
import { applyFlatLlmResponse, buildFlatPromptPayload, buildLlmView, type LlmTemplateView } from "../src/templates/placements/llm-view.js";

const templateId = process.argv[2] ?? "real-estate-agency";
const templateDir = path.resolve(process.cwd(), "real-estate", templateId);
const rawBrief = process.argv[3]?.trim();

const DEMO_BRIEF = `Bay Breeze Realty is a boutique residential brokerage covering Alameda, Oakland, and the East Bay
waterfront communities. Founded by two former teachers who got tired of watching first-time buyers
get outbid and confused, the team focuses on patient, plain-English guidance rather than
high-pressure sales. Known locally for weekend "open house crawl" tours and a free first-time-buyer
class held monthly at the Alameda library. Tone: warm, direct, a little informal — never corporate.
Phone (510) 555-0199, hello@baybreezerealty.com, 220 Harbor View Blvd, Alameda, CA.`;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const HOURS_RE = /\b(?:hours?|open)\s*[:\-]?\s*([^.\n]{6,60})/i;
const LICENSE_RE = /\b((?:DRE|CalBRE|License)\s*#?\s*[\w-]{4,15})/i;

/** Pulls exactly the contact details a raw brief happens to state — never invents one that isn't
 *  there. Anything not found is simply absent from the returned `PlacementBrief`, which `fill.ts`
 *  already treats as "nothing to resolve" and leaves the template's own demo value untouched. */
function extractContactFromBrief(text: string): Partial<PlacementBrief> {
  const out: Partial<PlacementBrief> = {};
  const email = text.match(EMAIL_RE)?.[0];
  if (email) out.email = email;
  const phone = text.match(PHONE_RE)?.[0]?.trim();
  if (phone && phone.replace(/\D/g, "").length >= 7) out.phone = phone;
  const addressMatch = text.match(STREET_ADDRESS_RE);
  if (addressMatch && addressMatch.index !== undefined) {
    // STREET_ADDRESS_RE (shared with the leak-detection pass elsewhere) matches just the street
    // line and stops at the first comma — a real mailing address usually continues ", City, ST",
    // so extend through the rest of that sentence rather than truncating "220 Harbor View Blvd,
    // Alameda, CA" down to "220 Harbor View Blvd" (which then fails the box's own minChars check
    // and silently falls back to the template's demo address instead of the real one).
    const address = text
      .slice(addressMatch.index)
      .match(/^[^.\n]{1,80}/)?.[0]
      ?.trim();
    if (address) out.address = address;
  }
  const hours = text.match(HOURS_RE)?.[1]?.trim();
  if (hours) out.hours = hours;
  const license = text.match(LICENSE_RE)?.[1]?.trim();
  if (license) out.licenseNumber = license;
  return out;
}

/** Expands the raw brief the same way the main pipeline does (richer businessName/tagline/services/
 *  tone via a real LLM call), falling back to the deterministic no-LLM expansion on failure — same
 *  resilience `expand-brief-agent.ts` itself already relies on. */
async function resolveBriefContext(text: string): Promise<{ brief: PlacementBrief; summary: string }> {
  let expanded;
  try {
    expanded = await expandBrief(text);
  } catch {
    expanded = expandBriefFromInput(text);
  }
  const contact = extractContactFromBrief(text);
  return {
    brief: { businessName: expanded.businessName, tagline: expanded.tagline, ...contact },
    summary: briefToContext(expanded),
  };
}

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

function buildUserPrompt(pageKey: string, summary: string, payload: unknown, parseError?: string): string {
  const retrySuffix = parseError
    ? `\n\nYour previous response was not valid JSON matching the required shape (${parseError}). Return ONLY the JSON object, no prose, no markdown fences.`
    : "";
  return `Business summary:\n${summary}\n\nPage: ${pageKey}\n\nFields to fill:\n${JSON.stringify(payload)}${retrySuffix}`;
}

async function fillPageWithRealLlm(view: LlmTemplateView, pageKey: string, summary: string): Promise<Record<string, string>> {
  const page = view.pages[pageKey];
  if (!page) return {};
  const payload = buildFlatPromptPayload(page);
  if (Object.keys(payload).length === 0) return {};

  const response = await chatJsonWithRetry(
    `real-site-fill:${pageKey}`,
    SYSTEM_PROMPT,
    (parseError) => buildUserPrompt(pageKey, summary, payload, parseError),
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

  const { brief, summary } = await resolveBriefContext(rawBrief && rawBrief.length > 0 ? rawBrief : DEMO_BRIEF);
  console.log(`[real-fill] business="${brief.businessName}" ${rawBrief ? "(from your brief)" : "(demo)"}`);

  const raw = JSON.parse(await fs.readFile(path.join(templateDir, "placements.json"), "utf8"));
  const file = PlacementsFileSchema.parse(raw);
  const view = buildLlmView(file);

  const llmValues: Record<string, string> = {};
  for (const pageKey of ["chrome", ...file.pageOrder]) {
    if (!view.pages[pageKey]) continue;
    try {
      const values = await fillPageWithRealLlm(view, pageKey, summary);
      Object.assign(llmValues, values);
      console.log(`[real-fill] ${pageKey.padEnd(22)} ${Object.keys(values).length} field(s) filled by ${llm.provider}`);
    } catch (err) {
      console.warn(`[real-fill] ${pageKey.padEnd(22)} FAILED (${err instanceof Error ? err.message : String(err)}) — keeping template's own copy for this page`);
    }
  }

  console.log(`\n[real-fill] ${Object.keys(llmValues).length} total values from the real model — writing pages...\n`);

  // No real listings/roster feed exists yet (see PLACEMENTS_SCHEMA.md) — this is the ONE stand-in
  // example proving the `data` resolver path works, matching what `demo-placements-fill.ts` does.
  // Every other `data` placement correctly falls back to the template's own demo content below.
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
    const result = await applyPlacements(html, merged, {
      brief,
      resolveData,
      llmValues,
      templateBusinessName: file.templateName,
    });

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
