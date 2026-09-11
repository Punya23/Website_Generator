/**
 * Bridges the OTHER template pipeline — the ~900-template scraped corpus, whose sections are
 * auto-discovered (`ingest/classify-section.ts`'s `locateSlots`, `ingest/photo-slots.ts`'s
 * `detectPhotoSlots`) rather than hand-mapped — into this one's engine (`fill.ts` / `llm-view.ts`).
 * Proves the answer to "does the engine only work on hand-mapped real-estate templates, or on any
 * template": `fill.ts` and `llm-view.ts` take no real-estate-specific input at all (see their own
 * module comments) — everything template-specific lives in the descriptor map that PRODUCES a
 * `PlacementsFile`. `real-estate-map.ts` is one such producer, hand-authored because those 4
 * templates are small, known, and identical. This is a SECOND producer, for the corpus, that needs
 * no hand-authored selectors at all — it reads whatever `classify-section.ts`/`photo-slots.ts`
 * already auto-discovered at ingest time.
 *
 * Two real differences from the hand-mapped path, both explained where they matter below:
 *  1. No verified CSS box behind a slot's constraints (no per-selector font-size/width recorded by
 *     `SlotLocator`) — `measure.ts`'s `genericProseConstraints` anchors to the original text's own
 *     length instead, same safety floor as the measured version, just a coarser ceiling.
 *  2. A generated SITE here is a mix of sections from POSSIBLY DIFFERENT templates (this repo's own
 *     cross-template mixing — see `select.ts`), not one template's fixed page set — so this builds
 *     a `PlacementsFile` from a `SelectedSite`-shaped composition (what `select.ts` already
 *     produces for one specific generation request), not from a raw template ahead of time.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import type { PhotoSlot, PlacedSection, SectionRole, SlotKind, SlotLocator, TemplateManifest, TemplateSection } from "../types.js";
import { sectionKey } from "../select.js";
import { templateCachePath } from "../ingest/ingest-template.js";
import type { TemplateStore } from "../store.js";
import { genericProseConstraints, labelConstraints } from "./measure.js";
import type { BusinessDataFeed } from "./business-data.js";
import { businessDataResolver } from "./business-data.js";
import { applyPlacements, type ClampNote, type DataResolver, type PlacementBrief } from "./fill.js";
import type { Locale } from "./fill-real-estate-template.js";
import {
  ImagePlacementSchema,
  PagePlacementsSchema,
  PlacementsFileSchema,
  SCHEMA_VERSION,
  TextPlacementSchema,
  type BriefField,
  type ImagePlacement,
  type PagePlacements,
  type PlacementsFile,
  type TextConstraints,
  type TextFillSource,
  type TextPlacement,
} from "./schema.js";

interface SlotKindPolicy {
  fillSource: TextFillSource;
  briefField?: BriefField;
  mode: "label" | "prose";
  maxWords?: number;
  maxLines?: number;
}

/**
 * Every `SlotKind` the corpus pipeline already knows how to locate, mapped to who's allowed to
 * fill it — the exact same fixed/brief/data/llm reasoning `real-estate-map.ts` documents, applied
 * to a different vocabulary. Nothing here is `data`: the corpus's `SlotLocator` has no concept of
 * "a specific real fact from the business's own records" the way a real-estate listing does — its
 * closest equivalent (a real testimonial, a real team member) is handled at the SECTION level below
 * (`PEOPLE_SECTION_ROLES`), not per slot kind.
 */
const SLOT_KIND_POLICY: Record<SlotKind, SlotKindPolicy> = {
  businessName: { fillSource: "brief", briefField: "businessName", mode: "label", maxWords: 4 },
  tagline: { fillSource: "llm", mode: "label", maxWords: 14 },
  phone: { fillSource: "brief", briefField: "phone", mode: "label", maxWords: 5 },
  email: { fillSource: "brief", briefField: "email", mode: "label", maxWords: 5 },
  address: { fillSource: "brief", briefField: "address", mode: "label", maxWords: 12 },
  primaryCta: { fillSource: "llm", mode: "label", maxWords: 5 },
  pageTitle: { fillSource: "llm", mode: "label", maxWords: 12 },
  serviceItemTitle: { fillSource: "llm", mode: "label", maxWords: 6 },
  serviceItemBody: { fillSource: "llm", mode: "prose", maxLines: 3 },
  sectionHeading: { fillSource: "llm", mode: "label", maxWords: 8 },
  sectionBody: { fillSource: "llm", mode: "prose", maxLines: 4 },
};

