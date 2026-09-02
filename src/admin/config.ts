import path from "node:path";

export function ingestMaxPerRun(): number {
  const n = Number.parseInt(process.env.INGEST_MAX_PER_RUN ?? "250", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20_000) : 250;
}

/** Result pages pulled per GitHub search query (100 hits per page, GitHub caps a query at 10). */
export function ingestSearchPages(): number {
  const n = Number.parseInt(process.env.INGEST_SEARCH_PAGES ?? "3", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 3;
}

/** Hard cap on distinct search queries per discovery run, so a big INGEST_MAX_PER_RUN cannot
 *  turn into an unbounded crawl of the query plan. */
export function ingestMaxQueries(): number {
  const n = Number.parseInt(process.env.INGEST_MAX_QUERIES ?? "120", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 120;
}

/** GitHub search allows 30 req/min with a token, 10 without. Default pacing stays under both. */
export function ingestSearchDelayMs(): number {
  const raw = process.env.INGEST_SEARCH_DELAY_MS;
  if (raw !== undefined) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  if (process.env.VITEST) return 0;
  return githubToken() ? 2100 : 6500;
}

/** Consecutive queries returning nothing new before discovery gives up on the query plan. */
export function ingestDryQueryLimit(): number {
  const n = Number.parseInt(process.env.INGEST_DRY_QUERIES ?? "12", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 12;
}

/** Approved skins allowed to share one composition signature, differentiated by visual family
 *  and chrome. Hard-rejecting every repeat throws away most of a large ingest run. */
export function ingestSignatureCap(): number {
  const n = Number.parseInt(process.env.INGEST_SIGNATURE_CAP ?? "4", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 4;
}

export function ingestConcurrency(): number {
  const n = Number.parseInt(process.env.INGEST_CONCURRENCY ?? "4", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 4;
}

export function ingestMinConfidence(): number {
  const n = Number.parseFloat(process.env.INGEST_MIN_CONFIDENCE ?? "0.7");
  return Number.isFinite(n) ? Math.min(0.95, Math.max(0.45, n)) : 0.7;
}

export function ingestAutoApprove(): boolean {
  const v = (process.env.INGEST_AUTO_APPROVE ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false";
}

export function ingestUseLlm(): boolean {
  if (process.env.VITEST) return false;
  const v = (process.env.INGEST_USE_LLM ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false";
}

export type ScreenshotMode = "never" | "needed" | "always";

/**
 * When to render a template demo in a browser.
 * - `needed` (default): only when the capture changes an outcome — the candidate will actually
 *   draft a skin, has no features cached yet, and its visual attributes are still unmeasured.
 * - `always`: capture for every candidate that clears the license and robots gates.
 * - `never`: no browser is ever launched by ingest.
 */
export function ingestScreenshotMode(): ScreenshotMode {
  // Never launch a browser (and therefore never hit the real network) from the test suite unless
  // a test opts in explicitly, exactly as ingestUseLlm() does for the model.
  const fallback = process.env.VITEST ? "never" : "needed";
  const raw = (process.env.INGEST_SCREENSHOT ?? fallback).trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "never" || raw === "off") return "never";
  if (raw === "always" || raw === "all") return "always";
  return "needed";
}

export function ingestScreenshotConcurrency(): number {
  const n = Number.parseInt(process.env.INGEST_SCREENSHOT_CONCURRENCY ?? "2", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 6) : 2;
}

export function ingestScreenshotTimeoutMs(): number {
  const n = Number.parseInt(process.env.INGEST_SCREENSHOT_TIMEOUT_MS ?? "20000", 10);
  return Number.isFinite(n) && n >= 1000 ? Math.min(n, 60_000) : 20_000;
}

/** Internal-only review thumbnails. Gitignored; never bundled into a generated site. */
export function thumbsDir(): string {
  return process.env.INGEST_THUMBS_DIR?.trim() || path.resolve(process.cwd(), "data", "thumbs");
}

export function githubToken(): string | undefined {
  const token = process.env.GITHUB_TOKEN?.trim();
  return token || undefined;
}

export function ingestModel(): string | undefined {
  return process.env.OLLAMA_INGEST_MODEL ?? process.env.OLLAMA_MODEL ?? process.env.LLM_MODEL;
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
