import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IngestStore, candidateLogPath } from "../src/admin/store.js";
import { runIngestPipeline, verifyCandidate, type FetchLike } from "../src/admin/pipeline.js";
import { loadApprovedSkins } from "../src/admin/approved-skins.js";
import type { IngestCandidate, IngestSource } from "../src/admin/types.js";

const MIT = `MIT License

Copyright (c) 2024 Example

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files.
`;

// Same fixture proven elsewhere (tests/admin-ingest.test.ts) to score above the default
// INGEST_MIN_CONFIDENCE and auto-approve — both sources below serve this identical demo, so both
// candidates land on the same demo <title> and therefore the same draft-skin base slug.
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
    if (url.includes("github.io")) {
      return new Response(DEMO_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("missing", { status: 404 });
  };
}

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

describe("ingest pipeline robustness", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("reserves a draft-skin id the instant it is computed, so two concurrent verifyCandidate calls sharing one existingIds array never land on the same id", async () => {
    // This isolates exactly the mechanism the fix touches — runIngestPipeline's chunked mapPool
    // shares one `existingIds` array across the concurrent verifyCandidate calls in a chunk, so
    // two forks of the same theme (same title -> same draftSkinFromRecipe base slug) processed
    // side by side must still come out with distinct ids. Driving verifyCandidate directly with
    // Promise.all (rather than through the full run loop) reproduces the concurrency without
    // pulling in the default seed sources or the composition-signature dedupe, neither of which
    // this fix is about.
    const fakeSource = (id: string): IngestSource => ({
      id,
      name: id,
      kind: "github",
      originUrl: `https://github.com/example/${id}`,
      expectedLicense: "MIT",
      defaultCategory: "creative",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const fakeCandidate = (id: string, originUrl: string): IngestCandidate => ({
      id,
      sourceId: id,
      title: "Start Bootstrap Landing",
      originUrl,
      // verifyCandidate recomputes licenseOk from licenseDetected on entry (isPermissiveLicense),
      // so licenseOk alone is not enough to stand in for a verified license here.
      licenseDetected: "MIT",
      licenseOk: true,
      status: "verifying",
      events: [],
      createdAt: 1,
      updatedAt: 1,
      outline: {
        title: "Start Bootstrap Landing",
        headings: [
          { level: 1, text: "Generate more leads" },
          { level: 2, text: "Fully Responsive Features" },
          { level: 2, text: "Showcase your work" },
          { level: 2, text: "What people are saying" },
          { level: 2, text: "Ready to get started?" },
        ],
        landmarks: ["hero", "features", "gallery", "testimonials", "cta"],
      },
    });

    const existingIds: string[] = [];
    const [verifiedA, verifiedB] = await Promise.all([
      verifyCandidate(
        fakeCandidate("cand-a", "https://github.com/example/fork-a"),
        fakeSource("fork-a"),
        existingIds
      ),
      verifyCandidate(
        fakeCandidate("cand-b", "https://github.com/example/fork-b"),
        fakeSource("fork-b"),
        existingIds
      ),
    ]);

    expect(verifiedA.draftSkin).toBeTruthy();
    expect(verifiedB.draftSkin).toBeTruthy();
    expect(verifiedA.draftSkin!.id).not.toBe(verifiedB.draftSkin!.id);
    // Both ids must actually be reserved in the shared array a caller (the run loop) reuses for
    // the next chunk — not just distinct from each other.
    expect(existingIds).toContain(verifiedA.draftSkin!.id);
    expect(existingIds).toContain(verifiedB.draftSkin!.id);
  });

  it("does not demote an already-approved candidate or re-publish its skin on a repeat run", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-robust-"));
    dirs.push(dir);
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "wg-robust-cwd-"));
    dirs.push(work);
    const store = new IngestStore(path.join(dir, "ingest.json"));
    const source = await store.upsertSource({
      name: "Repeat run source",
      kind: "github",
      originUrl: "https://github.com/example/repeat-run",
      demoUrl: "https://example-repeat.github.io/theme/",
      expectedLicense: "MIT",
      defaultCategory: "creative",
    });

    await withCwd(work, async () => {
      // Scoped to this one source (not the default-seeded "process every active source" branch)
      // so the default seed sources — one of which serves this exact fixture's own demo host
      // pattern — cannot compete for the same composition signature and confound the assertions.
      for await (const _ of runIngestPipeline(store, { sourceId: source.id, fetchImpl: mockFetch() })) {
        void _;
      }
      const first = (await store.listCandidates({ sourceId: source.id }))[0]!;
      expect(first.status).toBe("approved");
      const firstSkinId = first.draftSkin!.id;
      expect(loadApprovedSkins()).toHaveLength(1);

      const events2 = [];
      for await (const event of runIngestPipeline(store, { sourceId: source.id, fetchImpl: mockFetch() })) {
        events2.push(event);
      }
      const done2 = events2.find((e) => e.type === "done");
      // A no-op re-run must report no fresh work and no rejected duplicates.
      expect(done2?.stats?.skippedDup).toBe(0);
      expect(done2?.stats?.approved).toBe(0);
      expect(done2?.stats?.needsReview).toBe(0);

      const second = (await store.listCandidates({ sourceId: source.id }))[0]!;
      expect(second.status).toBe("approved");
      expect(second.draftSkin!.id).toBe(firstSkinId);

      const approvedAfter = loadApprovedSkins();
      expect(approvedAfter).toHaveLength(1);
      expect(approvedAfter[0]!.id).toBe(firstSkinId);

      expect(events2.some((e) => e.line?.includes("already approved — skipping re-ingest"))).toBe(
        true
      );
    });
  });

  it("updates a blocked source's existing candidate row instead of appending a new one every run", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-robust-"));
    dirs.push(dir);
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "wg-robust-cwd-"));
    dirs.push(work);
    const store = new IngestStore(path.join(dir, "ingest.json"));
    const source = await store.upsertSource({
      name: "Blocked demo host",
      kind: "github",
      originUrl: "https://github.com/example/blocked-demo",
      demoUrl: "https://blocked.framer.com/theme",
      expectedLicense: "MIT",
      defaultCategory: "creative",
    });

    const neverCalled: FetchLike = async () => {
      throw new Error("a blocked source must never reach the network");
    };

    await withCwd(work, async () => {
      for await (const _ of runIngestPipeline(store, { sourceId: source.id, fetchImpl: neverCalled })) {
        void _;
      }
      const firstRows = await store.listCandidates({ sourceId: source.id });
      expect(firstRows).toHaveLength(1);
      expect(firstRows[0]?.status).toBe("blocked");
      const firstId = firstRows[0]!.id;

      for await (const _ of runIngestPipeline(store, { sourceId: source.id, fetchImpl: neverCalled })) {
        void _;
      }
      const secondRows = await store.listCandidates({ sourceId: source.id });
      expect(secondRows).toHaveLength(1);
      expect(secondRows[0]?.id).toBe(firstId);
      expect(secondRows[0]?.status).toBe("blocked");
    });
  });

  it("quarantines an unparseable index instead of silently reseeding and overwriting it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-robust-"));
    dirs.push(dir);
    const storePath = path.join(dir, "ingest.json");
    const garbage = '{"sources": [ this is not valid json';
    await fs.writeFile(storePath, garbage, "utf8");

    const store = new IngestStore(storePath);
    await expect(store.listSources()).rejects.toThrow(/not valid JSON/i);

    // The original file must survive untouched — no silent reseed-and-overwrite.
    expect(await fs.readFile(storePath, "utf8")).toBe(garbage);

    const entries = await fs.readdir(dir);
    const backup = entries.find((name) => name.includes(".corrupt-"));
    expect(backup).toBeTruthy();
    expect(await fs.readFile(path.join(dir, backup!), "utf8")).toBe(garbage);
  });

  it("recovers a valid index but drops only the one row that fails schema validation", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-robust-"));
    dirs.push(dir);
    const storePath = path.join(dir, "ingest.json");
    await fs.writeFile(
      storePath,
      JSON.stringify({
        sources: [
          { not: "a valid source at all" },
          {
            id: "src-good",
            name: "Good source",
            kind: "github",
            originUrl: "https://github.com/example/good",
            expectedLicense: "MIT",
            defaultCategory: "creative",
            status: "active",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        runs: [],
        candidates: [],
      }),
      "utf8"
    );

    const store = new IngestStore(storePath);
    const sources = await store.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.id).toBe("src-good");
  });

  it("never leaves a temp file behind after an index write", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-robust-"));
    dirs.push(dir);
    const store = new IngestStore(path.join(dir, "ingest.json"));
    await store.upsertSource({
      name: "Any source",
      kind: "github",
      originUrl: "https://github.com/example/any",
    });
    const entries = await fs.readdir(dir);
    expect(entries.some((name) => name.includes(".tmp-"))).toBe(false);
    expect(entries).toContain("ingest.json");
  });

  it("does not disturb the append-only candidate log when the index is rewritten", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-robust-"));
    dirs.push(dir);
    const storePath = path.join(dir, "ingest.json");
    const store = new IngestStore(storePath);
    await store.upsertSource({ name: "Source S", kind: "github", originUrl: "https://github.com/e/s" });
    await store.upsertCandidate({
      id: "c-1",
      sourceId: "s-1",
      title: "T",
      originUrl: "https://github.com/e/c1",
      status: "needs_review",
      licenseOk: false,
      events: [],
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await fs.readFile(candidateLogPath(storePath), "utf8")).toContain("c-1");
    expect(JSON.parse(await fs.readFile(storePath, "utf8")).candidates).toEqual([]);
  });
});