/** A section about real people this business hasn't supplied yet. Every slot inside one of these —
 *  regardless of what `SLOT_KIND_POLICY` says for its kind — is forced `fixed`: the same
 *  "no legitimate source, never fabricate" line `copy-slots.ts` already draws for this exact
 *  corpus (testimonials/team are skipped by default at SELECTION time; this is the same policy
 *  applied again at the copy layer, for the case where one IS selected). */
const PEOPLE_SECTION_ROLES = new Set<SectionRole>(["testimonials", "team"]);

function constraintsFor(policy: SlotKindPolicy, original: string): TextConstraints {
  return policy.mode === "label"
    ? labelConstraints(policy.maxWords ?? 6, original)
    : genericProseConstraints(original, policy.maxLines ?? 3);
}

type SectionRef = Pick<TemplateSection, "id" | "templateId" | "role">;

/** One auto-discovered `SlotLocator` -> one `TextPlacement`, ready for `fill.ts`. No selector or
 *  constraint is hand-picked here — both come from what `classify-section.ts` already located and
 *  what this file's own generic char-budget math derives from the original text. */
export function textPlacementFromSlot(slot: SlotLocator, section: SectionRef, page: string): TextPlacement {
  const key = sectionKey({ templateId: section.templateId, sectionId: section.id });
  const id = `${key}.${slot.kind}${slot.groupIndex !== undefined ? `.${slot.groupIndex}` : ""}`;
  const policy = SLOT_KIND_POLICY[slot.kind];
  const peopleLocked = PEOPLE_SECTION_ROLES.has(section.role);
  const fillSource: TextFillSource = peopleLocked ? "fixed" : policy.fillSource;

  return TextPlacementSchema.parse({
    id,
    kind: "text",
    page,
    selector: slot.selector,
    // SlotLocator never recorded the tag name — not needed by fill.ts (selector alone resolves the
    // node); left generic rather than guessed from the selector string, which would be unreliable
    // for the nth-of-type-chain selectors this corpus's own selectors often are.
    tag: "*",
    section: key,
    role: slot.kind,
    fillSource,
    original: slot.originalText,
    constraints: constraintsFor(policy, slot.originalText),
    ...(fillSource === "brief" && policy.briefField ? { briefField: policy.briefField } : {}),
    ...(slot.attr ? { attr: slot.attr } : {}),
    ...(peopleLocked
      ? { notes: `Locked: lives in a "${section.role}" section — no fabricated people, matching this corpus's existing policy.` }
      : {}),
  });
}

function reduceRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

/** `PhotoSlot` never recorded the CURRENT `src` (only the measured pixel dimensions used to decide
 *  it was real content, not decoration) — read it back from the section's own cached HTML so
 *  `ImagePlacement.original` is a real reference instead of always blank. */
const BG_URL_RE = /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i;
function currentPhotoSrc($: cheerio.CheerioAPI, photo: PhotoSlot): string {
  const el = $(photo.selector).first();
  if (el.length === 0) return "";
  if (photo.kind === "background") return BG_URL_RE.exec(el.attr("style") ?? "")?.[1] ?? "";
  return el.attr("src") ?? "";
}

/**
 * One auto-discovered `PhotoSlot` -> one `ImagePlacement`. Normally `llmQuery` (never `data`):
 * unlike a real-estate listing photo, a generic corpus content photo has no "real specific fact"
 * behind it to wait for — mirrors `verbatim-media-agent.ts`'s existing per-slot query-curation
 * pattern for this same corpus, just producing a placement for it instead of resolving it inline.
 *
 * The exception is a photo inside a `PEOPLE_SECTION_ROLES` section, which gets `data` — the same
 * "no fabricated people" line `textPlacementFromSlot` draws for that section's copy. A headshot in
 * a team grid or a face beside a testimonial quote IS a real specific fact about a real person, so
 * a stock-photo search result is the one substitution that must not happen here: it would put an
 * invented stranger's face on the site under a name the copy layer has already refused to invent.
 *
 * `data` rather than `fixed` because for IMAGES the two ship identically when nothing real exists —
 * `fill.ts` leaves the template's own demo photo in place either way, since the image `data` branch
 * has no `illustrativeFill` fallback (a null `resolveData` just skips the write) — and `data`
 * additionally lets a business that DOES supply real staff photos have them resolved. That last
 * part is exactly why the text side of this policy uses `fixed` instead: text `data` DOES fall
 * through to `illustrativeFill`, which may write a plausible invented testimonial, so people copy
 * needs the stricter never-substituted source while people photos do not.
 */
