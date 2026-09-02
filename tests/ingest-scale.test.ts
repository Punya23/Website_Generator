import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IngestStore, candidateLogPath } from "../src/admin/store.js";
import { checkSkinDedupe } from "../src/admin/approved-skins.js";
import { buildSearchQueries, searchGithubTemplates } from "../src/admin/discover-github.js";
import type { FetchLike } from "../src/admin/http-fetch.js";
import type { IngestCandidate } from "../src/admin/types.js";
import { classifyTaxonomy, industryCategory, taxonomyAffinity } from "../src/skins/taxonomy.js";
import { SITE_SKINS } from "../src/skins/catalog.js";
import type { SiteSkin } from "../src/skins/schema.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-scale-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  dirs.length = 0;
});

function candidate(overrides: Partial<IngestCandidate> & Pick<IngestCandidate, "id" | "originUrl">): IngestCandidate {
  return {
    sourceId: "src-1",
    title: overrides.id,
    status: "needs_review",
    licenseOk: true,
    events: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("taxonomy", () => {
  it("classifies industry, archetype and legacy category", () => {
    const dental = classifyTaxonomy("ClearSmile Dental family dentistry clinic cosmetic");
    expect(dental.industry).toBe("health-clinic");
    expect(dental.category).toBe("local-service");
    expect(dental.confidence).toBeGreaterThan(0);

    const law = classifyTaxonomy("Hartwell & Associates boutique litigation firm for founders");
    expect(law.industry).toBe("legal");
    expect(law.category).toBe("professional");

    const bakery = classifyTaxonomy("Moonrise Bakery artisan sourdough and pastries");
    expect(bakery.industry).toBe("cafe-bakery");
    expect(bakery.category).toBe("hospitality");

    const studio = classifyTaxonomy("Linea Studio sustainable residential architecture");
    expect(studio.industry).toBe("architecture");
    expect(studio.category).toBe("creative");
  });

  it("reads archetype from copy and falls back to the industry default", () => {
    expect(classifyTaxonomy("photography portfolio with selected works").archetype).toBe("portfolio");
    expect(classifyTaxonomy("dental clinic").archetype).toBe("booking");
    expect(classifyTaxonomy("api platform with dashboard and integrations").archetype).toBe("saas");
  });

  it("returns a deterministic default when nothing matches", () => {
    const empty = classifyTaxonomy("zzz qqq");
    expect(empty.industryScore).toBe(0);
    expect(empty.confidence).toBe(0);
    expect(industryCategory(empty.industry)).toBe("local-service");
  });

  it("ranks an industry-tagged skin above a category-only skin", () => {
    const match = classifyTaxonomy("Moonrise Bakery artisan sourdough and pastries");
    const base = SITE_SKINS.find((skin) => skin.categories.includes("hospitality"))!;
    const tagged: SiteSkin = { ...base, industries: ["cafe-bakery"], archetype: "storefront" };
    expect(taxonomyAffinity(tagged, match)).toBeGreaterThan(taxonomyAffinity(base, match));
  });
});

describe("ingest store at scale", () => {
  it("appends candidates to a log instead of rewriting the corpus", async () => {
    const dir = await tempDir();
    const storePath = path.join(dir, "ingest.json");
    const store = new IngestStore(storePath);

    for (let i = 0; i < 50; i += 1) {
      await store.upsertCandidate(
        candidate({ id: `c-${i}`, originUrl: `https://github.com/o/r${i}`, status: i % 2 ? "approved" : "needs_review" })
      );
    }

    const index = JSON.parse(await fs.readFile(storePath, "utf8"));
    expect(index.candidates).toEqual([]);
    const log = await fs.readFile(candidateLogPath(storePath), "utf8");
    expect(log.trim().split("\n")).toHaveLength(50);

    const reopened = new IngestStore(storePath);
    expect(await reopened.countCandidates()).toBe(50);
    expect(await reopened.countCandidates({ status: "approved" })).toBe(25);
    expect((await reopened.getCandidateByOrigin("https://github.com/o/r7"))?.id).toBe("c-7");
  });

  it("pages candidate listings and keeps the unpaged call intact", async () => {
    const dir = await tempDir();
    const store = new IngestStore(path.join(dir, "ingest.json"));
    for (let i = 0; i < 10; i += 1) {
      await store.upsertCandidate(candidate({ id: `c-${i}`, originUrl: `https://github.com/o/r${i}` }));
    }
    expect(await store.listCandidates()).toHaveLength(10);
    const page = await store.listCandidates({ limit: 4, offset: 2 });
    expect(page).toHaveLength(4);
    const all = await store.listCandidates();
    expect(page[0]?.id).toBe(all[2]?.id);
  });

  it("migrates a legacy single-file store into the append log", async () => {
    const dir = await tempDir();
    const storePath = path.join(dir, "ingest.json");
    await fs.writeFile(
      storePath,
      JSON.stringify({
        sources: [],
        runs: [],
        candidates: [candidate({ id: "legacy-1", originUrl: "https://github.com/o/legacy" })],
      }),
      "utf8"
    );

    const store = new IngestStore(storePath);
    expect((await store.getCandidate("legacy-1"))?.originUrl).toBe("https://github.com/o/legacy");
    const index = JSON.parse(await fs.readFile(storePath, "utf8"));
    expect(index.candidates).toEqual([]);
    expect(await fs.readFile(candidateLogPath(storePath), "utf8")).toContain("legacy-1");
  });

  it("survives a truncated tail line in the log", async () => {
    const dir = await tempDir();
    const storePath = path.join(dir, "ingest.json");
    const store = new IngestStore(storePath);
    await store.upsertCandidate(candidate({ id: "c-1", originUrl: "https://github.com/o/r1" }));
    await fs.appendFile(candidateLogPath(storePath), '{"id":"c-2","origin', "utf8");

    const reopened = new IngestStore(storePath);
    expect(await reopened.countCandidates()).toBe(1);
  });
});

describe("cluster dedupe", () => {
  const base = SITE_SKINS[0]!;

  it("rejects an exact signature repeat", () => {
    const verdict = checkSkinDedupe(base, [base], 4);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/Duplicate composition signature/);
  });

  it("admits the same layout under a different visual family up to the cap", () => {
    const variant: SiteSkin = { ...base, id: "v1", visualFamily: "luxury-dark" };
    expect(checkSkinDedupe(variant, [base], 4).ok).toBe(true);

    const cluster = [
      base,
      { ...base, id: "v1", visualFamily: "luxury-dark" } as SiteSkin,
      { ...base, id: "v2", visualFamily: "warm-consumer" } as SiteSkin,
    ];
    const full = checkSkinDedupe({ ...base, id: "v3", visualFamily: "clinical-light" }, cluster, 3);
    expect(full.ok).toBe(false);
    expect(full.reason).toMatch(/Layout cluster full/);
  });
});

describe("github discovery at scale", () => {
  it("plans topic × license × star-shard queries", () => {
    const queries = buildSearchQueries();
    expect(queries.length).toBeGreaterThan(100);
    expect(queries.some((q) => q.startsWith("topic:hugo-theme"))).toBe(true);
    expect(queries.some((q) => q.includes("stars:26..75"))).toBe(true);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("paginates a full page of results and classifies each repo", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      full_name: `owner/theme-${i}`,
      html_url: `https://github.com/owner/theme-${i}`,
      license: { spdx_id: "MIT" },
      description: i === 0 ? "Restaurant and bistro dining template" : "Landing template",
      topics: ["html-template"],
      stargazers_count: 40,
    }));
    const page2 = [
      {
        full_name: "owner/tail",
        html_url: "https://github.com/owner/tail",
        license: { spdx_id: "MIT" },
        description: "Photography portfolio template",
        stargazers_count: 12,
      },
    ];

    const seen: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      seen.push(url);
      const page = new URL(url).searchParams.get("page");
      const items = page === "1" ? page1 : page === "2" ? page2 : [];
      return new Response(JSON.stringify({ items }), { status: 200 });
    };

    const repos = await searchGithubTemplates(fetchImpl, { max: 500, pagesPerQuery: 3, delayMs: 0 });
    expect(repos.length).toBe(101);
    expect(seen.some((url) => new URL(url).searchParams.get("page") === "2")).toBe(true);
    expect(repos.find((r) => r.name === "owner/theme-0")?.industry).toBe("restaurant");
    expect(repos.find((r) => r.name === "owner/tail")?.industry).toBe("photography");
    expect(repos.find((r) => r.name === "owner/tail")?.archetype).toBe("portfolio");
  });

  it("stops walking the query plan once queries stop yielding anything new", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          items: [
            {
              full_name: "owner/only",
              html_url: "https://github.com/owner/only",
              license: { spdx_id: "MIT" },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const repos = await searchGithubTemplates(fetchImpl, { max: 5000, delayMs: 0 });
    expect(repos).toHaveLength(1);
    expect(calls).toBeLessThan(buildSearchQueries().length);
  });
});
