/**
 * Free/open image providers — no vertical hardcoding.
 * Priority: Openverse (CC search) → optional API keys → Picsum (deterministic fallback).
 */

export interface ImageRequest {
  query: string;
  seed: string;
  width?: number;
  height?: number;
}

const cache = new Map<string, string>();

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function cacheKey(req: ImageRequest): string {
  return `${req.query}|${req.seed}|${req.width ?? 0}x${req.height ?? 0}`;
}

function picsumUrl(req: ImageRequest): string {
  const w = req.width ?? 1200;
  const h = req.height ?? 800;
  const seed = hashSeed(`${req.seed}-${req.query}`);
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

async function openverseUrl(query: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      q: query.slice(0, 80) || "business",
      page_size: "20",
      license: "cc0,pdm",
    });
    const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ url?: string; thumbnail?: string }>;
    };
    const results = data.results?.filter((r) => r.url) ?? [];
    if (results.length === 0) return null;
    const pick = results[hashSeed(query) % results.length]!;
    return pick.url ?? pick.thumbnail ?? null;
  } catch {
    return null;
  }
}

async function pexelsUrl(query: string, seed: string): Promise<string | null> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) return null;
  try {
    const params = new URLSearchParams({
      query: query.slice(0, 80) || "business",
      per_page: "20",
      orientation: "landscape",
    });
    const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      photos?: Array<{ src?: { large2x?: string; large?: string; landscape?: string } }>;
    };
    const photos = data.photos ?? [];
    if (photos.length === 0) return null;
    const photo = photos[hashSeed(seed + query) % photos.length];
    return photo?.src?.large ?? photo?.src?.medium ?? photo?.src?.landscape ?? null;
  } catch {
    return null;
  }
}

async function pixabayUrl(query: string, seed: string): Promise<string | null> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return null;
  try {
    const params = new URLSearchParams({
      key,
      q: query.slice(0, 80) || "business",
      image_type: "photo",
      per_page: "20",
      safesearch: "true",
    });
    const res = await fetch(`https://pixabay.com/api/?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      hits?: Array<{ largeImageURL?: string; webformatURL?: string }>;
    };
    const hits = data.hits ?? [];
    if (hits.length === 0) return null;
    const hit = hits[hashSeed(seed + query) % hits.length];
    return hit?.largeImageURL ?? hit?.webformatURL ?? null;
  } catch {
    return null;
  }
}

/** Resolve a hotlinkable image URL for any business/query — provider-agnostic. */
export async function resolveImageUrl(req: ImageRequest): Promise<string> {
  const key = cacheKey(req);
  const hit = cache.get(key);
  if (hit) return hit;

  const query = req.query.trim() || "professional business";

  const providers: Array<() => Promise<string | null>> = [];
  if (process.env.PEXELS_API_KEY?.trim()) {
    providers.push(() => pexelsUrl(query, req.seed));
  }
  providers.push(() => openverseUrl(query));
  if (process.env.PIXABAY_API_KEY?.trim()) {
    providers.push(() => pixabayUrl(query, req.seed));
  }

  for (const provider of providers) {
    const url = await provider();
    if (url && isAllowedImageUrl(url)) {
      const optimized = optimizeImageUrl(url, req.width ?? 960, req.height ?? 640);
      cache.set(key, optimized);
      return optimized;
    }
  }

  const fallback = picsumUrl(req);
  cache.set(key, fallback);
  return fallback;
}

export function activeImageProviders(): string[] {
  const list: string[] = [];
  if (process.env.PEXELS_API_KEY?.trim()) list.push("pexels");
  list.push("openverse");
  if (process.env.PIXABAY_API_KEY?.trim()) list.push("pixabay");
  list.push("picsum");
  return list;
}

export function resolveImageUrlSync(req: ImageRequest): string {
  const key = cacheKey(req);
  return cache.get(key) ?? picsumUrl(req);
}

/** Downscale hotlinked CDN images so heroes/cards don't load multi-megapixel assets. */
export function optimizeImageUrl(url: string, width = 960, height = 640): string {
  if (!url.startsWith("https://")) return url;
  if (url.includes("images.pexels.com/")) {
    const u = new URL(url);
    u.searchParams.set("auto", "compress");
    u.searchParams.set("cs", "tinysrgb");
    u.searchParams.set("w", String(width));
    u.searchParams.set("h", String(height));
    u.searchParams.set("dpr", "1");
    return u.toString();
  }
  if (url.includes("picsum.photos/")) {
    const parts = url.replace(/\/$/, "").split("/");
    const seedIdx = parts.indexOf("seed");
    if (seedIdx >= 0 && parts[seedIdx + 1]) {
      return `https://picsum.photos/seed/${parts[seedIdx + 1]}/${width}/${height}`;
    }
  }
  return url;
}

export function isAllowedImageUrl(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  const blocked = /placeholder|via\.placeholder|dummyimage/i;
  return !blocked.test(url);
}

export function clearImageCache(): void {
  cache.clear();
}