export function imagePlacementFromPhotoSlot(
  photo: PhotoSlot,
  index: number,
  section: SectionRef,
  page: string,
  original: string,
  subjectHint: string
): ImagePlacement {
  const key = sectionKey({ templateId: section.templateId, sectionId: section.id });
  const peopleLocked = PEOPLE_SECTION_ROLES.has(section.role);
  return ImagePlacementSchema.parse({
    id: `${key}.photo.${index}`,
    kind: "image",
    page,
    selector: photo.selector,
    domKind: photo.kind,
    section: key,
    role: `${section.role}Photo`,
    fillSource: peopleLocked ? "data" : "llmQuery",
    original,
    constraints: {
      aspectRatio: reduceRatio(photo.width, photo.height),
      minWidthPx: Math.max(480, photo.width),
      minHeightPx: Math.max(480, photo.height),
    },
    subject: peopleLocked
      ? `a real photo of this business's own ${section.role === "team" ? "team member" : "customer"} — supplied by the business, never a stock-photo search`
      : `a photo representative of this business's ${section.role} section (${subjectHint})`,
    ...(peopleLocked
      ? { notes: `Locked: a real person's photo in a "${section.role}" section — resolvable only from the business's own feed, never a stock-photo query.` }
      : {}),
  });
}

/** One placed section's slots/photos, converted and appended to `text`/`images` in place. */
async function appendSection(
  placed: PlacedSection,
  manifest: TemplateManifest,
  page: string,
  subjectHint: string,
  text: TextPlacement[],
  images: ImagePlacement[]
): Promise<void> {
  const section = manifest.sections.find((candidate) => candidate.id === placed.sectionId);
  if (!section) return; // stale reference (manifest re-ingested since selection) — skip, don't fail the whole page

  for (const slot of section.slots) text.push(textPlacementFromSlot(slot, section, page));
  if (section.photoSlots.length === 0) return;

  let html = "";
  try {
    html = await fs.readFile(path.join(templateCachePath(section.templateId), section.htmlCachePath), "utf8");
  } catch {
    // Cached fragment missing — photo placements still get created, just with an empty `original`.
  }
  const $ = html ? cheerio.load(html, null, false) : null;
  section.photoSlots.forEach((photo, index) => {
    const original = $ ? currentPhotoSrc($, photo) : "";
    images.push(imagePlacementFromPhotoSlot(photo, index, section, page, original, subjectHint));
  });
}

export interface CorpusPlacementsMeta {
  /** Identifies this specific composition — a mixed-template site has no single template id, so
   *  this is caller-chosen (a generation id, an anchor template id, whatever is meaningful). */
  templateId: string;
  templateName: string;
  vertical: string;
}

/**
 * Builds a `PlacementsFile` from one `SelectedSite`-shaped composition (`select.ts`'s own output
 * shape: `{ pages: Record<slug, PlacedSection[]> }`) — every placed section's manifest is loaded
 * once (`store.manifest`, cached per templateId for the whole call) and converted via
 * `textPlacementFromSlot`/`imagePlacementFromPhotoSlot`. From here on, `buildLlmView` /
 * `buildPromptPayload` / `applyFlatLlmResponse` / `fill.ts`'s `applyPlacements` all work exactly as
 * they do for a hand-mapped real-estate template — none of them import anything from this file.
 */
export async function buildPlacementsFromSelection(
  selected: { pages: Record<string, PlacedSection[]> },
  store: TemplateStore,
  meta: CorpusPlacementsMeta
): Promise<PlacementsFile> {
  const manifestCache = new Map<string, TemplateManifest>();
  const loadManifest = async (templateId: string): Promise<TemplateManifest | null> => {
    const cached = manifestCache.get(templateId);
    if (cached) return cached;
    const loaded = await store.manifest(templateId);
    if (loaded) manifestCache.set(templateId, loaded);
    return loaded;
  };

  const pages: Record<string, PagePlacements> = {};
  for (const [slug, placedSections] of Object.entries(selected.pages)) {
    const text: TextPlacement[] = [];
    const images: ImagePlacement[] = [];
    for (const placed of placedSections) {
      const manifest = await loadManifest(placed.templateId);
      if (!manifest) continue;
      await appendSection(placed, manifest, slug, meta.vertical, text, images);
    }
    pages[slug] = PagePlacementsSchema.parse({ page: slug, text, images });
  }

  return PlacementsFileSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    vertical: meta.vertical,
    templateId: meta.templateId,
    templateName: meta.templateName,
    generatedAt: new Date().toISOString(),
    pageOrder: Object.keys(selected.pages),
    pages,
  });
}

