/** Pipeline speed / quality flags — quality is the default; opt into PIPELINE_FAST=1 (or
 *  PIPELINE_QUALITY=0) for the cheaper/faster tier. */

export function isQualityPipeline(): boolean {
  if (process.env.PIPELINE_QUALITY === "1") return true;
  if (process.env.PIPELINE_QUALITY === "0") return false;
  if (process.env.PIPELINE_FAST === "1") return false;
  return true;
}

export function isFastPipeline(): boolean {
  if (isQualityPipeline()) return false;
  return process.env.PIPELINE_FAST === "1";
}

/** True only when PIPELINE_QUALITY=1 is explicitly set — distinct from isQualityPipeline()'s
 *  default-true behavior. Gates "no mock/fallback, rethrow on any LLM failure" so a transient
 *  LLM hiccup on one section can't silently crash an entire generation by default; opt in
 *  explicitly when you want that strictness (e.g. CI, regression-hunting). */
export function strictQualityRequested(): boolean {
  return process.env.PIPELINE_QUALITY === "1";
}

/** Unified copy+media LLM call per section (halves section LLM round-trips). */
export function useUnifiedSectionLlm(): boolean {
  if (process.env.PIPELINE_UNIFIED_SECTION === "1") return true;
  if (process.env.PIPELINE_UNIFIED_SECTION === "0") return false;
  return isFastPipeline();
}

export function sectionFillConcurrency(): number {
  const n = Number.parseInt(process.env.SECTION_FILL_CONCURRENCY ?? "", 10);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 12);
  if (isQualityPipeline()) return 3;
  return isFastPipeline() ? 6 : 4;
}

export function skipDirectorRetries(): boolean {
  if (isQualityPipeline()) return false;
  if (process.env.PIPELINE_DIRECTOR_RETRIES === "1") return false;
  return isFastPipeline();
}

export function creativeDirectorPoolOnly(): boolean {
  if (isQualityPipeline()) return false;
  if (process.env.PIPELINE_CREATIVE_LLM === "1") return false;
  return isFastPipeline();
}

export function skipSecondDesignRefine(): boolean {
  if (isQualityPipeline()) return false;
  if (process.env.PIPELINE_DOUBLE_REFINE === "1") return false;
  return isFastPipeline();
}

export function defaultLlmConcurrency(): number {
  const n = Number.parseInt(process.env.LLM_MAX_CONCURRENCY ?? "", 10);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 8);
  if (isQualityPipeline()) return 3;
  return isFastPipeline() ? 4 : 3;
}

export function defaultLlmRequestDelayMs(): number {
  const n = Number.parseInt(process.env.LLM_REQUEST_DELAY_MS ?? "", 10);
  if (Number.isFinite(n) && n >= 0) return n;
  const concurrency = defaultLlmConcurrency();
  if (concurrency >= 4) return 50;
  if (concurrency >= 2) return 100;
  return 250;
}

/** Bespoke codegen gets its own request queue, separate from the shared copywriter/director
 *  queue — it's now the dominant LLM call volume per site (one extra call, often two with a
 *  validation retry, per eligible section) and doesn't share the copy-quality rationale that
 *  keeps LLM_MAX_CONCURRENCY low. Defaults to double the shared concurrency. */
export function bespokeCodegenConcurrency(): number {
  const n = Number.parseInt(process.env.BESPOKE_CODEGEN_CONCURRENCY ?? "", 10);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 10);
  return Math.min(defaultLlmConcurrency() * 2, 6);
}

export function bespokeCodegenRequestDelayMs(): number {
  const n = Number.parseInt(process.env.BESPOKE_CODEGEN_REQUEST_DELAY_MS ?? "", 10);
  if (Number.isFinite(n) && n >= 0) return n;
  const concurrency = bespokeCodegenConcurrency();
  if (concurrency >= 4) return 50;
  if (concurrency >= 2) return 100;
  return 250;
}

/** Off by default — per-section LLM codegen is unreliable; opt in with BESPOKE_SECTION_CODEGEN=1. */
export function useBespokeSectionCodegen(): boolean {
  if (process.env.BESPOKE_SECTION_CODEGEN === "1") return true;
  return false;
}

/** LLM-first page composition — one call per page picks components + writes props.
 *  Off by default. Skin-fill is the production path. Opt in with PIPELINE_PAGE_CODEGEN=1. */
export function usePageCodegenPipeline(): boolean {
  return process.env.PIPELINE_PAGE_CODEGEN === "1";
}

/** Authored whole-site skin + copy slotted from the brief. Default on; disable with PIPELINE_SKIN_FILL=0
 *  (and optionally PIPELINE_PAGE_CODEGEN=1 to restore the old composer). */
