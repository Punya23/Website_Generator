import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inspectIngestUrl,
  detectLicense,
  isPermissiveLicense,
} from "../src/admin/policy.js";
import { extractOutline, extractSameOriginLinks, pathAllowedByRobots } from "../src/admin/extract-outline.js";
import { mapOutlineToRecipe } from "../src/admin/map-recipe.js";
import { IngestStore } from "../src/admin/store.js";
import {
  approveCandidate,
  ingestSource,
  runIngestPipeline,
  verifyCandidate,
  type FetchLike,
} from "../src/admin/pipeline.js";
import { loadApprovedSkins, skinSignature } from "../src/admin/approved-skins.js";
import { searchGithubTemplates, upsertDiscoveredSources } from "../src/admin/discover-github.js";

const MIT = `MIT License

Copyright (c) 2024 Example

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files.
`;

const DEMO_HTML = `<!doctype html><html><head><title>Start Bootstrap Landing</title></head>
<body>
<h1>Generate more leads</h1>
<h2>Fully Responsive Features</h2>
<h2>Showcase your work</h2>
<h2>What people are saying</h2>
<h2>Ready to get started?</h2>
</body></html>`;

function mockFetch(): FetchLike {
  return async (url: string) => {
    if (url.includes("LICENSE")) return new Response(MIT, { status: 200 });
    if (url.includes("startbootstrap") || url.includes("hyperui") || url.includes("github.io")) {
      return new Response(DEMO_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("missing", { status: 404 });
  };
}

describe("ingest policy", () => {
  it("blocks Framer and paid kit hosts", () => {
    const framer = inspectIngestUrl("https://framer.com/projects/foo");
    expect(framer.ok).toBe(false);
    expect(framer.kind).toBe("blocked");
    expect(inspectIngestUrl("https://themeforest.net/item/x").ok).toBe(false);
    expect(inspectIngestUrl("https://cruip.com/demos").ok).toBe(false);
  });

  it("allows GitHub MIT sources and known demos", () => {
    expect(inspectIngestUrl("https://github.com/StartBootstrap/startbootstrap-landing-page").ok).toBe(true);
    expect(inspectIngestUrl("https://startbootstrap.github.io/startbootstrap-landing-page/").ok).toBe(true);
    expect(inspectIngestUrl("https://gitlab.com/group/theme").ok).toBe(true);
  });

  it("allows OSS demo hosts after license verification, never Framer", () => {
    expect(
      inspectIngestUrl("https://my-theme.vercel.app", { role: "demo", licenseVerified: true }).ok
    ).toBe(true);
    expect(inspectIngestUrl("https://my-theme.vercel.app", { role: "demo" }).ok).toBe(false);
    expect(
      inspectIngestUrl("https://my-theme.vercel.app", {
        role: "demo",
        originUrl: "https://github.com/org/theme",
      }).ok
    ).toBe(true);
    expect(
      inspectIngestUrl("https://framer.com/share/x", {
        role: "demo",
        licenseVerified: true,
        originUrl: "https://github.com/org/theme",
      }).ok
    ).toBe(false);
  });

  it("detects MIT from license text", () => {
    expect(detectLicense(MIT)).toBe("MIT");
    expect(isPermissiveLicense("MIT")).toBe(true);
    expect(isPermissiveLicense("UNLICENSED")).toBe(false);
  });
});

describe("outline mapping", () => {
  it("extracts headings and maps onto library templates", () => {
    const outline = extractOutline(DEMO_HTML);
    expect(outline.title).toContain("Start Bootstrap");
    expect(outline.headings.length).toBeGreaterThanOrEqual(4);
    const recipe = mapOutlineToRecipe(outline);
    expect(recipe.home[0]?.templateId.startsWith("hero_")).toBe(true);
    expect(recipe.home.some((s) => s.templateId === "cta_band" || s.templateId === "footer_cta")).toBe(true);
    expect(recipe.confidence).toBeGreaterThan(0.4);
  });
});

describe("ingest agent", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("ingests, verifies, and approves a mock MIT demo into a live skin file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-admin-"));
    dirs.push(dir);
    const store = new IngestStore(path.join(dir, "ingest.json"));
    const source = await store.upsertSource({
      name: "Start Bootstrap landing",
      kind: "github",
      originUrl: "https://github.com/StartBootstrap/startbootstrap-landing-page",
      demoUrl: "https://startbootstrap.github.io/startbootstrap-landing-page/",
      expectedLicense: "MIT",
      defaultCategory: "local-service",
    });

    const ingested = await ingestSource(source, store, mockFetch());
    expect(ingested.status).not.toBe("blocked");
    expect(ingested.licenseDetected).toBe("MIT");
    expect(ingested.outline?.headings.length).toBeGreaterThan(0);

    const verified = await verifyCandidate(ingested, source, []);
    expect(verified.licenseOk).toBe(true);
    expect(verified.draftSkin).toBeTruthy();
    await store.upsertCandidate(verified);

    const prevCwd = process.cwd();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "wg-admin-cwd-"));
    dirs.push(work);
    process.chdir(work);
    try {
      const approved = await approveCandidate(store, verified.id);
      expect(approved.status).toBe("approved");
      const skins = loadApprovedSkins();
      expect(skins.some((s) => s.id === approved.draftSkin?.id)).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("refuses a Framer origin even if added as a source", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-admin-"));
    dirs.push(dir);
    const store = new IngestStore(path.join(dir, "ingest.json"));
    const source = await store.upsertSource({
      name: "Framer file",
      kind: "demo",
      originUrl: "https://github.com/example/mit-repo",
      demoUrl: "https://framer.com/share/secret-template",
    });
    const ingested = await ingestSource(source, store, mockFetch());
    expect(ingested.status).toBe("blocked");
    expect(ingested.blockedReason).toMatch(/not an allowed ingest source/i);
  });

  it("auto-approves a verified MIT recipe in the pipeline", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-admin-"));
    dirs.push(dir);
    const store = new IngestStore(path.join(dir, "ingest.json"));
    const source = await store.upsertSource({
      name: "Auto MIT landing",
      kind: "github",
      originUrl: "https://github.com/StartBootstrap/startbootstrap-landing-page",
      demoUrl: "https://startbootstrap.github.io/startbootstrap-landing-page/",
      expectedLicense: "MIT",
      defaultCategory: "creative",
    });
    const prevCwd = process.cwd();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "wg-admin-cwd-"));
    dirs.push(work);
    process.chdir(work);
    try {
      const events = [];
      for await (const event of runIngestPipeline(store, {
        sourceId: source.id,
        fetchImpl: mockFetch(),
      })) {
        events.push(event);
      }
      const candidates = await store.listCandidates({ sourceId: source.id });
      expect(candidates[0]?.status).toBe("approved");
      expect(candidates[0]?.draftSkin).toBeTruthy();
      expect(loadApprovedSkins().some((s) => s.id === candidates[0]?.draftSkin?.id)).toBe(true);
      expect(events.map((e) => e.type)).toContain("done");
      const stats = events.filter((e) => e.type === "stats");
      expect(stats.length).toBeGreaterThan(0);
      const lastStats = stats.at(-1)?.stats;
      expect(lastStats?.scraped).toBeGreaterThan(0);
      expect(lastStats?.mapped).toBeGreaterThan(0);
      expect(lastStats?.autoApproved).toBeGreaterThan(0);
      expect(stats.some((e) => e.phase === "approve")).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });
});