/** Sections `compose.ts` rebuilds unconditionally regardless of what a placement would write — a
 *  nav/footer copy pass would be pure wasted selector misses (see the Phase 2A spike results in
 *  `docs/PLACEMENTS_ORCHESTRATION_PLAN.md`). Keep in sync with `compose.ts`'s `rewriteNavLinks` /
 *  logo-wordmark call sites (`role === "nav"` / `role === "footer"`), not with any placements-side
 *  concept. Lives here (not in `orchestrator/placements-corpus-fill.ts`, the original home) so
 *  `reapplyPlacementsFill` below — needed from `templates/revise.ts`, which must not import from
 *  `orchestrator/` — can use the same one-source-of-truth exclusion a fresh fill uses. */
export const CHROME_ROLES = new Set<SectionRole>(["nav", "footer"]);

export function excludeChromeSections(pages: Record<string, PlacedSection[]>): Record<string, PlacedSection[]> {
  const out: Record<string, PlacedSection[]> = {};
  for (const [slug, sections] of Object.entries(pages)) {
    out[slug] = sections.filter((section) => !CHROME_ROLES.has(section.role));
  }
  return out;
}

/** Everything needed to replay a completed placements fill with NO new LLM call — persisted on
 *  `VerbatimSiteState.placementsFill` (`templates/revise.ts`) so an edit/swap/palette recompose
 *  keeps a site's real business copy instead of reverting to `compose.ts`'s own generic copy-slot
 *  text (the gap `placements-corpus-fill.ts`'s and `placements-pipeline.ts`'s own doc comments used
 *  to flag as open). Plain data only — JSON-serializable, since `site-state-store.ts` round-trips
 *  `VerbatimSiteState` through `JSON.stringify`/`JSON.parse` on every save/load; a live `resolveData`
 *  callback could never survive that, which is why `businessData` (not a resolver) is what's kept,
 *  rebuilt into a real resolver fresh on every replay. */
export interface PersistedPlacementsFill {
  meta: CorpusPlacementsMeta;
  brief: PlacementBrief;
  locale: Locale;
  llmValues: Record<string, string>;
  illustrativeValues: Record<string, string>;
  businessData?: BusinessDataFeed;
}

/** One page's own fill outcome — lets a caller (`verbatim-template-pipeline.ts`) attach a
 *  skipped/clamped note to the RIGHT page's `QAResult`, not just a site-wide total. */
export interface PlacementsFillPageResult {
  appliedText: number;
  appliedImages: number;
  skipped: string[];
  clamped: ClampNote[];
}

export interface ApplyPlacementsFillResult {
  htmlPages: Record<string, string>;
  appliedText: number;
  appliedImages: number;
  skipped: string[];
  clamped: ClampNote[];
  /** Every `ImagePlacement.id` this pass actually wrote, mapped to the final URL — see
   *  `composePhotoKey` for turning this into a `ComposeOptions.photos` patch. */
  appliedImageUrls: Record<string, string>;
  /** Same numbers as above, keyed by page slug — only pages this pass actually touched appear here. */
  byPage: Record<string, PlacementsFillPageResult>;
}

/**
 * The pure "write already-resolved values into already-built `file`" half of a placements fill —
 * shared by `orchestrator/placements-corpus-fill.ts`'s `runCorpusPlacementsFill` (fresh fill, real
 * LLM call happens before this) and `reapplyPlacementsFill` below (replay, no LLM call at all). A
 * page with no body sections to fill, or missing from `htmlPages` entirely, ships unchanged.
 */