export function useSkinFillPipeline(): boolean {
  if (process.env.PIPELINE_SKIN_FILL === "0") return false;
  if (usePageCodegenPipeline()) return false;
  return true;
}

/** Opt-in: ask an LLM to rewrite copy into skin slots. Off by default — the skin-fill path
 *  slots the user's brief into each template as-is. */
export function useSkinFillLlm(): boolean {
  return process.env.PIPELINE_SKIN_FILL_LLM === "1";
}

/**
 * Sites built from ingested third-party HTML templates, kept verbatim and recolored — the default
 * generation path. Falls back to the skin pipeline when no templates have been ingested yet, so a
 * fresh checkout with an empty `templates_bundle/` still generates.
 * Escape hatch: PIPELINE_VERBATIM_TEMPLATES=0.
 */
export function useVerbatimTemplatePipeline(): boolean {
  if (process.env.PIPELINE_VERBATIM_TEMPLATES === "0") return false;
  if (process.env.PIPELINE_VERBATIM_TEMPLATES === "1") return true;
  // Under the test runner the machine's own ingested cache must not decide which pipeline runs —
  // same opt-in convention the ingest config already uses (`ingestUseLlm`, `ingestScreenshotMode`).
  if (process.env.VITEST) return false;
  if (usePageCodegenPipeline()) return false;
  if (process.env.PIPELINE_SKIN_FILL === "0") return false;
  return true;
}

/**
 * Real-estate briefs get a whole hand-built template (`real-estate/*`) filled via the placements
 * contract (`src/templates/placements/`) instead of the verbatim-corpus/skin-fill paths — see
 * `src/orchestrator/placements-pipeline.ts`. Off by default: unlike verbatim/skin-fill this path
 * has no vision-QA redo loop and no generation-record parity yet (see that module's own doc
 * comment) — opt in per-run with PIPELINE_PLACEMENTS=1 while it proves out, rather than putting
 * every real-estate brief through it by default.
 */
export function usePlacementsPipeline(): boolean {
  if (process.env.PIPELINE_PLACEMENTS === "0") return false;
  if (process.env.PIPELINE_PLACEMENTS === "1") return true;
  return false;
}

/**
 * Corpus-path placements fill (Phase 2B of `docs/PLACEMENTS_ORCHESTRATION_PLAN.md`) — the same
 * placements engine `usePlacementsPipeline` above gates for the curated `real-estate/*` path,
 * applied instead to a `select.ts`-composed corpus site (`src/orchestrator/placements-corpus-
 * fill.ts`). A DIFFERENT flag from `PIPELINE_PLACEMENTS` on purpose: that one picks a whole
 * template out of 4; this one only changes how `runVerbatimTemplatePipeline` fills copy on
 * whatever corpus composition `select.ts` already produced, and the two are not mutually
 * exclusive in principle (a corpus brief that isn't real-estate can use this without ever
 * touching the curated path, and vice versa). Off by default until Phase 2B's own acceptance
 * criteria are green — the 2A spike proved the ENGINE integrates cleanly (100% selector hit rate
 * once nav/footer are excluded), it did not itself prove the `polishComposedCopy` replacement is
 * safe end-to-end on a real generation.
 */
export function usePlacementsCorpusFill(): boolean {
  if (process.env.PIPELINE_PLACEMENTS_CORPUS === "0") return false;
  if (process.env.PIPELINE_PLACEMENTS_CORPUS === "1") return true;
  return false;
}

export function visionQaEnabled(): boolean {
  if (process.env.SKIP_VISION === "1") return false;
  return true;
}

/** Defaults to checking every page — set VISION_QA_HOME_ONLY=1 to restrict to home for cost. */
export function visionQaHomeOnly(): boolean {
  if (process.env.VISION_QA_HOME_ONLY === "1") return true;
  return false;
}

/** How many times the final whole-site visual QA gate (`orchestrator.ts`, after CMS merge, before
 *  publish) may redo generation on a failing verdict. 0 disables the redo — the gate still judges
 *  and reports, it just never retries. Bounded like `MAX_QA_RETRIES`: a fixed cap, not a
 *  loop-until-pass, so one stubbornly bad-fitting corpus can't stall a generation indefinitely. */
export function finalVisionMaxRedos(): number {
  const n = Number.parseInt(process.env.FINAL_VISION_MAX_REDOS ?? "1", 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

export function maxVisionRetries(): number {
  if (isFastPipeline()) return 1;
  return 2;
}

export function homeSectionBudget(): { min: number; max: number } {
  if (isQualityPipeline()) return { min: 5, max: 7 };
  return { min: 5, max: 6 };
}
