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
 * (phone/email/address) are pulled out of the SAME raw text if present.
 *
 * Every placement gets a value one way or another — nothing ships still naming the TEMPLATE's own
 * demo business:
 *  - `llm` fields: real marketing copy, written for this business.
 *  - `data`/`brief` fields with real input (a supplied phone/address, an actual listing): that
 *    real value, verbatim.
 *  - `data`/`brief` fields with no real input, INCLUDING a fictional agent's name/role and a
 *    fictional testimonial's quote/author (explicit product decision — a named fictional person is
 *    already standard demo-site content, same as the template's own unmodified "Jennifer Lawson,
 *    Homebuyer, Palo Alto"; this only re-contextualizes it to the real business instead of leaving
 *    the wrong one's): a plausible, brief-consistent EXAMPLE (illustrative, not verified) — a Pune
 *    address, an INR price, an Indian name, instead of the wrong template's Palo Alto/USD/Jennifer
 *    Lawson one. See `PEOPLE_ROLES` for the one role still excluded, and why.
 *  - phone/email with no real input: an obvious, non-dialable/non-mailable placeholder — never an
 *    LLM-plausible one that could coincide with an actual stranger's number or inbox. The FORMAT
 *    (country code/grouping) is brief-aware (`resolveLocale`); the digits are always zero, enforced
 *    in `fill.ts` regardless of what format string reaches it. The same `resolveLocale` call also
 *    fixes the currency `example_fields` answers use (see `buildUserPrompt`'s `LOCALE:` line) —
 *    stated once and reused for every page, the same fix `summary` already is for tone drift.
 *  - a real photo (agent headshot, testimonial avatar) with no real input: unaffected either way —
 *    these stay `fillSource: "data"` (see `real-estate-map.ts`) — the template's own stock photo,
 *    never a model-invented or stock-searched stand-in for a specific named person. A handful of
 *    other, non-person photo slots (hero/page-banner backgrounds, the about-page photo) ARE now
 *    `llmQuery` and resolve through a real stock-image provider — see `resolveImageQueries`.
 */
import "../src/load-env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { llm } from "../src/llm/client.js";
import { chatJsonWithRetry } from "../src/llm/json-agent.js";
import { expandBrief, expandBriefFromInput, briefToContext } from "../src/agents/expand-brief-agent.js";
import { STREET_ADDRESS_RE } from "../src/templates/filler-patterns.js";
import { PlacementsFileSchema, type BriefField, type PagePlacements } from "../src/templates/placements/schema.js";
import type { PlacementBrief } from "../src/templates/placements/fill.js";
import { applyPlacements } from "../src/templates/placements/fill.js";
import {
  applyFlatLlmResponse,
  buildFlatPromptPayload,
  buildLlmView,
  flatKeysSchema,
  type FlatPromptField,
  type LlmTemplateView,
} from "../src/templates/placements/llm-view.js";
import { stockImageUrl } from "../src/media/stock-images.js";

const templateId = process.argv[2] ?? "real-estate-agency";
const templateDir = path.resolve(process.cwd(), "real-estate", templateId);
const rawBrief = process.argv[3]?.trim();

const DEMO_BRIEF = `Bay Breeze Realty is a boutique residential brokerage covering Alameda, Oakland, and the East Bay
waterfront communities. Founded by two former teachers who got tired of watching first-time buyers
get outbid and confused, the team focuses on patient, plain-English guidance rather than
high-pressure sales. Known locally for weekend "open house crawl" tours and a free first-time-buyer
class held monthly at the Alameda library. Tone: warm, direct, a little informal — never corporate.
Phone (510) 555-0199, hello@baybreezerealty.com, 220 Harbor View Blvd, Alameda, CA.`;

/** Explicit user decision, overriding this script's original stricter default: a fictional
 *  customer/agent NAME and a fictional testimonial QUOTE are standard demo-site content (the
 *  template already ships fictional named people paired with randomuser.me stock photos — this
 *  only re-contextualizes the same kind of fiction to the real business, e.g. an Indian name for an
 *  Indian brokerage, instead of leaving the template's own unrelated one). The photos themselves are
 *  untouched either way — no stock-photo provider is wired into this script, so every avatar/
 *  headshot stays the template's own regardless of this set.
 *
 *  `agentContact` alone stays excluded: it is a phone number (bundled with an email) in prose form,
 *  the one shape this script still refuses to let an LLM invent — see `fill.ts`'s own doc comment
 *  on `placeholderPhone` for why a fake-but-plausible number is a different risk tier than a fake
 *  name or fake quote. It keeps the template's own demo contact, brand-swapped only. */
const PEOPLE_ROLES = new Set(["agentContact"]);

/** Heuristic only — decides the FORMAT of the non-dialable phone placeholder (which stays all
 *  zeros regardless, enforced in fill.ts) and which currency an `example_fields` answer (a listing
 *  price, a business stat) should use, not whether any real number is invented. Extend this list
 *  rather than trying to be clever about locale detection; a false negative just falls back to the
 *  US-shaped default, which is no less safe, only less obviously on-tone. */
const INDIA_HINT_RE = /\b(india|bharat|maharashtra|pune|mumbai|bengaluru|bangalore|delhi|hyderabad|chennai|kolkata|gujarat|karnataka|rera|₹|\binr\b)\b/i;

interface Locale {
  phoneFormat: string;
  /** Stated explicitly to the model as its own line in every page's prompt (see `buildUserPrompt`)
   *  — SYSTEM_PROMPT's "right city, right currency" rule used to rely on the model inferring this
   *  from whatever the free-text business summary happened to mention, which is exactly the kind
   *  of per-page-independent guess that drifts across pages/calls. One resolved value, reused for
   *  every page the same way `summary` already is, closes that gap without a second LLM call. */
  currencyLabel: string;
}

function resolveLocale(rawBriefText: string): Locale {
  return INDIA_HINT_RE.test(rawBriefText)
    ? { phoneFormat: "+91 00000 00000", currencyLabel: "Indian Rupees (₹), Indian numbering (e.g. ₹85 lakh, ₹1.2 crore)" }
    : { phoneFormat: "+1 (000) 000-0000", currencyLabel: "US Dollars ($)" };
}

/** Mirrors `fill.ts`'s own `BRIEF_ILLUSTRATIVE_FIELDS` — kept in sync manually since one lives in
 *  the enforcement layer and this one only decides what to ASK an LLM for. phone/email are handled
 *  by `fill.ts`'s own deterministic placeholder (never LLM-plausible — see its doc comment);
 *  licenseNumber is never fabricated at all, plausible or not. */
const BRIEF_ILLUSTRATIVE_FIELDS = new Set<BriefField>(["address", "hours"]);

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const HOURS_RE = /\b(?:hours?|open)\s*[:\-]?\s*([^.\n]{6,60})/i;
const LICENSE_RE = /\b((?:DRE|CalBRE|License)\s*#?\s*[\w-]{4,15})/i;

/** Pulls exactly the contact details a raw brief happens to state — never invents one that isn't
 *  there. Anything not found is simply absent from the returned `PlacementBrief`; `fill.ts` decides
 *  what happens next for each missing field (a deterministic placeholder for phone/email, an
 *  illustrative example for address/hours, nothing at all for licenseNumber). */
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
    // Alameda, CA" down to "220 Harbor View Blvd" (which then fails the box's own minChars check).
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

const SYSTEM_PROMPT = `You are filling in the real content for one page of a real business's website.

You will receive a business summary and a JSON object with two keys:
- "copy_fields": real marketing copy to write for this business — headlines, section text, service
  descriptions, and so on. Each entry has "current" (a length/style reference only, not the answer)
  and either "minChars"/"maxChars" (text) or "aspectRatio"/"subject" (a photo — answer with a short
  plain-English stock-photo search query, 2-6 words, never a URL).
- "example_fields": placeholder EXAMPLES for real business facts nobody has supplied real data for
  yet (a listing price, a street address, a business stat, opening hours). Answer each with a
  plausible, believable example consistent with the business summary — right city, right currency,
  right scale. This is illustrative demo content, not verified data, but it should read like a
  normal, presentable placeholder, not look obviously fake or say "example"/"placeholder" in it.

Return ONLY {"copy_values": {"<id>": "<answer>", ...}, "example_values": {"<id>": "<answer>", ...}}
— the exact same ids you were given in each bucket, each mapped to a plain string. Include both keys
even if one of the input buckets was empty (then its value is just {}). Do not add, remove, or
rename any id, and do not add any other top-level key. Do not wrap the JSON in markdown fences or
add any other text.

Rules:
- Sound like this specific business — warm, direct, plain-English. Never generic real-estate
  boilerplate — avoid stock phrases like "your trusted partner", "passionate about excellence",
  "unparalleled service", "dream home", "where dreams meet reality", "your journey home starts
  here", "we go above and beyond". If a sentence would read the same on any other real-estate
  site regardless of business name, rewrite it around something specific from the business summary
  (an actual service, neighborhood, differentiator, or the stated tone) instead.
- Stay at or under maxChars for every text field — a value that doesn't fit will be truncated
  automatically, so a shorter answer that reads well beats a longer one that gets cut off.
- Never invent a customer's name, a customer quote, or a staff member's name — you will not be
  given any fields like that; if you somehow are, leave "current" as the value rather than
  inventing a person.`;

interface ExampleField {
  current: string;
  minChars: number;
  maxChars: number;
}

/** Every `data`/`brief` placement on this page that has no real value and is safe to ask an LLM to
 *  invent a plausible EXAMPLE for — excludes real-person roles (`PEOPLE_ROLES`) entirely. */
function buildExamplesPayload(pageSet: PagePlacements, brief: PlacementBrief): Record<string, ExampleField> {
  const out: Record<string, ExampleField> = {};
  for (const p of pageSet.text) {
    const eligibleData = p.fillSource === "data" && !PEOPLE_ROLES.has(p.role);
    const eligibleBrief = Boolean(p.fillSource === "brief" && p.briefField && BRIEF_ILLUSTRATIVE_FIELDS.has(p.briefField) && !brief[p.briefField]);
    if (!eligibleData && !eligibleBrief) continue;
    out[p.id] = { current: p.original, minChars: p.constraints.minChars, maxChars: p.constraints.maxChars };
  }
  return out;
}

/** `z.object(...).strict()` for every id in `ids`, each a required non-empty string — the runtime
 *  half of the coverage gate. `flatKeysSchema` (same id set) is the provider-side half, sent as
 *  `response_format: json_schema` so a compliant provider can't return the wrong key set at all;
 *  this is what still catches it on a provider/model that ignores or only loosely honors that
 *  (see `client.ts`'s own note: schema mode isn't universal, and even where honored isn't always
 *  strict) — `.parse()` throws `ZodError` on a missing/extra/empty key, which `chatJsonWithRetry`
 *  already retries on (`isRetryableOutputError` in `json-agent.ts`), so a page that comes back
 *  under-filled gets ONE more real attempt instead of silently shipping with template copy left in
 *  the gaps it didn't notice. */
function idsShape(ids: string[]): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  for (const id of ids) shape[id] = z.string().min(1);
  return shape;
}

function buildResponseValidator(copyFields: Record<string, FlatPromptField>, exampleFields: Record<string, ExampleField>) {
  return z
    .object({
      copy_values: z.object(idsShape(Object.keys(copyFields))).strict(),
      example_values: z.object(idsShape(Object.keys(exampleFields))).strict(),
    })
    .strict();
}

function buildResponseJsonSchema(copyFields: Record<string, FlatPromptField>, exampleFields: Record<string, ExampleField>) {
  return {
    name: "page_fill",
    schema: {
      type: "object",
      properties: {
        copy_values: flatKeysSchema(Object.keys(copyFields)),
        example_values: flatKeysSchema(Object.keys(exampleFields)),
      },
      required: ["copy_values", "example_values"],
      additionalProperties: false,
    },
    strict: true,
  };
}

function buildUserPrompt(
  pageKey: string,
  summary: string,
  locale: Locale,
  copyFields: unknown,
  exampleFields: unknown,
  parseError?: string
): string {
  const retrySuffix = parseError
    ? `\n\nYour previous response was not valid JSON matching the required shape (${parseError}). Return ONLY the JSON object, no prose, no markdown fences.`
    : "";
  // Stated once here, identically on every page's call — the same fix `summary` already is for
  // tone/service-list drift, applied to currency: without this line the model only sees whatever
  // the free-text business summary happens to mention, so two different pages (or a retry of the
  // same page) can land on two different currencies for the same business's example prices.
  return `Business summary:\n${summary}\n\nLOCALE: use ${locale.currencyLabel} for any price/currency example.\n\nPage: ${pageKey}\n\n{"copy_fields": ${JSON.stringify(copyFields)}, "example_fields": ${JSON.stringify(exampleFields)}}${retrySuffix}`;
}

/**
 * `copyValues` at this point holds the model's raw answer for every editable id — for a `type:
 * "image"` field (an `llmQuery` placement) that answer is a plain-English stock-photo search
 * query, per `SYSTEM_PROMPT`'s own instructions, NOT a URL. `fill.ts`'s `writeImage` (via
 * `applyPlacements`) treats every `llmValues` entry as a ready-to-write `src`/`background-image`
 * value regardless of placement kind — handing it a bare query string would write literal text
 * like `"wide establishing shot of..."` into an `<img src>`. Resolves each in place through this
 * pipeline's own stock-image provider (the same one `heroImageUrl` etc. already use) before
 * `copyValues` ever reaches `applyPlacements`.
 *
 * Seeded on `businessName:id` — stable across a retry or a re-run for the same business (so the
 * hero photo doesn't change every time the page is regenerated) while still varying per slot (the
 * hero background and the about-page photo don't collide on the same image).
 */
async function resolveImageQueries(
  copyValues: Record<string, string>,
  copyFields: Record<string, FlatPromptField>,
  brief: PlacementBrief
): Promise<void> {
  const imageIds = Object.keys(copyFields).filter((id) => copyFields[id]!.type === "image" && copyValues[id]);
  await Promise.all(
    imageIds.map(async (id) => {
      const field = copyFields[id]!;
      const seed = `${brief.businessName ?? "site"}:${id}`;
      copyValues[id] = await stockImageUrl(copyValues[id]!, seed, undefined, field.minWidthPx, field.minHeightPx);
    })
  );
}

async function fillPageWithRealLlm(
  view: LlmTemplateView,
  pageSet: PagePlacements,
  pageKey: string,
  summary: string,
  locale: Locale,
  brief: PlacementBrief
): Promise<{ copyValues: Record<string, string>; exampleValues: Record<string, string> }> {
  const page = view.pages[pageKey];
  const copyFields = page ? buildFlatPromptPayload(page) : {};
  const exampleFields = buildExamplesPayload(pageSet, brief);
  if (Object.keys(copyFields).length === 0 && Object.keys(exampleFields).length === 0) {
    return { copyValues: {}, exampleValues: {} };
  }

  const validator = buildResponseValidator(copyFields, exampleFields);
  const response = await chatJsonWithRetry(
    `real-site-fill:${pageKey}`,
    SYSTEM_PROMPT,
    (parseError) => buildUserPrompt(pageKey, summary, locale, copyFields, exampleFields, parseError),
    {
      tokenRole: "page",
      model: llm.getCompositionModel(),
      initialTemperature: 0.7,
      responseSchema: buildResponseJsonSchema(copyFields, exampleFields),
    },
    // Throws ZodError (retried by chatJsonWithRetry) on any missing, extra, or empty-string id —
    // the JSON-Schema response_format above already asks the provider not to do this; this is the
    // backstop for the provider/model combinations where that request isn't honored strictly.
    (raw) => validator.parse(JSON.parse(raw))
  );

  // Every id in copyFields/exampleFields is now guaranteed present as a non-empty string —
  // `validator.parse` above would have thrown (and been retried) otherwise.
  const copyValues = page
    ? applyFlatLlmResponse({ template: view.template, pages: { [pageKey]: page } }, { values: response.copy_values })
    : {};

  await resolveImageQueries(copyValues, copyFields, brief);

  return { copyValues, exampleValues: response.example_values };
}

async function main(): Promise<void> {
  if (!llm.isAvailable) {
    throw new Error("No LLM configured — set OPENROUTER_API_KEY (or another provider key) in .env");
  }
  console.log(`[real-fill] provider=${llm.provider} model=${llm.getCompositionModel()}`);

  const effectiveRawBrief = rawBrief && rawBrief.length > 0 ? rawBrief : DEMO_BRIEF;
  const { brief, summary } = await resolveBriefContext(effectiveRawBrief);
  const locale = resolveLocale(effectiveRawBrief);
  const placeholderPhone = locale.phoneFormat;
  console.log(`[real-fill] business="${brief.businessName}" ${rawBrief ? "(from your brief)" : "(demo)"}`);

  const raw = JSON.parse(await fs.readFile(path.join(templateDir, "placements.json"), "utf8"));
  const file = PlacementsFileSchema.parse(raw);
  const view = buildLlmView(file);

  const llmValues: Record<string, string> = {};
  const illustrativeValues: Record<string, string> = {};
  for (const pageKey of ["chrome", ...file.pageOrder]) {
    const pageSet = file.pages[pageKey];
    if (!pageSet) continue;
    try {
      const { copyValues, exampleValues } = await fillPageWithRealLlm(view, pageSet, pageKey, summary, locale, brief);
      Object.assign(llmValues, copyValues);
      Object.assign(illustrativeValues, exampleValues);
      console.log(
        `[real-fill] ${pageKey.padEnd(22)} ${Object.keys(copyValues).length} copy + ${Object.keys(exampleValues).length} example field(s) from ${llm.provider}`
      );
    } catch (err) {
      console.warn(`[real-fill] ${pageKey.padEnd(22)} FAILED (${err instanceof Error ? err.message : String(err)}) — keeping template's own copy for this page`);
    }
  }

  console.log(`\n[real-fill] ${Object.keys(llmValues).length} copy + ${Object.keys(illustrativeValues).length} example values — writing pages...\n`);

  const illustrativeFill = async (placement: { id: string }) => illustrativeValues[placement.id] ?? null;

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
      llmValues,
      illustrativeFill,
      templateBusinessName: file.templateName,
      placeholderPhone,
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
