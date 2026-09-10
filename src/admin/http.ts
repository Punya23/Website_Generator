import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IngestStore } from "./store.js";
import { inspectIngestUrl } from "./policy.js";
import {
  approveCandidate,
  bulkApprove,
  bulkReject,
  rejectCandidate,
  runIngestPipeline,
  verifyCandidate,
} from "./pipeline.js";
import { loadApprovedSkins } from "./approved-skins.js";
import { readThumbnail } from "./theme-features.js";
import { renderSkinPreview } from "./preview-skin.js";
import { templateRoutes } from "./template-routes.js";
import { SITE_SKINS } from "../skins/catalog.js";
import { IngestSourceSchema } from "./types.js";
import {
  buildAdminStatus,
  INGEST_POLICY,
  publicSkin,
  templateLibrary,
} from "./status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_PUBLIC = path.resolve(__dirname, "../web/admin");

const store = new IngestStore();

// A single reused project directory (kept across builds so repeat previews skip `npm install`
// and only pay for the Next.js build itself) and a single served output directory — mirrors how
// the main playground keeps one "hot" preview at a time rather than one per candidate.
const PREVIEW_BASE_PATH = "/admin-preview";
const PREVIEW_PROJECT_DIR = path.resolve("output", "_admin-preview-react");
const PREVIEW_SERVE_DIR = path.resolve("output", "_admin-preview");
let previewInFlight: Promise<unknown> | null = null;

async function persistAdminPreview(outPath: string): Promise<void> {
  await fs.rm(PREVIEW_SERVE_DIR, { recursive: true, force: true });
  await fs.cp(outPath, PREVIEW_SERVE_DIR, { recursive: true });
}

/** Static preview output contains nothing but our own section templates, mock copy, and
 *  properly-licensed stock photos — never third-party demo HTML/CSS/JS — so unlike `/thumbs`
 *  it does not need to sit behind `adminGuard`. Kept as its own top-level mount (like `/preview`
 *  in the playground) so every sub-resource request (JS/CSS chunks) just works without a token. */
function mountPreviewOutputRoute(app: Express): void {
  app.get(`${PREVIEW_BASE_PATH}/:slug`, async (req, res, next) => {
    const slug = req.params.slug ?? "";
    if (!slug || slug.includes(".") || slug === "_next") return next();
    const file = path.join(PREVIEW_SERVE_DIR, slug, "index.html");
    try {
      await fs.access(file);
      res.sendFile(file);
    } catch {
      next();
    }
  });
  app.use(
    PREVIEW_BASE_PATH,
    express.static(PREVIEW_SERVE_DIR, { index: "index.html", extensions: ["html"] })
  );
}

function clientIp(req: Request): string {
  return String(req.socket.remoteAddress ?? "");
}

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === ":ffff:127.0.0.1" || ip.endsWith("127.0.0.1");
}

export function adminGuard(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.ADMIN_TOKEN?.trim();
  if (!token) {
    if (isLoopback(clientIp(req))) {
      next();
      return;
    }
    res.status(401).json({ error: "Set ADMIN_TOKEN or open the dashboard from localhost." });
    return;
  }
  const header = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const query = typeof req.query.token === "string" ? req.query.token : "";
  if (header === token || query === token) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}

