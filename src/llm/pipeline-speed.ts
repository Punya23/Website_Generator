/** Pipeline speed / concurrency — tuned for ~3 min generates without gutting quality. */

export function isFastPipeline(): boolean {
  return process.env.PIPELINE_FAST === "1";
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
  return isFastPipeline() ? 6 : 4;
}

export function skipDirectorRetries(): boolean {
  if (process.env.PIPELINE_DIRECTOR_RETRIES === "1") return false;
  return isFastPipeline();
}

export function creativeDirectorPoolOnly(): boolean {
  if (process.env.PIPELINE_CREATIVE_LLM === "1") return false;
  return isFastPipeline();
}

export function skipSecondDesignRefine(): boolean {
  if (process.env.PIPELINE_DOUBLE_REFINE === "1") return false;
  return isFastPipeline();
}

export function defaultLlmConcurrency(): number {
  const n = Number.parseInt(process.env.LLM_MAX_CONCURRENCY ?? "", 10);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 8);
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
