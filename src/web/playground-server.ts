import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { generateSite } from "../orchestrator/orchestrator.js";
import { writeSiteOutput } from "../server/preview-server.js";
import { subscribePipelineLogs } from "../util/pipeline-log.js";
import { extractBusinessName } from "../util/extract-name.js";
import { llm } from "../llm/client.js";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PLAYGROUND_OUTPUT = path.resolve("output", "_playground");

export interface PlaygroundServerOptions {
  port?: number;
}

async function persistPreview(): Promise<void> {
  const session = getEditorSession();
  if (!session?.siteContext) return;
  const htmlPages = rerenderFromContext(session.siteContext);
  session.htmlPages = htmlPages;
  await writeSiteOutput(PLAYGROUND_OUTPUT, htmlPages);
}

export function startPlaygroundServer(options: PlaygroundServerOptions = {}): Promise<{
  url: string;
  close: () => void;
}> {
  const basePort = options.port ?? Number(process.env.PLAYGROUND_PORT ?? 3847);

  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json({ limit: "256kb" }));
    app.use(express.static(PUBLIC_DIR));
    app.use("/preview", express.static(PLAYGROUND_OUTPUT));

    app.get("/api/session", (_req, res) => {
      const session = getEditorSession();
      if (!session) {
        res.status(404).json({ error: "No active session" });
        return;
      }
      res.json({
        businessName: session.site.businessName,
        designSystem: session.siteContext.designSystem,
        pages: Object.entries(session.siteContext.pages).map(([slug, page]) => ({
          slug,
          title: page.title,
          sections: page.sections.map((s) => ({
            id: s.id,
            intent: s.intent,
            archetype: s.archetype,
            blockCount: s.blocks.length,
          })),
        })),
        cmsCollections: session.siteContext.cmsCollections ?? [],
      });
    });

    app.patch("/api/theme", async (req, res) => {
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
      try {
        const pageSlug = String(req.body?.pageSlug ?? "");
        const sectionIds = req.body?.sectionIds as string[];
        if (!pageSlug || !Array.isArray(sectionIds)) {
          res.status(400).json({ error: "pageSlug and sectionIds required" });
          return;
        }
        updateEditorSession((session) => {
          reorderSections(session.siteContext, pageSlug, sectionIds);
          const page = session.siteContext.pages[pageSlug]!;
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
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      const unsub = subscribePipelineLogs((line) => send({ type: "log", line }));

      try {
        send({ type: "status", message: "starting" });
        const businessName = extractBusinessName(brief);

        const result = await generateSite({
          businessBrief: brief,
          businessName,
          enableVisionPolish: llm.supportsVision && process.env.SKIP_VISION !== "1",
        });

        setEditorSession(result);
        await writeSiteOutput(PLAYGROUND_OUTPUT, result.htmlPages);

        send({
          type: "done",
          businessName: result.site.businessName,
          previewUrl: "/preview/index.html",
          timingMs: result.timingMs,
          pages: result.site.pages.map((p) => p.slug),
          editorReady: true,
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        unsub();
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
          close: () => server.close(),
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
