import path from "node:path";

/** Where the user drops raw template zips. Gitignored — never committed, can grow to 50GB+. */
export function templatesBundleDir(): string {
  return process.env.TEMPLATES_BUNDLE_DIR?.trim() || path.resolve(process.cwd(), "templates_bundle");
}

/** Derived, cached-per-template artifacts (extracted HTML, scoped+recolored CSS, section index).
 *  Kept separate from the raw zips so re-running ingest never re-extracts an already-ingested
 *  template, and so the cache alone (not the 50GB corpus) is what a generation run reads from. */
export function templateCacheDir(): string {
  return process.env.TEMPLATE_CACHE_DIR?.trim() || path.resolve(process.cwd(), "data", "template-cache");
}

export function templateStorePath(): string {
  return process.env.TEMPLATE_STORE_PATH?.trim() || path.resolve(process.cwd(), "data", "template-store.json");
}

export function templateSectionHistoryPath(): string {
  return (
    process.env.TEMPLATE_SECTION_HISTORY_PATH?.trim() ||
    path.resolve(process.cwd(), "data", "consumer-template-sections.json")
  );
}

/** Editable state of the site currently open in the playground — see `site-state-store.ts`. */
export function siteStateDir(): string {
  return process.env.TEMPLATE_SITE_STATE_DIR?.trim() || path.resolve(process.cwd(), "data", "site-state");
}

/** Append-only log of every site generation — which template filled every section, and exactly
 *  what changed. See `src/templates/generation-store.ts`. */
export function generationHistoryPath(): string {
  return (
    process.env.TEMPLATE_GENERATION_HISTORY_PATH?.trim() ||
    path.resolve(process.cwd(), "data", "generation-history.ndjson")
  );
}