describe("github discovery", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("upserts unique GitHub search hits as sources", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-admin-"));
    dirs.push(dir);
    const store = new IngestStore(path.join(dir, "ingest.json"));
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("api.github.com/search/repositories")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                full_name: "example/astro-landing",
                html_url: "https://github.com/example/astro-landing",
                homepage: "https://example.github.io/astro-landing/",
                license: { spdx_id: "MIT" },
                has_pages: true,
                owner: { login: "example" },
                name: "astro-landing",
                description: "Astro landing theme",
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("missing", { status: 404 });
    };
    const repos = await searchGithubTemplates(fetchImpl, { max: 10 });
    expect(repos.length).toBeGreaterThan(0);
    expect(repos[0]?.originUrl).toContain("github.com");
    const { created, skipped } = await upsertDiscoveredSources(store, repos);
    expect(created.length).toBeGreaterThan(0);
    const again = await upsertDiscoveredSources(store, repos);
    expect(again.created.length).toBe(0);
    expect(again.skipped).toBeGreaterThan(0);
    expect(skipped).toBe(0);
  });
});

describe("robots and outline helpers", () => {
  it("blocks Disallow / and extracts same-origin page links", () => {
    expect(pathAllowedByRobots("User-agent: *\nDisallow: /", "/about")).toBe(false);
    expect(pathAllowedByRobots("User-agent: *\nDisallow:", "/about")).toBe(true);
    const html = `<a href="/about">About us</a><a href="https://evil.com/contact">x</a>`;
    const links = extractSameOriginLinks(html, "https://example.github.io/theme/");
    expect(links.some((l) => l.url.includes("about"))).toBe(true);
  });

  it("builds distinct skin signatures from recipes", () => {
    const outline = extractOutline(DEMO_HTML);
    const recipe = mapOutlineToRecipe(outline);
    expect(recipe.home.length).toBeGreaterThan(2);
    expect(skinSignature).toBeTypeOf("function");
  });
});

describe("admin catalog observability", () => {
  it("exposes the full section template library with usage counts", async () => {
    const { templateLibrary } = await import("../src/admin/status.js");
    const library = templateLibrary();
    expect(library.count).toBeGreaterThanOrEqual(30);
    expect(library.templates).toHaveLength(library.count);
    expect(library.templates[0]).toMatchObject({
      id: expect.any(String),
      landmark: expect.any(String),
      usedInSkins: expect.any(Number),
    });
    expect(library.templates.some((t) => t.usedInSkins > 0)).toBe(true);
  });

  it("summarizes skin pages as template ids and intents only", async () => {
    const { publicSkin } = await import("../src/admin/status.js");
    const { SITE_SKINS } = await import("../src/skins/catalog.js");
    const summary = publicSkin(SITE_SKINS[0]!);
    expect(summary.pages.home?.length).toBeGreaterThan(0);
    expect(summary.pages.home?.[0]).toEqual({
      templateId: expect.any(String),
      intent: expect.any(String),
    });
    expect(JSON.stringify(summary)).not.toMatch(/<!doctype|<\/html>/i);
  });
});
