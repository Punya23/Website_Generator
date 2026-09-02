import { randomUUID } from "node:crypto";
import { detectLicense, inspectIngestUrl, isPermissiveLicense, normalizeSpdx } from "./policy.js";
import {
  extractOutline,
  extractSameOriginLinks,
  inferPageSlug,
  parseGithubRepo,
  pathAllowedByRobots,
} from "./extract-outline.js";
import { draftSkinFromRecipe, mapOutlineToRecipe } from "./map-recipe.js";
import { captureThemeFeatures, pruneThumbnails } from "./theme-features.js";
import { mapOutlineWithLlm } from "./llm-map-recipe.js";
import { checkSkinDedupe, loadApprovedSkins, saveApprovedSkin } from "./approved-skins.js";
import { SITE_SKINS } from "../skins/catalog.js";
import type { IngestCandidate, IngestRun, IngestSource, PageOutline } from "./types.js";
import { IngestStore } from "./store.js";
import { fetchRobots, fetchText, type FetchLike } from "./http-fetch.js";
import {
  ingestAutoApprove,
  ingestConcurrency,
  ingestMaxPerRun,
  ingestMinConfidence,
  ingestScreenshotMode,
  ingestSignatureCap,
  mapPool,
} from "./config.js";
import { searchGithubTemplates, upsertDiscoveredSources } from "./discover-github.js";
import { currentLlmLabel } from "./status.js";

export type { FetchLike };

function log(candidate: IngestCandidate, level: "info" | "warn" | "error", message: string) {
  candidate.events.push({ at: Date.now(), level, message });
}

async function crawlDemo(
  fetchImpl: FetchLike,
  homeUrl: string,
  fallbackTitle: string
): Promise<{ home: PageOutline; pages: Record<string, PageOutline> }> {
  const empty = { home: { title: fallbackTitle, headings: [], landmarks: [] }, pages: {} };

  let origin: URL;
  try {
    origin = new URL(homeUrl);
  } catch {
    return empty;
  }

  // robots.txt first: the home page is a fetch like any other and has to clear the same gate the
  // sub-pages do. Fetching it and asking permission afterwards is not honouring robots.
  const robots = await fetchRobots(fetchImpl, origin.origin);
  if (robots && !pathAllowedByRobots(robots, origin.pathname || "/")) {
    return empty;
  }

  const homeHtml = await fetchText(fetchImpl, homeUrl);
  if (!homeHtml) return empty;
  const home = { ...extractOutline(homeHtml, fallbackTitle), url: homeUrl };
  const pages: Record<string, PageOutline> = {};
  for (const link of extractSameOriginLinks(homeHtml, homeUrl)) {
    if (Object.keys(pages).length >= 3) break;
    const slug = inferPageSlug(link.url, link.text);
    if (!slug || pages[slug]) continue;
    const path = new URL(link.url).pathname;
    if (robots && !pathAllowedByRobots(robots, path)) continue;
    const html = await fetchText(fetchImpl, link.url);
    if (!html) continue;
    pages[slug] = { ...extractOutline(html, slug), url: link.url };
  }
  return { home, pages };
}

