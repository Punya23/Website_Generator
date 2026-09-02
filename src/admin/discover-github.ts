import { inspectIngestUrl, isBlockedHost, normalizeSpdx } from "./policy.js";
import { parseGithubRepo } from "./extract-outline.js";
import { fetchJson, type FetchLike } from "./http-fetch.js";
import {
  ingestDryQueryLimit,
  ingestMaxPerRun,
  ingestMaxQueries,
  ingestSearchDelayMs,
  ingestSearchPages,
} from "./config.js";
import type { IngestSource, SkinCategoryDefault } from "./types.js";
import { PERMISSIVE_LICENSES } from "./types.js";
import { IngestStore } from "./store.js";
import {
  classifyTaxonomy,
  industryCategory,
  type Industry,
  type SiteArchetype,
} from "../skins/taxonomy.js";

/** Free-text searches. Broad on purpose — the license filter and policy allowlist do the gating. */
const SEARCH_TERMS = [
  "landing page",
  "hugo-theme",
  "astro theme",
  "tailwind template",
  "nextjs starter",
  "website template",
  "portfolio template",
  "business template",
  "restaurant template",
  "agency template",
];

/** Topic queries return far denser template hits than free text, so they run first. */
const SEARCH_TOPICS = [
  "hugo-theme",
  "astro-theme",
  "jekyll-theme",
  "eleventy-template",
  "nextjs-template",
  "landing-page-template",
  "html-template",
  "tailwindcss-template",
  "bootstrap-template",
  "portfolio-template",
  "website-template",
  "onepage",
];

const LICENSES = ["mit", "apache-2.0", "bsd-3-clause", "cc0-1.0"];

/**
 * GitHub caps any single search query at 1000 results (10 pages × 100). Slicing the same query by
 * star band multiplies the reachable corpus instead of re-reading the same top-1000 repos.
 */
const STAR_SHARDS = ["5..25", "26..75", "76..250", "251..1000", ">1000"];

interface GithubSearchItem {
  full_name?: string;
  html_url?: string;
  homepage?: string | null;
  description?: string | null;
  license?: { spdx_id?: string } | null;
  has_pages?: boolean;
  owner?: { login?: string };
  name?: string;
  topics?: string[];
  stargazers_count?: number;
  default_branch?: string;
}

interface GithubSearchResponse {
  items?: GithubSearchItem[];
}

export interface DiscoveredRepo {
  originUrl: string;
  demoUrl?: string;
  name: string;
  license?: string;
  description?: string;
  topics?: string[];
  stars?: number;
  industry: Industry;
  archetype: SiteArchetype;
  category: SkinCategoryDefault;
}

function classifyRepo(text: string): Pick<DiscoveredRepo, "industry" | "archetype" | "category"> {
  const match = classifyTaxonomy(text);
  return {
    industry: match.industry,
    archetype: match.archetype,
    category: match.industryScore > 0 ? match.category : "creative",
  };
}

function demoFromItem(item: GithubSearchItem): string | undefined {
  const homepage = item.homepage?.trim();
  if (homepage && /^https?:\/\//i.test(homepage) && !isBlockedHost(homepage)) {
    const check = inspectIngestUrl(homepage, {
      role: "demo",
      originUrl: item.html_url,
    });
    if (check.ok) return homepage;
  }
  const owner = item.owner?.login ?? parseGithubRepo(item.html_url ?? "")?.owner;
  const repo = item.name ?? parseGithubRepo(item.html_url ?? "")?.repo;
  if (item.has_pages && owner && repo) {
    return `https://${owner}.github.io/${repo}/`;
  }
  return undefined;
}

/** Query plan, densest first: topic × license × star shard, then free text × license. */
export function buildSearchQueries(): string[] {
  const queries: string[] = [];
  for (const shard of STAR_SHARDS) {
    for (const topic of SEARCH_TOPICS) {
      for (const license of LICENSES) {
        queries.push(`topic:${topic} license:${license} stars:${shard}`);
      }
    }
  }
  for (const term of SEARCH_TERMS) {
    for (const license of LICENSES) {
      queries.push(`${term} license:${license} stars:>5`);
    }
  }
  return queries;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined);

export async function searchGithubTemplates(
  fetchImpl: FetchLike,
  options: { max?: number; pagesPerQuery?: number; maxQueries?: number; delayMs?: number } = {}
): Promise<DiscoveredRepo[]> {
  const max = options.max ?? ingestMaxPerRun();
  const pagesPerQuery = options.pagesPerQuery ?? ingestSearchPages();
  const maxQueries = options.maxQueries ?? ingestMaxQueries();
  const delayMs = options.delayMs ?? ingestSearchDelayMs();
  const dryLimit = ingestDryQueryLimit();

  const found = new Map<string, DiscoveredRepo>();
  let queriesRun = 0;
  let dryStreak = 0;

  for (const query of buildSearchQueries()) {
    if (found.size >= max || queriesRun >= maxQueries || dryStreak >= dryLimit) break;
    let newThisQuery = 0;

    for (let page = 1; page <= pagesPerQuery; page += 1) {
      if (found.size >= max) break;
      if (queriesRun > 0) await sleep(delayMs);
      queriesRun += 1;
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100&page=${page}`;
      const body = await fetchJson<GithubSearchResponse>(fetchImpl, url);
      const items = body?.items ?? [];
      for (const item of items) {
        if (!item.html_url || found.has(item.html_url)) continue;
        if (!inspectIngestUrl(item.html_url).ok) continue;
        const name = item.full_name ?? item.name ?? "GitHub template";
        const description = item.description ?? undefined;
        found.set(item.html_url, {
          originUrl: item.html_url,
          demoUrl: demoFromItem(item),
          name,
          license: normalizeSpdx(item.license?.spdx_id),
          description,
          topics: item.topics,
          stars: item.stargazers_count,
          ...classifyRepo([name, description ?? "", (item.topics ?? []).join(" ")].join(" ")),
        });
        newThisQuery += 1;
        if (found.size >= max) break;
      }
      // Fewer than a full page back means the query is exhausted; further pages are empty.
      if (items.length < 100) break;
      if (queriesRun >= maxQueries) break;
    }

    dryStreak = newThisQuery === 0 ? dryStreak + 1 : 0;
  }

  return [...found.values()];
}

export async function upsertDiscoveredSources(
  store: IngestStore,
  repos: DiscoveredRepo[]
): Promise<{ created: IngestSource[]; skipped: number }> {
  const existing = await store.listSources();
  const byOrigin = new Set(existing.map((row) => row.originUrl));
  const created: IngestSource[] = [];
  let skipped = 0;
  for (const repo of repos) {
    if (byOrigin.has(repo.originUrl)) {
      skipped += 1;
      continue;
    }
    const license =
      repo.license && (PERMISSIVE_LICENSES as readonly string[]).includes(repo.license)
        ? (repo.license as IngestSource["expectedLicense"])
        : "MIT";
    const source = await store.upsertSource({
      name: repo.name.slice(0, 80),
      kind: "github",
      originUrl: repo.originUrl,
      demoUrl: repo.demoUrl,
      expectedLicense: license,
      defaultCategory: repo.category ?? industryCategory(repo.industry),
      industry: repo.industry,
      archetype: repo.archetype,
      stars: repo.stars,
      notes: repo.description?.slice(0, 240),
      status: "active",
    });
    byOrigin.add(repo.originUrl);
    created.push(source);
  }
  return { created, skipped };
}
