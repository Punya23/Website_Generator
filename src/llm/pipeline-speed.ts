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

export function useBespokeSectionCodegen(): boolean {
  if (process.env.BESPOKE_SECTION_CODEGEN === "1") return true;
  if (process.env.BESPOKE_SECTION_CODEGEN === "0") return false;
  return isQualityPipeline();
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

export function maxVisionRetries(): number {
  if (isFastPipeline()) return 1;
  return 2;
}

export function homeSectionBudget(): { min: number; max: number } {
  if (isQualityPipeline()) return { min: 5, max: 7 };
  return { min: 5, max: 6 };
}
