import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { generateReactProject, buildReactProject } from "../react-codegen/assemble-project.js";
import { generateSite } from "../orchestrator/orchestrator.js";
import { planRevision } from "../agents/revise-site-agent.js";
import { applyRevision } from "../editor/apply-revision.js";
import { writeSiteOutput, type SiteAssetCopy } from "../server/preview-server.js";
import { withEditLayer } from "../templates/compose.js";
import { applyVerbatimRevisions, composeVerbatimSite, type VerbatimRevision, type VerbatimSiteState } from "../templates/revise.js";
import { loadSiteState, saveSiteState } from "../templates/site-state-store.js";
import { subscribePipelineLogs } from "../util/pipeline-log.js";
import { extractBusinessName } from "../util/extract-name.js";
import { llm } from "../llm/client.js";
import {
  createJobId,
  registerJob,
  runExclusive,
  completeJob,
  failJob,
} from "../web/generation-jobs.js";
import { closeQABrowser } from "../qa/code-qa.js";
import { getEditorSession, setEditorSession, updateEditorSession } from "../editor/session.js";
import { applyThemePatch, reorderSections, rerenderFromContext } from "../editor/rerender.js";
import { regenerateSection } from "../agents/section-builder-agent.js";
import { assemblePageFromSections } from "../site-context/assemble.js";
import { getPagePlan } from "../agents/site-planner-agent.js";
import { MediaRegistry } from "../media/media-registry.js";
import {
  exportProjectJson,
  exportReactProject,
  exportWebflowJson,
} from "../export/formats.js";
import {
  startReactPreviewServer,
  stopReactPreviewServer,
} from "../react-codegen/react-preview-server.js";
import { ensurePlaywrightBrowsers } from "../util/ensure-playwright.js";
import { getSiteBySlug } from "../hosting/site-repository.js";
import { isSupabaseConfigured } from "../hosting/supabase-client.js";
import { publishSite, publishVerbatimSite } from "../hosting/publish-site.js";
import { siteSlugFromName } from "../hosting/slug.js";
import { mountAdmin } from "../admin/http.js";
import {
  emptyMediaSessionDir,
  writeDecodedUploads,
  type DecodedUpload,
  type UserMediaLibrary,
} from "../media/user-media.js";

const mediaSessions = new Map<string, { library: UserMediaLibrary; createdAt: number }>();
const MEDIA_SESSION_TTL_MS = 60 * 60 * 1000;

function takeMediaSession(id: unknown): UserMediaLibrary | undefined {
  if (typeof id !== "string" || !id.trim()) return undefined;
  const row = mediaSessions.get(id.trim());
  if (!row) return undefined;
  mediaSessions.delete(id.trim());
  return row.library;
}