export async function ingestSource(
  source: IngestSource,
  store: IngestStore,
  fetchImpl: FetchLike = fetch
): Promise<IngestCandidate> {
  const originCheck = inspectIngestUrl(source.originUrl);
  if (!originCheck.ok) {
    const existingForBlock = await store.getCandidateByOrigin(source.originUrl);
    return store.upsertCandidate(
      blockedCandidate(source, originCheck.reason ?? "Blocked origin", existingForBlock)
    );
  }
  if (source.demoUrl) {
    const demoCheck = inspectIngestUrl(source.demoUrl, {
      role: "demo",
      originUrl: source.originUrl,
    });
    if (!demoCheck.ok) {
      const existingForBlock = await store.getCandidateByOrigin(source.originUrl);
      return store.upsertCandidate(
        blockedCandidate(source, demoCheck.reason ?? "Blocked demo URL", existingForBlock)
      );
    }
  }

  const existing = await store.getCandidateByOrigin(source.originUrl);
  const candidate: IngestCandidate = existing
    ? { ...existing, status: "ingesting", blockedReason: undefined, updatedAt: Date.now() }
    : {
        id: randomUUID(),
        sourceId: source.id,
        title: source.name,
        originUrl: source.originUrl,
        demoUrl: source.demoUrl,
        status: "ingesting",
        licenseOk: false,
        events: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

  log(candidate, "info", `Ingesting ${source.kind} ${source.originUrl}`);

  if (source.kind === "moodboard") {
    candidate.status = "needs_review";
    log(candidate, "info", "Moodboard source — art direction only. No HTML ingest.");
    return store.upsertCandidate(candidate);
  }

  let licenseText = "";
  const repo = parseGithubRepo(source.originUrl);
  if (repo) {
    const branches = ["HEAD", "main", "master"];
    for (const branch of branches) {
      for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
        const body = await fetchText(
          fetchImpl,
          `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/${file}`
        );
        if (body && body.length > 40) {
          licenseText = body;
          break;
        }
      }
      if (licenseText) break;
    }
    if (!licenseText) {
      const api = await fetchText(fetchImpl, `https://api.github.com/repos/${repo.owner}/${repo.repo}`);
      if (api) {
        try {
          const json = JSON.parse(api) as { license?: { spdx_id?: string }; homepage?: string };
          const spdx = normalizeSpdx(json.license?.spdx_id);
          if (spdx) candidate.licenseDetected = spdx;
          if (!candidate.demoUrl && json.homepage) {
            const homepageCheck = inspectIngestUrl(json.homepage, {
              role: "demo",
              originUrl: source.originUrl,
            });
            if (homepageCheck.ok) candidate.demoUrl = json.homepage;
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (licenseText) {
    candidate.licenseDetected = detectLicense(licenseText) ?? candidate.licenseDetected;
    log(candidate, "info", `License text found (${candidate.licenseDetected ?? "unrecognized"})`);
  }

  candidate.licenseOk = isPermissiveLicense(candidate.licenseDetected);

  const htmlUrl = candidate.demoUrl ?? (source.kind === "demo" ? source.originUrl : undefined);
  if (htmlUrl) {
    const canFetch = inspectIngestUrl(htmlUrl, {
      role: "demo",
      licenseVerified: candidate.licenseOk,
    });
    if (!canFetch.ok) {
      log(
        candidate,
        "warn",
        `Skipping demo HTML until license is verified (${canFetch.reason ?? htmlUrl})`
      );
    } else {
      const crawled = await crawlDemo(fetchImpl, htmlUrl, source.name);
      candidate.outline = crawled.home;
      candidate.pageOutlines = Object.keys(crawled.pages).length ? crawled.pages : undefined;
      candidate.title = candidate.outline.title || source.name;
      log(
        candidate,
        "info",
        `Outline: ${candidate.outline.headings.length} headings, landmarks ${candidate.outline.landmarks.join(", ") || "none"}`
      );
      if (candidate.pageOutlines) {
        log(candidate, "info", `Crawled pages: ${Object.keys(candidate.pageOutlines).join(", ")}`);
      }
    }
  } else {
    log(candidate, "warn", "No demo URL — license can still be verified, mapping will be sparse");
  }

  candidate.status = "verifying";
  await store.upsertSource({ ...source, lastFetchedAt: Date.now(), lastError: undefined });
  return store.upsertCandidate(candidate);
}

/**
 * "If only needed, then only" — a browser render is the most expensive step in ingest, so it runs
 * only when it changes an outcome. Order matters: the cheap gates (mode, demo URL, license) come
 * before the ones that need the outline.
 */
export function screenshotDecision(
  candidate: IngestCandidate,
  options: { mode?: ReturnType<typeof ingestScreenshotMode> } = {}
): { capture: boolean; reason: string } {
  const mode = options.mode ?? ingestScreenshotMode();
  if (mode === "never") return { capture: false, reason: "screenshots disabled" };
  if (!candidate.demoUrl) return { capture: false, reason: "no demo URL to render" };
  if (!candidate.licenseOk) {
    return { capture: false, reason: "license not verified — demo pages are never rendered before that" };
  }
  if (candidate.features && candidate.features.sourceUrl === candidate.demoUrl) {
    return { capture: false, reason: "features already measured for this demo" };
  }
  if (mode === "always") return { capture: true, reason: "INGEST_SCREENSHOT=always" };

  const outline = candidate.outline;
  if (!outline || outline.headings.length === 0) {
    return { capture: false, reason: "no outline — candidate cannot draft a skin either way" };
  }
  // A composition this weak lands in review regardless of what a render would tell us.
  if (mapOutlineToRecipe(outline).confidence < 0.45) {
    return { capture: false, reason: "composition too weak to draft a skin" };
  }
  return { capture: true, reason: "on track to draft a skin, visual attributes unmeasured" };
}

export async function verifyCandidate(
  candidate: IngestCandidate,
  source: IngestSource,
  existingSkinIds: string[],
  options: { fetchImpl?: FetchLike } = {}
): Promise<IngestCandidate> {
  const next = { ...candidate, events: [...candidate.events] };
  next.licenseOk = isPermissiveLicense(next.licenseDetected);
  if (!next.licenseOk && source.expectedLicense) {
    next.licenseDetected = next.licenseDetected ?? source.expectedLicense;
    next.licenseOk = false;
    log(next, "warn", `License not confirmed from source text (source claims ${source.expectedLicense})`);
  }

  if (next.outline) {
    const decision = screenshotDecision(next);
    if (decision.capture && next.demoUrl) {
      const shot = await captureThemeFeatures(next.demoUrl, {
        licenseVerified: next.licenseOk,
        originUrl: next.originUrl,
        fetchImpl: options.fetchImpl,
      });
      if (shot.features) {
        next.features = shot.features;
        next.featuresSkipped = undefined;
        log(
          next,
          "info",
          `Rendered demo: ${shot.features.visualFamily}, ${shot.features.navShape}, ${shot.features.footerLayout}${shot.features.conclusive ? " (conclusive — no mapping LLM call)" : ""}`
        );
      } else {
        next.featuresSkipped = shot.skipped;
        log(next, "warn", `Screenshot skipped: ${shot.skipped ?? "unknown"}`);
      }
    } else {
      next.featuresSkipped = decision.reason;
    }

    const mapped = await mapOutlineWithLlm({
      outline: next.outline,
      category: source.defaultCategory,
      pageOutlines: next.pageOutlines,
      features: next.features,
    });
    next.recipe = mapped.recipe;
    next.mappedWith = mapped.usedLlm ? "llm" : mapped.usedFeatures ? "features" : "heuristic";
    log(
      next,
      "info",
      `Mapped ${next.recipe.home.length} home sections (confidence ${next.recipe.confidence.toFixed(2)}${mapped.usedLlm ? ", LLM" : mapped.usedFeatures ? ", measured" : ", heuristic"})`
    );

    if (next.blockedReason) {
      next.status = "blocked";
      return next;
    }

    const origin = inspectIngestUrl(next.originUrl);
    if (!origin.ok) {
      next.status = "blocked";
      next.blockedReason = origin.reason;
      return next;
    }

    if (!next.licenseOk) {
      next.status = "needs_review";
      log(next, "warn", "Needs human review: permissive license not verified");
      return next;
    }

    if (next.recipe.confidence < 0.45 || !next.outline.headings.length) {
      next.status = "needs_review";
      log(next, "warn", "Needs human review: weak or missing composition mapping");
      return next;
    }

    try {
      next.draftSkin = draftSkinFromRecipe({
        title: next.title,
        inspiredBy: `${source.name} (${next.originUrl})`,
        category: source.defaultCategory,
        recipe: next.recipe,
        existingIds: existingSkinIds,
        visualFamily: mapped.visualFamily,
        navShape: mapped.navShape,
        footerLayout: mapped.footerLayout,
        pageOutlines: next.pageOutlines,
        extraPages: mapped.extraPages,
        industry: source.industry,
        archetype: source.archetype,
        provenance: {
          originUrl: next.originUrl,
          demoUrl: next.demoUrl,
          license: next.licenseDetected ?? source.expectedLicense,
          fetchedAt: Date.now(),
          thumbnailPath: next.features?.thumbnailPath,
        },
      });
      // Reserved the instant the id is decided, in the same synchronous turn — not after this
      // whole concurrent chunk resolves. JS never interleaves two async functions' synchronous
      // code, so a caller running many verifyCandidate calls side by side via the same shared
      // `existingSkinIds` array (runIngestPipeline's chunked mapPool) is safe: whichever
      // candidate computes its id first makes every later one in the batch see it and pick a
      // different suffix, instead of two same-titled demos both landing on `ingested-foo` and
      // the second silently deleting the first from data/approved-skins.json on approval.
      existingSkinIds.push(next.draftSkin.id);
      next.status = "needs_review";
      log(next, "info", `Draft skin ${next.draftSkin.id} ready`);
    } catch (err) {
      next.status = "needs_review";
      log(next, "error", `Could not draft skin: ${err instanceof Error ? err.message : String(err)}`);
    }
    return next;
  }

  if (next.blockedReason) {
    next.status = "blocked";
    return next;
  }
  next.status = "needs_review";
  log(next, "warn", "Needs human review: no outline");
  return next;
}

export async function approveCandidate(store: IngestStore, candidateId: string): Promise<IngestCandidate> {
  const candidate = await store.getCandidate(candidateId);
  if (!candidate) throw new Error("Candidate not found");
  if (candidate.status === "blocked") throw new Error("Blocked candidates cannot be approved");
  if (!candidate.licenseOk) throw new Error("Cannot approve without a verified permissive license");
  if (!candidate.draftSkin) throw new Error("No draft skin — run verify first");
  const verdict = checkSkinDedupe(
    candidate.draftSkin,
    [...SITE_SKINS, ...loadApprovedSkins()],
    ingestSignatureCap()
  );
  if (!verdict.ok) throw new Error(verdict.reason ?? "Duplicate composition signature");
  saveApprovedSkin(candidate.draftSkin);
  candidate.status = "approved";
  candidate.reviewedAt = Date.now();
  log(candidate, "info", `Approved and published skin ${candidate.draftSkin.id}`);
  return store.upsertCandidate(candidate);
}

export async function rejectCandidate(
  store: IngestStore,
  candidateId: string,
  reason: string
): Promise<IngestCandidate> {
  const candidate = await store.getCandidate(candidateId);
  if (!candidate) throw new Error("Candidate not found");
  candidate.status = "rejected";
  candidate.reviewNote = reason;
  candidate.reviewedAt = Date.now();
  log(candidate, "warn", `Rejected: ${reason}`);
  return store.upsertCandidate(candidate);
}

export async function bulkApprove(store: IngestStore, ids: string[]): Promise<{ approved: number; errors: string[] }> {
  const errors: string[] = [];
  let approved = 0;
  for (const id of ids) {
    try {
      await approveCandidate(store, id);
      approved += 1;
    } catch (err) {
      errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { approved, errors };
}

export async function bulkReject(
  store: IngestStore,
  ids: string[],
  reason: string
): Promise<{ rejected: number }> {
  let rejected = 0;
  for (const id of ids) {
    try {
      await rejectCandidate(store, id, reason);
      rejected += 1;
    } catch {
      /* skip */
    }
  }
  return { rejected };
}

export type PipelinePhase = "discover" | "scrape" | "map" | "approve";

export interface PipelineEvent {
  type: "log" | "candidate" | "source" | "run" | "done" | "stats";
  line?: string;
  candidate?: IngestCandidate;
  source?: IngestSource;
  run?: IngestRun;
  stats?: IngestRun["stats"];
  phase?: PipelinePhase;
  llmProvider?: string | null;
}

function emptyStats(): IngestRun["stats"] {
  return {
    ingested: 0,
    verified: 0,
    needsReview: 0,
    approved: 0,
    rejected: 0,
    blocked: 0,
    discovered: 0,
    skippedDup: 0,
    autoApproved: 0,
    scraped: 0,
    mapped: 0,
    captured: 0,
    llmMapped: 0,
  };
}

function statsEvent(run: IngestRun, phase: PipelinePhase): PipelineEvent {
  return {
    type: "stats",
    phase,
    llmProvider: currentLlmLabel(),
    stats: { ...run.stats },
  };
}

export async function* runIngestPipeline(
  store: IngestStore,
  options: { sourceId?: string; discover?: boolean; fetchImpl?: FetchLike } = {}
): AsyncGenerator<PipelineEvent> {
  const run: IngestRun = {
    id: randomUUID(),
    startedAt: Date.now(),
    status: "running",
    sourceId: options.sourceId,
    stats: emptyStats(),
  };
  await store.upsertRun(run);
  yield { type: "run", run, line: options.discover ? "Discover & ingest started" : "Agent started" };
  yield statsEvent(run, options.discover ? "discover" : "scrape");

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    let sources: IngestSource[];
    if (options.discover) {
      yield { type: "log", line: "Searching GitHub for permissively licensed templates…" };
      yield statsEvent(run, "discover");
      const repos = await searchGithubTemplates(fetchImpl, { max: ingestMaxPerRun() });
      const { created, skipped } = await upsertDiscoveredSources(store, repos);
      run.stats.discovered = created.length;
      run.stats.skippedDup += skipped;
      yield {
        type: "log",
        line: `Discovered ${created.length} new sources (${skipped} already known)`,
      };
      yield statsEvent(run, "discover");
      sources = created;
      if (sources.length === 0) {
        yield { type: "log", line: "No new GitHub sources this run — ingesting existing active sources" };
        sources = (await store.listSources()).filter((row) => row.status === "active").slice(0, ingestMaxPerRun());
      }
    } else if (options.sourceId) {
      const one = await store.getSource(options.sourceId);
      sources = one ? [one] : [];
    } else {
      sources = (await store.listSources())
        .filter((row) => row.status === "active")
        .slice(0, ingestMaxPerRun());
    }

    if (sources.length === 0) {
      throw new Error(options.sourceId ? "Source not found" : "No active sources");
    }

    const existingIds = [...SITE_SKINS.map((s) => s.id), ...loadApprovedSkins().map((s) => s.id)];
    const liveSkins = [...SITE_SKINS, ...loadApprovedSkins()];
    const signatureCap = ingestSignatureCap();
    const auto = ingestAutoApprove();
    const minConfidence = ingestMinConfidence();
    const concurrency = ingestConcurrency();

    const chunkSize = Math.max(1, concurrency);
    yield statsEvent(run, "scrape");
    for (let i = 0; i < sources.length; i += chunkSize) {
      const chunk = sources.slice(i, i + chunkSize);
      const processed = await mapPool(chunk, chunkSize, async (source) => {
        // A candidate that already reached a final state (approved into the live catalog, or
        // explicitly rejected) is not re-ingested. Without this, re-running over the same active
        // sources re-drafts every already-approved skin under a fresh id every time (the prior
        // fix only stops two drafts *in one run* from colliding), the redraft collides with its
        // own already-published skin in checkSkinDedupe, and the approved row is demoted back to
        // needs_review on every single re-run — a no-op run should be a no-op.
        const existingFinal = await store.getCandidateByOrigin(source.originUrl);
        if (existingFinal && (existingFinal.status === "approved" || existingFinal.status === "rejected")) {
          return { source, ingested: existingFinal, verified: existingFinal, skippedFinal: true as const };
        }
        const ingested = await ingestSource(source, store, fetchImpl);
        const verified = await verifyCandidate(ingested, source, existingIds, { fetchImpl });
        return { source, ingested, verified, skippedFinal: false as const };
      });

      for (const { source, ingested, verified, skippedFinal } of processed) {
        if (skippedFinal) {
          yield {
            type: "log",
            line: `${source.name}: already ${verified.status} — skipping re-ingest`,
          };
          yield { type: "candidate", candidate: verified, line: `${verified.title}: ${verified.status}` };
          continue;
        }

        yield { type: "log", line: `Ingest ${source.name}` };
        yield { type: "source", source };
        run.stats.ingested += 1;
        if (ingested.outline) run.stats.scraped += 1;
        yield { type: "candidate", candidate: ingested, line: `${ingested.title}: ${ingested.status}` };
        yield statsEvent(run, "scrape");

        let saved = verified;
        if (verified.draftSkin) existingIds.push(verified.draftSkin.id);
        if (verified.recipe) run.stats.mapped += 1;
        if (verified.features) run.stats.captured += 1;
        if (verified.mappedWith === "llm") run.stats.llmMapped += 1;
        yield statsEvent(run, "map");

        if (
          auto &&
          verified.licenseOk &&
          verified.draftSkin &&
          (verified.recipe?.confidence ?? 0) >= minConfidence &&
          verified.status !== "blocked"
        ) {
          const verdict = checkSkinDedupe(verified.draftSkin, liveSkins, signatureCap);
          if (!verdict.ok) {
            saved = {
              ...verified,
              status: "needs_review",
            };
            log(saved, "warn", `${verdict.reason ?? "Duplicate composition"} — left in review`);
            run.stats.skippedDup += 1;
          } else {
            saveApprovedSkin(verified.draftSkin);
            liveSkins.push(verified.draftSkin);
            saved = {
              ...verified,
              status: "approved",
              reviewedAt: Date.now(),
            };
            log(saved, "info", `Auto-approved skin ${verified.draftSkin.id}`);
            run.stats.approved += 1;
            run.stats.autoApproved += 1;
            yield statsEvent(run, "approve");
          }
        }

        saved = await store.upsertCandidate(saved);
        run.stats.verified += 1;
        if (saved.status === "blocked") run.stats.blocked += 1;
        if (saved.status === "needs_review") run.stats.needsReview += 1;
        yield { type: "candidate", candidate: saved, line: `Verified ${saved.title} → ${saved.status}` };
        yield statsEvent(run, saved.status === "approved" ? "approve" : "map");
      }
    }

    // Renders for candidates that no longer exist are dead weight at corpus scale.
    if (run.stats.captured > 0) {
      const keep = new Set<string>();
      const remember = (thumbnailPath: string | undefined) => {
        if (thumbnailPath) keep.add(thumbnailPath.split("/").pop()!);
      };
      for (const row of await store.listCandidates()) remember(row.features?.thumbnailPath);
      for (const skin of loadApprovedSkins()) remember(skin.provenance?.thumbnailPath);
      const removed = await pruneThumbnails(keep);
      if (removed > 0) yield { type: "log", line: `Pruned ${removed} unreferenced thumbnail(s)` };
    }

    run.status = "succeeded";
    run.finishedAt = Date.now();
    await store.upsertRun(run);
    yield statsEvent(run, run.stats.autoApproved > 0 ? "approve" : "map");
    yield { type: "done", run, stats: run.stats, line: "Agent finished" };
  } catch (err) {
    run.status = "failed";
    run.finishedAt = Date.now();
    run.error = err instanceof Error ? err.message : String(err);
    await store.upsertRun(run);
    yield { type: "done", run, stats: run.stats, line: run.error };
  }
}

/**
 * Update the origin's existing row in place when there is one, rather than minting a fresh id —
 * without this, a source that starts failing the policy check (a host added to BLOCKED_HOSTS, a
 * demo URL that stops passing the demo-role check) grows a brand-new "blocked" candidate on every
 * scheduled run: the origin-keyed dedupe the rest of ingestSource relies on never runs for this
 * path, so the same repo silently piles up unbounded rows in the review queue.
 */
function blockedCandidate(
  source: IngestSource,
  reason: string,
  existing?: IngestCandidate
): IngestCandidate {
  return {
    id: existing?.id ?? randomUUID(),
    sourceId: source.id,
    title: existing?.title ?? source.name,
    originUrl: source.originUrl,
    demoUrl: source.demoUrl,
    status: "blocked",
    blockedReason: reason,
    licenseOk: false,
    events: [...(existing?.events ?? []), { at: Date.now(), level: "error", message: reason }],
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}