export function templateIngestConcurrency(): number {
  const n = Number.parseInt(process.env.TEMPLATE_INGEST_CONCURRENCY ?? "3", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 3;
}

/** Model used to classify a section's role/copy-slots. Same resolution chain as the existing
 *  ingest mapper (`src/admin/config.ts: ingestModel`) — reuse the operator's Ollama setup. */
export function templateClassifyModel(): string | undefined {
  return process.env.OLLAMA_INGEST_MODEL ?? process.env.OLLAMA_MODEL ?? process.env.LLM_MODEL;
}

export function templateClassifyUseLlm(): boolean {
  if (process.env.VITEST) return false;
  const v = (process.env.TEMPLATE_CLASSIFY_USE_LLM ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false";
}

/** Reduce each template's merged stylesheet to the rules its placed markup can match, per page.
 *  On by default — see `src/templates/ingest/shake-css.ts`. Set to 0 to ship the whole sheet. */
export function templateCssShakeEnabled(): boolean {
  const v = (process.env.TEMPLATE_CSS_SHAKE ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false";
}

/**
 * Hard-lock generated sites to the brief's own vertical: only templates classified into the
 * brief's industry (or, failing that, a near-miss industry, then the same coarse category) are
 * candidates at all. On by default — see `src/templates/taxonomy-scope.ts`. Set to 0 to fall back
 * to the old behaviour, where taxonomy was a ranking preference and any template could be picked
 * once the preferred ones ran out.
 */
export function strictTaxonomyScope(): boolean {
  const v = (process.env.TEMPLATE_STRICT_TAXONOMY ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false";
}

/** Probe an externally-hotlinked template image's real pixel dimensions over the network at ingest
 *  time, so it can be classified as a real photo slot instead of silently staying un-substitutable
 *  forever (`ingest/photo-slots.ts`'s `measureRemote`). Off under `VITEST` unconditionally (tests
 *  must never depend on network access); on by default otherwise. Set to 0 for an offline/air-gapped
 *  ingest run — those templates simply keep shipping their own hotlinked image, same as today. */
export function templateProbeRemoteImages(): boolean {
  if (process.env.VITEST) return false;
  const v = (process.env.TEMPLATE_PROBE_REMOTE_IMAGES ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false";
}

/** Default target palette applied to every ingested template. */
export function templatePaletteId(): string {
  return process.env.TEMPLATE_PALETTE?.trim() || "all-black";
}

/**
 * How wide a band, below the top composite anchor score, still counts as "worth exploring" before
 * one anchor template is locked for the site (`src/templates/select.ts`). 0 collapses back to
 * exact-tie-only behaviour; wider bands compare more near-miss candidates before committing.
 */
export function anchorExploreBand(): number {
  const n = Number.parseFloat(process.env.TEMPLATE_ANCHOR_EXPLORE_BAND ?? "0.12");
  return Number.isFinite(n) && n >= 0 ? n : 0.12;
}

/**
 * How compatible a non-anchor template's design fingerprint must be with the site's anchor
 * (`ingest/design-fingerprint.ts`'s `fingerprintCompatibility`, 0-1) before `select.ts` will
 * consider borrowing a section from it for a mixable role at all. Below this, the candidate simply
 * isn't in the pool a mixable role picks from — real cross-template mixing, bounded by "would this
 * visibly clash," not "is there anything else at all." 0 disables the compatibility gate entirely
 * (falls back to the old "score everything, ignore fit" behaviour); 1 only ever allows an
 * indistinguishable pairing.
 */
export function templateMixCompatibilityThreshold(): number {
  const n = Number.parseFloat(process.env.TEMPLATE_MIX_COMPATIBILITY_THRESHOLD ?? "0.55");
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.55;
}

/** Default OFF: a site builds from one anchor template only ("anchor first, any-template-fallback-
 *  only-when-empty") — cross-template mixing visibly clashed too often in practice even gated by
 *  fingerprint compatibility. Set TEMPLATE_MIX_SECTIONS=1 to re-enable compatibility-scored mixing. */
export function templateMixEnabled(): boolean {
  const v = (process.env.TEMPLATE_MIX_SECTIONS ?? "0").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Testing-only hard restriction: when set, selection sees ONLY these templates — every other
 *  template in the corpus is treated as if it did not exist (taxonomy scope, theme lock, anchor
 *  scoring, mixing, all computed over just this set). Unset by default (whole corpus eligible).
 *  Comma-separated `templateId`s, e.g.
 *  `TEMPLATE_ANCHOR_ALLOWLIST=tpl_0b9a454d38f4,tpl_8d1070dac98f npm run generate -- "..."`.
 *  A global env var, not a per-request option, because nothing in the UI can set one — this is for
 *  locking a local run to a handful of just-ingested templates while testing them, not a feature a
 *  real generation request would ever set. Restricting to templates outside the brief's own
 *  vertical (or too few of them to cover nav+hero+footer) degrades exactly like a thin corpus does
 *  elsewhere in this file — a worse-but-real site, or none, never a silent ignore of the setting. */
export function templateAnchorAllowlist(): Set<string> | undefined {
  const raw = (process.env.TEMPLATE_ANCHOR_ALLOWLIST ?? "").trim();
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : undefined;
}

/** Default ON: a template with 2 or more `qualityFlags` (see `ingest/quality-score.ts`) is never
 *  selected — thin content, weak classification confidence, and no real animation are each common
 *  enough alone in a perfectly fine simple template that any ONE flag should not disqualify it, but
 *  two together is a real, corpus-confirmed "this was never going to read as a usable business
 *  site" signal. Set TEMPLATE_QUALITY_GATE=0 to disable (e.g. while testing against a corpus that
 *  hasn't been backfilled yet and you want to see the raw pool). */
export function templateQualityGateEnabled(): boolean {
  const v = (process.env.TEMPLATE_QUALITY_GATE ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false";
}

/** Zip-bomb / zip-slip guardrails for extracting templates from an unaudited local bundle
 *  (source: user-supplied Etsy zips, licensing status "mixed, unverified" per the user). */
export function templateMaxUncompressedBytes(): number {
  const n = Number.parseInt(process.env.TEMPLATE_MAX_UNCOMPRESSED_BYTES ?? "", 10);
  // 500MB rejected two genuine templates_bundle/ templates outright (esports/magazine and
  // ecommerce showcase packs with heavy video/image assets, 950MB and 609MB uncompressed — real
  // content, not zip bombs: both well under 2,006-3,145 entries, nowhere near templateMaxEntries).
  // 2GB keeps real headroom above both while still bounding a genuine bomb (those inflate to many
  // GB-PB from a tiny file, not ~2x their own archive size the way these two real templates do).
  return Number.isFinite(n) && n > 0 ? n : 2 * 1024 * 1024 * 1024; // 2GB per archive
}

export function templateMaxEntries(): number {
  const n = Number.parseInt(process.env.TEMPLATE_MAX_ENTRIES ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 20_000;
}

export function templateMaxNestedZipDepth(): number {
  const n = Number.parseInt(process.env.TEMPLATE_MAX_NESTED_ZIP_DEPTH ?? "4", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 4;
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  }
  const workers = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