function pruneMediaSessions(): void {
  const cutoff = Date.now() - MEDIA_SESSION_TTL_MS;
  for (const [id, row] of mediaSessions) {
    if (row.createdAt < cutoff) mediaSessions.delete(id);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PLAYGROUND_OUTPUT = path.resolve("output", "_playground");

async function persistReactPreview(reactOutPath: string): Promise<void> {
  await fs.rm(PLAYGROUND_OUTPUT, { recursive: true, force: true });
  await fs.cp(reactOutPath, PLAYGROUND_OUTPUT, { recursive: true });
}

async function persistHtmlPreview(
  htmlPages: Record<string, string>,
  assets: SiteAssetCopy[] = [],
  options: { editable?: boolean } = {}
): Promise<void> {
  // The authoring layer belongs to the preview copy only — never to what gets published/exported.
  const pages = options.editable
    ? Object.fromEntries(Object.entries(htmlPages).map(([slug, html]) => [slug, withEditLayer(html)]))
    : htmlPages;
  await writeSiteOutput(PLAYGROUND_OUTPUT, pages, assets);
}

function mountPreviewRoutes(app: express.Express): void {
  // Next static export: /preview/about → about/index.html
  app.get("/preview/:slug", async (req, res, next) => {
    const slug = req.params.slug ?? "";
    if (!slug || slug.includes(".") || slug === "_next") return next();
    const file = path.join(PLAYGROUND_OUTPUT, slug, "index.html");
    try {
      await fs.access(file);
      res.sendFile(file);
    } catch {
      next();
    }
  });

  app.use(
    "/preview",
    express.static(PLAYGROUND_OUTPUT, {
      index: "index.html",
      extensions: ["html"],
    })
  );
}

export interface PlaygroundServerOptions {
  port?: number;
}

/**
 * Edits are applied one at a time.
 *
 * Every edit reads the current state, recomposes the whole site and rewrites the preview directory.
 * Two of them in flight together read the same state (so the second silently drops the first's
 * change) and write the same files at the same time (confirmed live: clicking swap and add in quick
 * succession returned 200 then 500). Serializing is both the correctness fix and the crash fix —
 * and an edit is fast enough that queueing is invisible.
 */
let editQueue: Promise<unknown> = Promise.resolve();
function queueEdit<T>(task: () => Promise<T>): Promise<T> {
  const run = editQueue.then(task, task);
  editQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function persistPreview(): Promise<{ previewUrl: string; previewSource: string }> {
  const session = getEditorSession();
  if (!session?.siteContext) {
    throw new Error("No active site session — generate a site first");
  }

  // A verbatim site has no React project and no `SectionInstance` props — rendering it through
  // `rerenderFromContext` below produced a blank legacy page and dropped every vendored asset,
  // so the first theme/reorder call silently destroyed the preview. It recomposes from its own
  // state instead, which is also what makes edits stick.
  const verbatimState = session.verbatimState;
  if (verbatimState) {
    const site = await composeVerbatimSite(verbatimState);
    session.htmlPages = site.htmlPages;
    session.verbatimFiles = site.files;
    await persistHtmlPreview(site.htmlPages, site.files, { editable: true });
    session.previewSource = "html-fallback";
    return { previewUrl: "/preview/", previewSource: "html-fallback" };
  }

  const reactPages = session.siteContext.reactPages;
  if (session.reactProjectPath && reactPages && Object.keys(reactPages).length > 0) {
    const projectPath = session.reactProjectPath;
    const nextInstalled = await fs
      .access(path.join(projectPath, "node_modules", "next"))
      .then(() => true)
      .catch(() => false);
    const { outPath } = await generateReactProject(session.siteContext, reactPages, projectPath, {
      basePath: "/preview",
      keepInstall: nextInstalled,
    });
    await buildReactProject(projectPath, { skipInstall: nextInstalled });
    session.reactStaticOutPath = outPath;
    session.buildSucceeded = true;
    await persistReactPreview(outPath);
    try {
      const previewUrl = await startReactPreviewServer(projectPath);
      session.previewSource = "live-server";
      return { previewUrl, previewSource: "live-server" };
    } catch {
      session.previewSource = "next-static";
      return { previewUrl: "/preview/", previewSource: "next-static" };
    }
  }

  const htmlPages = rerenderFromContext(session.siteContext);
  session.htmlPages = htmlPages;
  await persistHtmlPreview(htmlPages);
  session.previewSource = "html-fallback";
  return { previewUrl: "/preview/", previewSource: "html-fallback" };
}

export async function startPlaygroundServer(options: PlaygroundServerOptions = {}): Promise<{
  url: string;
  close: () => void;
}> {
  if (process.env.SKIP_VISION !== "1") {
    await ensurePlaywrightBrowsers();
  }

  const basePort = options.port ?? Number(process.env.PLAYGROUND_PORT ?? 3847);

  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json({ limit: "256kb" }));
    mountAdmin(app);
    app.use(express.static(PUBLIC_DIR));
    // Every user-uploaded logo/photo (initial upload and in-preview replacements alike) lands under
    // `output/_user-media/<sessionId>/...` (`emptyMediaSessionDir`) and is referenced in composed
    // HTML by the matching `/media/<sessionId>/<filename>` URL (`writeDecodedUploads`'s `publicSrc`)
    // — without this mount that URL 404'd and an uploaded image never actually rendered.
    app.use("/media", express.static(path.resolve("output", "_user-media")));
    mountPreviewRoutes(app);

    app.post("/api/media", express.json({ limit: "12mb" }), async (req, res) => {
      pruneMediaSessions();
      try {
        const logo = req.body?.logo as DecodedUpload | undefined;
        const photos = Array.isArray(req.body?.photos) ? (req.body.photos as DecodedUpload[]) : [];
        if (!logo?.data && photos.length === 0) {
          res.status(400).json({ error: "Upload a logo or at least one photo" });
          return;
        }
        const id = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const library = await writeDecodedUploads(emptyMediaSessionDir(id), logo, photos);
        mediaSessions.set(id, { library, createdAt: Date.now() });
        res.json({
          mediaId: id,
          logo: Boolean(library.logo),
          photos: library.photos.length,
        });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Could not save images" });
      }
    });

    /**
     * Upload a single replacement image from the in-preview editing layer — a content photo (any
     * `data-wg-photo` element) or the site logo. Returns a `/media/...` URL the caller then saves
     * via `/api/edit`'s `photo`/`logo` revisions, same two-step shape text edits already use
     * (patch the DOM, persist in the background) except the upload itself can't be optimistic.
     */
    app.post("/api/edit/media", express.json({ limit: "12mb" }), async (req, res) => {
      try {
        const upload = req.body?.file as DecodedUpload | undefined;
        const isLogo = req.body?.kind === "logo";
        if (!upload?.data) {
          res.status(400).json({ error: "Upload a file" });
          return;
        }
        const dir = emptyMediaSessionDir(`edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        const library = await writeDecodedUploads(dir, isLogo ? upload : undefined, isLogo ? [] : [upload]);
        const asset = isLogo ? library.logo : library.photos[0];
        if (!asset) {
          res.status(400).json({ error: "Could not save image" });
          return;
        }
        res.json({ url: asset.publicSrc });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
      }
    });

    /**
     * In-preview editing for verbatim sites.
     *
     * The overlay composition injects (`withEditLayer`) posts here: text edits carry the anchor
     * they were made on, structural edits carry the section wrapper's `<templateId>:<sectionId>`.
     * State is recomposed through the same path a first generation uses and re-persisted, so what
     * the preview shows after an edit is exactly what a fresh render of that state would produce.
     */
    app.post("/api/edit", async (req, res) => {
      const session = getEditorSession();
      // Session state dies with the process; disk state does not. Falling back means an edit made
      // after a dev restart still lands instead of failing with "generate a site first".
      const current: VerbatimSiteState | null = session?.verbatimState ?? (await loadSiteState());
      if (!current) {
        res.status(409).json({ error: "No editable site — generate one first" });
        return;
      }
      const revisions = Array.isArray(req.body?.revisions) ? (req.body.revisions as VerbatimRevision[]) : [];
      if (revisions.length === 0) {
        res.status(400).json({ error: "No revisions supplied" });
        return;
      }
      const page = typeof req.body?.page === "string" ? req.body.page : undefined;
      try {
        const payload = await queueEdit(async () => {
          // Re-read inside the queue: an edit that waited must build on the one before it, not on
          // the state as it looked when this request arrived.
          const live = getEditorSession();
          const base: VerbatimSiteState = live?.verbatimState ?? (await loadSiteState()) ?? current;
          const result = await applyVerbatimRevisions(base, revisions, { ...(page ? { page } : {}) });
          await persistHtmlPreview(result.site.htmlPages, result.site.files, { editable: true });
          await saveSiteState(result.state);
          if (live) {
            live.verbatimState = result.state;
            live.htmlPages = result.site.htmlPages;
            live.verbatimFiles = result.site.files;
          }
          return {
            ok: result.applied.length > 0,
            applied: result.applied,
            rejected: result.rejected,
            stats: result.site.stats,
          };
        });
        res.json(payload);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Edit failed" });
      }
    });

    /** The placed sections of the current verbatim site, for the sections panel. */
    app.get("/api/edit/state", async (_req, res) => {
      const session = getEditorSession();
      const current: VerbatimSiteState | null = session?.verbatimState ?? (await loadSiteState());
      if (!current) {
        res.status(404).json({ error: "No editable site" });
        return;
      }
      res.json({
        businessName: current.brief.businessName,
        theme: current.theme ?? null,
        editCount: Object.keys(current.overrides ?? {}).length,
        pages: Object.fromEntries(
          Object.entries(current.pages).map(([slug, sections]) => [
            slug,
            sections.map((section) => ({
              key: `${section.templateId}:${section.sectionId}`,
              role: section.role,
              templateId: section.templateId,
            })),
          ])
        ),
      });
    });

    app.get("/api/session", (_req, res) => {
      const session = getEditorSession();
      if (!session) {
        res.status(404).json({ error: "No active session" });
        return;
      }
      // A verbatim site has no `reactPages` and its `ctx.pages[].sections` are a stub, so the
      // sections panel used to render empty. Report the placed sections instead, keyed the way the
      // preview and /api/edit address them.
      const verbatim = session.verbatimState;
      if (verbatim) {
        res.json({
          businessName: session.site.businessName,
          designSystem: session.siteContext.designSystem,
          outputMode: session.outputMode ?? "html",
          mode: "verbatim",
          theme: verbatim.theme ?? null,
          editCount: Object.keys(verbatim.overrides ?? {}).length,
          pages: Object.entries(verbatim.pages).map(([slug, sections]) => ({
            slug,
            title: slug,
            sections: sections.map((section) => ({
              id: `${section.templateId}:${section.sectionId}`,
              intent: section.role,
              archetype: section.templateId,
              blockCount: 0,
            })),
          })),
          reactPages: [],
          cmsCollections: session.siteContext.cmsCollections ?? [],
        });
        return;
      }

      res.json({
        businessName: session.site.businessName,
        designSystem: session.siteContext.designSystem,
        outputMode: session.outputMode ?? "html",
        mode: "skin",
        pages: session.siteContext.reactPages
          ? Object.entries(session.siteContext.reactPages).map(([slug, page]) => ({
              slug,
              title: page.title,
              sections: page.sections.map((s) => ({
                id: s.id,
                intent: s.intent,
                archetype: s.templateId,
                blockCount: Object.keys(s.props).length,
              })),
            }))
          : Object.entries(session.siteContext.pages).map(([slug, page]) => ({
              slug,
              title: page.title,
              sections: page.sections.map((s) => ({
                id: s.id,
                intent: s.intent,
                archetype: s.archetype,
                blockCount: s.blocks.length,
              })),
            })),
        reactPages: session.siteContext.reactPages
          ? Object.entries(session.siteContext.reactPages).map(([slug, page]) => ({
              slug,
              title: page.title,
              sectionCount: page.sections.length,
            }))
          : [],
        cmsCollections: session.siteContext.cmsCollections ?? [],
      });
    });

    app.post("/api/revise", async (req, res) => {
      const guard = getEditorSession();
      if (guard?.verbatimState) {
        res
          .status(409)
          .json({ error: "This site is built from vendored templates — edit it in the preview (Edit button) instead." });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      const send = (payload: Record<string, unknown>) => {
        if (res.writableEnded) return;
        try {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch {
          /* client disconnected */
        }
      };
      try {
        const message = String(req.body?.message ?? "").trim();
        if (!message) {
          send({ type: "error", message: "Revision message is required" });
          return;
        }
        const session = getEditorSession();
        if (!session) {
          send({ type: "error", message: "Generate a site first" });
          return;
        }
        send({ type: "status", message: "planning" });
        send({ type: "log", line: `Revising: ${message}` });
        const patch = await planRevision(session.siteContext, message);
        send({ type: "log", line: patch.summary });
        if (patch.kind === "refuse") {
          send({
            type: "done",
            refused: true,
            kind: patch.kind,
            summary: patch.summary,
            reason: patch.reason,
            previewUrl: "/preview/",
          });
          return;
        }
        send({ type: "status", message: "applying" });
        updateEditorSession((current) => {
          applyRevision(current.siteContext, patch);
          current.site.theme = current.siteContext.designSystem;
        });
        send({ type: "status", message: "rebuilding" });
        send({ type: "log", line: "Rebuilding preview…" });
        const preview = await persistPreview();
        const pages = getEditorSession()?.siteContext.reactPages
          ? Object.keys(getEditorSession()!.siteContext.reactPages!)
          : getEditorSession()?.site.pages.map((page) => page.slug) ?? [];
        send({
          type: "done",
          refused: false,
          kind: patch.kind,
          summary: patch.summary,
          previewUrl: preview.previewUrl,
          previewSource: preview.previewSource,
          pages,
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        res.end();
      }
    });

    app.patch("/api/theme", async (req, res) => {
      const guard = getEditorSession();
      if (guard?.verbatimState) {
        res
          .status(409)
          .json({ error: "This site is built from vendored templates — edit it in the preview (Edit button) instead." });
        return;
      }

      try {
        updateEditorSession((session) => {
          applyThemePatch(session.siteContext, req.body ?? {});
          session.site.theme = session.siteContext.designSystem;
        });
        await persistPreview();
        res.json({ ok: true, designSystem: getEditorSession()!.siteContext.designSystem });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    app.post("/api/sections/reorder", async (req, res) => {
      const guard = getEditorSession();
      if (guard?.verbatimState) {
        res
          .status(409)
          .json({ error: "This site is built from vendored templates — edit it in the preview (Edit button) instead." });
        return;
      }

      try {
        const pageSlug = String(req.body?.pageSlug ?? "");
        const sectionIds = req.body?.sectionIds as string[];
        if (!pageSlug || !Array.isArray(sectionIds)) {
          res.status(400).json({ error: "pageSlug and sectionIds required" });
          return;
        }
        updateEditorSession((session) => {
          reorderSections(session.siteContext, pageSlug, sectionIds);
          const page = session.siteContext.pages[pageSlug];
          if (!page) return;
          const assembled = assemblePageFromSections(page.sections);
          const pageIdx = session.site.pages.findIndex((p) => p.slug === pageSlug);
          if (pageIdx >= 0) {
            session.site.pages[pageIdx] = {
              ...session.site.pages[pageIdx]!,
              content: assembled.content,
              layout: assembled.layout,
              sections: page.sections,
            };
          }
        });
        await persistPreview();
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    app.post("/api/sections/:sectionId/regenerate", async (req, res) => {
      try {
        const sectionId = req.params.sectionId!;
        const pageSlug = String(req.body?.pageSlug ?? "home");
        const session = getEditorSession();
        if (!session) throw new Error("No active session");

        const pagePlan = getPagePlan(session.siteContext.sitePlan, pageSlug);
        if (!pagePlan) throw new Error(`Page not found: ${pageSlug}`);

        const registry = MediaRegistry.fromJSON(session.siteContext.mediaRegistry);
        const section = await regenerateSection(
          session.siteContext,
          pagePlan,
          sectionId,
          registry
        );

        updateEditorSession((s) => {
          const page = s.siteContext.pages[pageSlug]!;
          const idx = page.sections.findIndex((sec) => sec.id === sectionId);
          if (idx >= 0) page.sections[idx] = section;
          s.siteContext.mediaRegistry = registry.toJSON();
          const assembled = assemblePageFromSections(page.sections);
          const pageIdx = s.site.pages.findIndex((p) => p.slug === pageSlug);
          if (pageIdx >= 0) {
            s.site.pages[pageIdx] = {
              ...s.site.pages[pageIdx]!,
              content: assembled.content,
              layout: assembled.layout,
              sections: page.sections,
            };
          }
        });

        await persistPreview();
        res.json({ ok: true, section });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    app.get("/api/sites/:slug", async (req, res) => {
      try {
        if (!isSupabaseConfigured()) {
          res.status(503).json({ error: "Supabase is not configured" });
          return;
        }
        const site = await getSiteBySlug(req.params.slug!);
        if (!site) {
          res.status(404).json({ error: "Site not found" });
          return;
        }
        res.json({
          slug: site.slug,
          businessName: site.business_name,
          status: site.status,
          publishedUrl: site.published_url,
          outBytes: site.out_bytes,
          variationSeed: site.variation_seed,
          publishedAt: site.published_at,
          storagePrefix: site.storage_prefix,
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    app.post("/api/sites/:slug/publish", async (req, res) => {
      try {
        if (!isSupabaseConfigured()) {
          res.status(503).json({ error: "Supabase is not configured" });
          return;
        }
        const session = getEditorSession();
        const slug = req.params.slug!;

        // A verbatim site has no React build to publish; it publishes the composed pages it
        // already has. The clean HTML is recomposed here rather than read from the preview copy,
        // which carries the authoring layer.
        if (session?.verbatimState) {
          const site = await composeVerbatimSite(session.verbatimState);
          const result = await publishVerbatimSite({
            ctx: session.siteContext,
            htmlPages: site.htmlPages,
            files: site.files,
            slug,
          });
          res.json(result);
          return;
        }

        if (!session?.reactStaticOutPath || !session.reactProjectPath) {
          res.status(400).json({ error: "No built React site in session — generate first" });
          return;
        }
        const result = await publishSite({
          ctx: session.siteContext,
          outPath: session.reactStaticOutPath,
          projectPath: session.reactProjectPath,
          slug,
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    app.get("/api/export", (req, res) => {
      const session = getEditorSession();
      if (!session) {
        res.status(404).json({ error: "No active session" });
        return;
      }
      const format = String(req.query.format ?? "project");
      const ctx = session.siteContext;
      if (format === "react") {
        res.type("text/plain").send(exportReactProject(ctx));
        return;
      }
      if (format === "webflow") {
        res.type("application/json").send(exportWebflowJson(ctx));
        return;
      }
      res.type("application/json").send(exportProjectJson(ctx));
    });

    app.post("/api/generate", async (req, res) => {
      const brief = String(req.body?.brief ?? "").trim();
      if (!brief) {
        res.status(400).json({ error: "Brief is required" });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const send = (payload: Record<string, unknown>) => {
        if (res.writableEnded) return;
        try {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch {
          // Client disconnected — pipeline keeps running; errors surface via catch below.
        }
      };

      const heartbeat = setInterval(() => {
        send({ type: "ping", ts: Date.now() });
      }, 15_000);

      const unsub = subscribePipelineLogs((line) => send({ type: "log", line }));

      const jobId = createJobId();
      registerJob(jobId);
      let generationResult: Awaited<ReturnType<typeof generateSite>> | undefined;

      try {
        send({ type: "status", message: "starting", jobId });

        const businessName = extractBusinessName(brief);

        const variationSeed =
          typeof req.body?.variationSeed === "number"
            ? req.body.variationSeed
            : req.body?.regenerate
              ? Date.now()
              : undefined;

        const consumerId =
          typeof req.body?.consumerId === "string" && req.body.consumerId.trim()
            ? req.body.consumerId.trim()
            : undefined;

        const userMedia = takeMediaSession(req.body?.mediaId);

        const result = await runExclusive(jobId, () =>
          generateSite({
            businessBrief: brief,
            businessName,
            enableVisionPolish: llm.supportsVision && process.env.SKIP_VISION !== "1",
            variationSeed,
            jobId,
            consumerId,
            userMedia,
          })
        );
        generationResult = result;

        setEditorSession(result);

        let previewUrl = "/preview/";
        let previewSource = result.previewSource ?? "html-fallback";

        if (result.reactProjectPath && result.reactStaticOutPath && result.buildSucceeded) {
          try {
            previewUrl = await startReactPreviewServer(result.reactProjectPath);
            previewSource = "live-server";
            send({ type: "log", line: `[preview] Live server → ${previewUrl}` });
          } catch (err) {
            send({
              type: "log",
              line: `[preview] Live server failed (${err instanceof Error ? err.message : String(err)}) — static fallback`,
            });
            previewUrl = "/preview/";
            previewSource = "next-static";
          }
          await persistReactPreview(result.reactStaticOutPath);
        } else if (result.reactStaticOutPath && result.buildSucceeded) {
          await persistReactPreview(result.reactStaticOutPath);
          previewSource = "next-static";
        } else {
          // A verbatim site is editable in place, so its preview copy carries the authoring layer
          // and its state is written to disk — the generated HTML itself stays clean for publish.
          const editable = Boolean(result.verbatimState);
          await persistHtmlPreview(result.htmlPages, result.verbatimFiles ?? [], { editable });
          if (result.verbatimState) await saveSiteState(result.verbatimState);
          previewSource = "html-fallback";
          if (result.outputMode === "react" && result.buildSucceeded === false && result.reactProjectPath) {
            send({
              type: "log",
              line: `[pipeline] Failed React project kept at ${result.reactProjectPath} (run npm run build inside to debug)`,
            });
          }
        }

        completeJob(jobId, result);

        const success = !result.degraded;

        send({
          type: success ? "done" : "degraded",
          businessName: result.site.businessName,
          previewUrl,
          timingMs: result.timingMs,
          pages: result.site.pages.map((p) => p.slug),
          editorReady: success,
          outputMode: result.outputMode ?? "html",
          reactProjectPath: result.reactProjectPath,
          previewSource,
          buildSucceeded: result.buildSucceeded,
          degraded: result.degraded,
          qaSummary: result.qaSummary,
          variationSeed: result.variationSeed,
          verticalProfileId: result.verticalProfileId,
          skinId: result.skinId,
          skinName: result.skinName,
          siteSlug: result.siteSlug ?? siteSlugFromName(result.site.businessName),
          publishedUrl: result.publishedUrl,
          outBytes: result.outBytes,
          jobId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failJob(jobId, message);
        send({
          type: "error",
          message,
        });
      } finally {
        clearInterval(heartbeat);
        unsub();
        // Keep output/_playground-react for debugging (orchestrator already strips node_modules/.next).
        // Static export is copied to output/_playground for /preview/ in the playground UI.
        await closeQABrowser();
        res.end();
      }
    });

    const tryListen = (port: number, attemptsLeft: number) => {
      const server = app.listen(port, () => {
        const url = `http://localhost:${port}`;
        if (port !== basePort) {
          console.log(`Port ${basePort} in use — started on ${port} instead`);
        }
        resolve({
          url,
          close: () => {
            stopReactPreviewServer();
            server.close();
          },
        });
      });

      server.on("error", (err: NodeJS.ErrnoException) => {
        server.close();
        if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
          tryListen(port + 1, attemptsLeft - 1);
          return;
        }
        reject(
          new Error(
            err.code === "EADDRINUSE"
              ? `Ports ${basePort}–${port} are in use. Stop the other server (lsof -ti:${basePort} | xargs kill) or set PLAYGROUND_PORT in .env`
              : err.message
          )
        );
      });
    };

    tryListen(basePort, 10);
  });
}