export async function applyPlacementsFillToPages(
  file: PlacementsFile,
  values: { brief: PlacementBrief; llmValues: Record<string, string>; illustrativeValues: Record<string, string>; locale: Locale },
  htmlPages: Record<string, string>,
  opts: { resolveData?: DataResolver; manualOverrideKeys?: Set<string> } = {}
): Promise<ApplyPlacementsFillResult> {
  const illustrativeFill = async (placement: { id: string }) => values.illustrativeValues[placement.id] ?? null;

  const out: Record<string, string> = { ...htmlPages };
  let appliedText = 0;
  let appliedImages = 0;
  const skipped: string[] = [];
  const clamped: ClampNote[] = [];
  const appliedImageUrls: Record<string, string> = {};
  const byPage: Record<string, PlacementsFillPageResult> = {};

  for (const slug of file.pageOrder) {
    const pageSet = file.pages[slug];
    const html = htmlPages[slug];
    if (!pageSet || pageSet.text.length + pageSet.images.length === 0 || !html) continue;

    const result = await applyPlacements(html, pageSet, {
      brief: values.brief,
      llmValues: values.llmValues,
      illustrativeFill,
      placeholderPhone: values.locale.phoneFormat,
      ...(opts.resolveData ? { resolveData: opts.resolveData } : {}),
      ...(opts.manualOverrideKeys ? { manualOverrideKeys: opts.manualOverrideKeys } : {}),
    });
    out[slug] = result.html;
    appliedText += result.appliedText;
    appliedImages += result.appliedImages;
    skipped.push(...result.skipped);
    clamped.push(...result.clamped);
    Object.assign(appliedImageUrls, result.appliedImageUrls);
    byPage[slug] = {
      appliedText: result.appliedText,
      appliedImages: result.appliedImages,
      skipped: result.skipped,
      clamped: result.clamped,
    };
  }

  return { htmlPages: out, appliedText, appliedImages, skipped, clamped, appliedImageUrls, byPage };
}

/**
 * Replays a previously-computed placements fill (`fill`, from `VerbatimSiteState.placementsFill`)
 * onto freshly composed HTML — zero LLM calls, every value comes straight from `fill`. This is what
 * `templates/revise.ts`'s `composeVerbatimSite` calls on every edit/swap/add/palette/logo recompose
 * of a placements-filled site, so the real business copy a first generation paid for keeps shipping
 * instead of being silently lost the moment the site is edited.
 *
 * `pages` is `state.pages` — re-deriving the `PlacementsFile` fresh from it (rather than persisting
 * the file itself) means a swap/add/remove that changed WHICH sections are placed is reflected
 * automatically: a removed section's placements simply drop out, a newly added section's are new ids
 * `fill.llmValues` has no entry for (so it keeps its own template text, same safe default as any
 * other unfilled placement — exactly how a fresh `addSection` behaves outside placements mode too).
 *
 * `manualOverrideKeys` — normally `state.overrides`'s own key set — stops this replay from reverting
 * a manual text edit the SAME recompose already applied moments earlier (`composeSite`'s own
 * `overrides` pass, via `anchorEditableText`, always runs first): see `fill.ts`'s
 * `ApplyPlacementsOptions.manualOverrideKeys` for the mechanism.
 */
export async function reapplyPlacementsFill(
  pages: Record<string, PlacedSection[]>,
  store: TemplateStore,
  fill: PersistedPlacementsFill,
  htmlPages: Record<string, string>,
  manualOverrideKeys?: Set<string>
): Promise<ApplyPlacementsFillResult> {
  const file = await buildPlacementsFromSelection({ pages: excludeChromeSections(pages) }, store, fill.meta);
  return applyPlacementsFillToPages(file, fill, htmlPages, {
    ...(fill.businessData ? { resolveData: businessDataResolver(fill.businessData) } : {}),
    ...(manualOverrideKeys ? { manualOverrideKeys } : {}),
  });
}

const PHOTO_ID_SUFFIX_RE = /\.photo\.(\d+)$/;

/** The `ComposeOptions.photos` / `data-wg-photo` key (`<templateId>:<sectionId>#<index>`) the SAME
 *  photo slot a corpus `ImagePlacement` addresses is pinned under during compose — both
 *  `imagePlacementFromPhotoSlot` above and `compose.ts`'s own content-photo pass iterate the
 *  identical `TemplateSection.photoSlots` array in the same order, so `index` lines up exactly, and
 *  the placement id's own prefix (up to `.photo.`) is already `sectionKey`'s `<templateId>:<sectionId>`
 *  — no separate lookup needed. `null` for an id with no `.photo.<n>` suffix (a hand-mapped
 *  `real-estate/*` placement uses a wholly different id scheme and has no photo-pinning concept at
 *  all) — never expected for a corpus-built `ImagePlacement.id`. */
export function composePhotoKey(placementId: string): string | null {
  const match = PHOTO_ID_SUFFIX_RE.exec(placementId);
  return match ? `${placementId.slice(0, match.index)}#${match[1]}` : null;
}
