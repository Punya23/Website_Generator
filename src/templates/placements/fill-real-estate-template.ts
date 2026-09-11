/**
 * The real round trip, no synthesized data: a business brief -> `placements.llm.json` -> a real
 * OpenRouter call (via this project's own `src/llm/client.ts`, the same client every other agent in
 * the pipeline uses) -> `fill.ts`. One call per page (each page's own editable-field payload is
 * small; a single whole-template call would risk truncating against OpenRouter's max_tokens cap —
 * see `src/llm/token-budget.ts`'s per-provider clamp).
 *
 * Shared by two callers: `scripts/generate-real-site.ts` (CLI — writes `<page>.generated.html`
 * files for manual inspection) and `src/orchestrator/placements-pipeline.ts` (the real generation
 * path — keeps everything in memory, feeds `orchestrator.ts`'s usual `htmlPages`/QA flow). Neither
 * caller repeats this module's own logic; both just decide what to do with `RealEstateFillResult`.
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
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { llm } from "../../llm/client.js";
import { chatJsonWithRetry } from "../../llm/json-agent.js";
import { expandBrief, expandBriefFromInput, briefToContext } from "../../agents/expand-brief-agent.js";
import { STREET_ADDRESS_RE } from "../filler-patterns.js";
import { PlacementsFileSchema, type BriefField, type PagePlacements, type PlacementsFile } from "./schema.js";
import type { DataResolver, PlacementBrief } from "./fill.js";
import { applyPlacements } from "./fill.js";
import {
  applyFlatLlmResponse,
  buildFlatPromptPayload,
  buildLlmView,
  flatKeysSchema,
  type FlatPromptField,
  type LlmTemplateView,
} from "./llm-view.js";
import { stockImageUrl } from "../../media/stock-images.js";

/** Explicit user decision, overriding this script's original stricter default: a fictional
 *  customer/agent NAME and a fictional testimonial QUOTE are standard demo-site content (the
 *  template already ships fictional named people paired with randomuser.me stock photos — this
 *  only re-contextualizes the same kind of fiction to the real business, e.g. an Indian name for an
 *  Indian brokerage, instead of leaving the template's own unrelated one). The photos themselves are
 *  resolved separately — see `resolveImageQueries`.
 *
 *  `agentContact` alone stays excluded: it is a phone number (bundled with an email) in prose form,
 *  the one shape this module still refuses to let an LLM invent — see `fill.ts`'s own doc comment
 *  on `placeholderPhone` for why a fake-but-plausible number is a different risk tier than a fake
 *  name or fake quote. It keeps the template's own demo contact, brand-swapped only. */
const PEOPLE_ROLES = new Set(["agentContact"]);

/** Heuristic only — decides the FORMAT of the non-dialable phone placeholder (which stays all
 *  zeros regardless, enforced in fill.ts) and which currency an `example_fields` answer (a listing
 *  price, a business stat) should use, not whether any real number is invented. Extend this list
 *  rather than trying to be clever about locale detection; a false negative just falls back to the
 *  US-shaped default, which is no less safe, only less obviously on-tone. */
const INDIA_HINT_RE = /\b(india|bharat|maharashtra|pune|mumbai|bengaluru|bangalore|delhi|hyderabad|chennai|kolkata|gujarat|karnataka|rera|₹|\binr\b)\b/i;

export interface Locale {
  phoneFormat: string;
  /** Stated explicitly to the model as its own line in every page's prompt (see `buildUserPrompt`)
   *  — SYSTEM_PROMPT's "right city, right currency" rule used to rely on the model inferring this
   *  from whatever the free-text business summary happened to mention, which is exactly the kind
   *  of per-page-independent guess that drifts across pages/calls. One resolved value, reused for
   *  every page the same way `summary` already is, closes that gap without a second LLM call. */
  currencyLabel: string;
}