export function mountAdmin(app: Express): void {
  const api = express.Router();
  api.use(adminGuard);

  // Local verbatim-template corpus (zips in templates_bundle/), separate from GitHub ingest.
  api.use("/local-templates", templateRoutes());

  api.get("/overview", async (_req, res) => {
    const status = await buildAdminStatus(store);
    res.json({
      ...status,
      policy: INGEST_POLICY,
    });
  });

  api.get("/status", async (_req, res) => {
    res.json(await buildAdminStatus(store));
  });

  api.get("/templates", (_req, res) => {
    res.json(templateLibrary());
  });

  api.get("/sources", async (_req, res) => {
    res.json({ sources: await store.listSources() });
  });

  api.post("/sources", async (req, res) => {
    try {
      const originUrl = String(req.body?.originUrl ?? "");
      const demoUrl = req.body?.demoUrl ? String(req.body.demoUrl) : undefined;
      const origin = inspectIngestUrl(originUrl);
      if (!origin.ok) {
        res.status(400).json({ error: origin.reason });
        return;
      }
      if (demoUrl) {
        const demo = inspectIngestUrl(demoUrl, { role: "demo", originUrl });
        if (!demo.ok) {
          res.status(400).json({ error: demo.reason });
          return;
        }
      }
      const parsed = IngestSourceSchema.omit({ id: true, createdAt: true, updatedAt: true }).parse({
        name: req.body?.name,
        kind: req.body?.kind ?? "github",
        originUrl,
        demoUrl,
        expectedLicense: req.body?.expectedLicense ?? "MIT",
        defaultCategory: req.body?.defaultCategory ?? "creative",
        status: req.body?.status ?? "active",
        notes: req.body?.notes,
      });
      const source = await store.upsertSource(parsed);
      res.json({ source });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.patch("/sources/:id", async (req, res) => {
    const existing = await store.getSource(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Source not found" });
      return;
    }
    const source = await store.upsertSource({ ...existing, ...req.body, id: existing.id });
    res.json({ source });
  });

  // Paged by default — a corpus of thousands of candidates must never be serialized into one
  // response just to render the review queue.
  const CANDIDATE_PAGE_DEFAULT = 200;
  const CANDIDATE_PAGE_MAX = 1000;

  api.get("/candidates", async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const sourceId = typeof req.query.sourceId === "string" ? req.query.sourceId : undefined;
    const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const rawOffset = Number.parseInt(String(req.query.offset ?? ""), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, CANDIDATE_PAGE_MAX)
      : CANDIDATE_PAGE_DEFAULT;
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    const [candidates, total] = await Promise.all([
      store.listCandidates({ status, sourceId, limit, offset }),
      store.countCandidates({ status, sourceId }),
    ]);
    res.json({ candidates, total, limit, offset });
  });

  /**
   * Internal review thumbnails. Behind the same admin guard as everything else, and the only way
   * to read one — a rendered demo can contain third-party photos and logos that the template's
   * code license does not cover, so these images never reach a generated site or a public page.
   * `readThumbnail` rejects any name that is not a bare `<sha1>.jpg`, so the path cannot be walked.
   */
  api.get("/thumbs/:name", async (req, res) => {
    const buffer = await readThumbnail(req.params.name);
    if (!buffer) {
      res.status(404).json({ error: "No thumbnail" });
      return;
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Robots-Tag", "noindex, noimageindex");
    res.send(buffer);
  });

  api.get("/candidates/:id", async (req, res) => {
    const candidate = await store.getCandidate(req.params.id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json({ candidate });
  });

  api.post("/candidates/:id/verify", async (req, res) => {
    const candidate = await store.getCandidate(req.params.id);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    const source = await store.getSource(candidate.sourceId);
    if (!source) {
      res.status(400).json({ error: "Source missing" });
      return;
    }
    const existingIds = [...SITE_SKINS.map((s) => s.id), ...loadApprovedSkins().map((s) => s.id)];
    const verified = await store.upsertCandidate(await verifyCandidate(candidate, source, existingIds));
    res.json({ candidate: verified });
  });

  api.post("/candidates/:id/approve", async (req, res) => {
    try {
      const candidate = await approveCandidate(store, req.params.id);
      res.json({ candidate, skinId: candidate.draftSkin?.id });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Full preview: mock-fills the candidate's draft skin with a sample brief and runs it through
   * the real React codegen + Next.js static-export build, so an admin can see actual composition
   * and motion — not just the wireframe — before approving. Streamed like `/runs` since a cold
   * build (npm install + Next build) can take real time; a warm one (project already built once)
   * is much faster.
   */
  api.post("/candidates/:id/preview", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const send = (payload: unknown) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    if (previewInFlight) {
      send({ type: "done", ok: false, error: "Another preview build is already running — try again shortly." });
      res.end();
      return;
    }

    const run = (async () => {
      const candidate = await store.getCandidate(req.params.id);
      if (!candidate) throw new Error("Candidate not found");
      if (!candidate.draftSkin) {
        throw new Error("No draft skin to preview yet — re-verify this candidate first.");
      }
      send({ type: "log", line: `Building preview for ${candidate.draftSkin.name}…` });
      const reuseProject = await fs
        .access(path.join(PREVIEW_PROJECT_DIR, "node_modules", "next"))
        .then(() => true)
        .catch(() => false);
      if (!reuseProject) send({ type: "log", line: "First preview build — installing dependencies (slower)…" });
      const result = await renderSkinPreview(candidate.draftSkin, PREVIEW_PROJECT_DIR, {
        basePath: PREVIEW_BASE_PATH,
        reuseProject,
      });
      for (const [slug, ids] of Object.entries(result.sectionsByPage)) {
        send({ type: "log", line: `${slug}: ${ids.join(" → ")}` });
      }
      if (!result.buildSucceeded) {
        throw new Error(result.buildError ?? "React build failed");
      }
      await persistAdminPreview(result.outPath!);
      send({
        type: "done",
        ok: true,
        previewUrl: `${PREVIEW_BASE_PATH}/`,
        businessName: result.businessName,
        candidateId: candidate.id,
      });
    })().catch((err) => {
      send({ type: "done", ok: false, error: err instanceof Error ? err.message : String(err) });
    });

    previewInFlight = run;
    try {
      await run;
    } finally {
      previewInFlight = null;
      res.end();
    }
  });

  api.post("/candidates/:id/reject", async (req, res) => {
    try {
      const reason = String(req.body?.reason ?? "Rejected in dashboard");
      const candidate = await rejectCandidate(store, req.params.id, reason);
      res.json({ candidate });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.post("/candidates/bulk-approve", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: "ids required" });
      return;
    }
    res.json(await bulkApprove(store, ids));
  });

  api.post("/candidates/bulk-reject", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const reason = String(req.body?.reason ?? "Bulk rejected");
    res.json(await bulkReject(store, ids, reason));
  });

  api.get("/runs", async (_req, res) => {
    res.json({ runs: await store.listRuns() });
  });

  api.post("/runs", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const send = (payload: unknown) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    try {
      const sourceId = typeof req.body?.sourceId === "string" ? req.body.sourceId : undefined;
      const discover = Boolean(req.body?.discover);
      for await (const event of runIngestPipeline(store, { sourceId, discover })) {
        send(event);
      }
    } catch (err) {
      send({ type: "done", line: err instanceof Error ? err.message : String(err) });
    } finally {
      res.end();
    }
  });

  api.get("/skins", (_req, res) => {
    res.json({
      authored: SITE_SKINS.map(publicSkin),
      approved: loadApprovedSkins().map(publicSkin),
    });
  });

  app.use("/api/admin", api);
  app.use("/admin", express.static(ADMIN_PUBLIC, { index: "index.html" }));
  mountPreviewOutputRoute(app);
}

export { store as adminStore };
