import { githubToken } from "./config.js";

export const INGEST_UA = "website-generator-ingest/1.0 (+local-admin)";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function ingestHeaders(url: string, extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "text/plain, text/html, application/vnd.github+json",
    "User-Agent": INGEST_UA,
  };
  const token = githubToken();
  if (token && /github\.com|githubusercontent\.com/i.test(url)) {
    headers.Authorization = `Bearer ${token}`;
  }
  return { ...headers, ...(extra as Record<string, string> | undefined) };
}

/** Minimum gap between requests to the same host. Thousands of template demos cluster on a
 *  handful of hosts (github.io, vercel.app), so politeness has to be per-host, not global. */
const HOST_MIN_INTERVAL_MS = process.env.VITEST ? 0 : 400;
const nextAllowedAt = new Map<string, number>();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

async function throttleHost(url: string): Promise<void> {
  if (HOST_MIN_INTERVAL_MS <= 0) return;
  const host = hostOf(url);
  const now = Date.now();
  const allowedAt = nextAllowedAt.get(host) ?? 0;
  const wait = allowedAt - now;
  nextAllowedAt.set(host, Math.max(now, allowedAt) + HOST_MIN_INTERVAL_MS);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

function retryAfterMs(res: Response): number | undefined {
  const header = res.headers?.get?.("retry-after");
  if (header) {
    const seconds = Number.parseInt(header, 10);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  }
  const reset = res.headers?.get?.("x-ratelimit-reset");
  if (reset) {
    const at = Number.parseInt(reset, 10) * 1000;
    if (Number.isFinite(at)) return Math.min(Math.max(0, at - Date.now()), 60_000);
  }
  return undefined;
}

export async function fetchText(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs = 12_000,
  attempts = 3
): Promise<string | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await throttleHost(url);
      const res = await fetchImpl(url, {
        headers: ingestHeaders(url),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.text();
      // 403 is how GitHub reports both primary and secondary rate limits; 429 is the explicit
      // form. Anything else (404, 451, 5xx on a dead demo) is not worth retrying.
      if (res.status !== 403 && res.status !== 429) return undefined;
      if (attempt === attempts - 1) return undefined;
      const wait = retryAfterMs(res) ?? Math.min(2_000 * 2 ** attempt, 30_000);
      if (process.env.VITEST) return undefined;
      await new Promise((resolve) => setTimeout(resolve, wait));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Per-origin robots.txt memo for the life of the process. Thousands of template demos share a
 *  handful of hosts, so re-fetching robots.txt per candidate is pure waste. `null` means the file
 *  was absent or unreadable, which is treated as "no restrictions". */
const robotsCache = new Map<string, string | null>();

export async function fetchRobots(fetchImpl: FetchLike, origin: string): Promise<string | null> {
  const cached = robotsCache.get(origin);
  if (cached !== undefined) return cached;
  const body = (await fetchText(fetchImpl, `${origin}/robots.txt`)) ?? null;
  robotsCache.set(origin, body);
  return body;
}

export function clearRobotsCache(): void {
  robotsCache.clear();
}

export async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs = 15_000
): Promise<T | undefined> {
  const body = await fetchText(fetchImpl, url, timeoutMs);
  if (!body) return undefined;
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
}