export function resolveLocale(rawBriefText: string): Locale {
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
// Exported for Phase 2B's corpus fill helper to reuse (docs/PLACEMENTS_ORCHESTRATION_PLAN.md §5.2)
// instead of re-deriving it: nothing here is real-estate-specific — it only reads `FlatPromptField`s
// whose `type` is "image" and a `PlacementBrief` for the seed, both already generic to any
// `PlacementsFile`, corpus-built or hand-mapped.
export async function resolveImageQueries(
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

export interface FilledPage {
  html: string;
  appliedText: number;
  appliedImages: number;
  clamped: { id: string; reason: string }[];
}

export interface RealEstateFillResult {
  file: PlacementsFile;
  brief: PlacementBrief;
  locale: Locale;
  /** Keyed by page file (`"index.html"`, `"about.html"`, ...) — `file.pageOrder`'s own keys, not
   *  `"chrome"` (chrome has no page of its own; its placements are merged into every real page). */
  pages: Record<string, FilledPage>;
  llmFieldCount: number;
  exampleFieldCount: number;
  costUsd: number;
}

export interface PlacementsFillValues {
  brief: PlacementBrief;
  locale: Locale;
  /** Finished copy (and resolved photo URLs) keyed by placement id, across every page. */
  llmValues: Record<string, string>;
  /** Illustrative example values for `data`/`brief` placements with no real input, keyed the same
   *  way — kept separate from `llmValues` because `fill.ts` takes them through a different door
   *  (`illustrativeFill`). */
  illustrativeValues: Record<string, string>;
}

/**
 * The vertical-agnostic half of `fillRealEstateTemplate`: given an already-parsed `PlacementsFile`
 * — loaded from `real-estate/*`'s `placements.json` below, or built in memory by `from-corpus.ts`'s
 * `buildPlacementsFromSelection` for a corpus composition (`src/orchestrator/placements-corpus-
 * fill.ts`) — resolves the brief once and fills every editable placement across every page. Does no
 * file I/O and knows nothing about a `templateDir`; both callers apply the result through `fill.ts`
 * themselves, since only they know where their own HTML lives (on disk for the curated path, in
 * `composeSite`'s in-memory `htmlPages` for the corpus path). Kept in this file rather than a new
 * one so the prompt/schema/locale/people-role rules stay defined exactly once.
 *
 * A page whose LLM call fails keeps that page's placements unfilled (so the caller's own
 * `applyPlacements` leaves the template's own copy there) rather than failing the whole run — same
 * resilience the rest of this pipeline's per-page/per-section calls already rely on; `onProgress`
 * (if given) is told about it.
 */
export async function fillPlacementsFile(
  file: PlacementsFile,
  rawBrief: string,
  opts: { onProgress?: (line: string) => void } = {}
): Promise<PlacementsFillValues> {
  if (!llm.isAvailable) {
    throw new Error("No LLM configured — set OPENROUTER_API_KEY (or another provider key) in .env");
  }
  const log = opts.onProgress ?? (() => {});

  const { brief, summary } = await resolveBriefContext(rawBrief);
  const locale = resolveLocale(rawBrief);
  log(`business="${brief.businessName}"`);

  const view = buildLlmView(file);

  const llmValues: Record<string, string> = {};
  const illustrativeValues: Record<string, string> = {};
  // "chrome" is the curated path's own pseudo-page (nav/footer, merged into every real page below)
  // — a corpus `PlacementsFile` has no such key, so this is a harmless no-op skip for that caller.
  for (const pageKey of ["chrome", ...file.pageOrder]) {
    const pageSet = file.pages[pageKey];
    if (!pageSet) continue;
    try {
      const { copyValues, exampleValues } = await fillPageWithRealLlm(view, pageSet, pageKey, summary, locale, brief);
      Object.assign(llmValues, copyValues);
      Object.assign(illustrativeValues, exampleValues);
      log(`${pageKey}: ${Object.keys(copyValues).length} copy + ${Object.keys(exampleValues).length} example field(s)`);
    } catch (err) {
      log(`${pageKey}: FAILED (${err instanceof Error ? err.message : String(err)}) — keeping template's own copy`);
    }
  }

  return { brief, locale, llmValues, illustrativeValues };
}

/**
 * Fills every page of one real-estate template (`templateDir` — one of `real-estate/*`) for one
 * real business, entirely in memory. The disk-reading, chrome-merging wrapper around
 * `fillPlacementsFile` above — see that function for the actual fill.
 *
 * `opts.resolveData` is `fill.ts`'s own `resolveData` hook, passed straight through to
 * `applyPlacements` — every `data` placement with no real value falls to `illustrativeFill` unless
 * this is given (Phase 3, docs/PLACEMENTS_ORCHESTRATION_PLAN.md: "demos can inject listing
 * fixtures"). Omitted, behavior is byte-identical to before this option existed. See
 * `demo-data.ts`'s `demoListingsResolver` for the one resolver this pipeline ships.
 */
export async function fillRealEstateTemplate(
  templateDir: string,
  rawBrief: string,
  opts: { onProgress?: (line: string) => void; resolveData?: DataResolver } = {}
): Promise<RealEstateFillResult> {
  const raw = JSON.parse(await fs.readFile(path.join(templateDir, "placements.json"), "utf8"));
  const file = PlacementsFileSchema.parse(raw);

  const { brief, locale, llmValues, illustrativeValues } = await fillPlacementsFile(file, rawBrief, opts);
  const illustrativeFill = async (placement: { id: string }) => illustrativeValues[placement.id] ?? null;

  const pages: Record<string, FilledPage> = {};
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
      resolveData: opts.resolveData,
      templateBusinessName: file.templateName,
      placeholderPhone: locale.phoneFormat,
    });
    pages[pageFile] = {
      html: result.html,
      appliedText: result.appliedText,
      appliedImages: result.appliedImages,
      clamped: result.clamped,
    };
  }

  return {
    file,
    brief,
    locale,
    pages,
    llmFieldCount: Object.keys(llmValues).length,
    exampleFieldCount: Object.keys(illustrativeValues).length,
    costUsd: llm.getEstimatedCostUsd(),
  };
}
