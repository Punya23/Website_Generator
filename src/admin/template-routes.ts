/**
 * Admin surface for the local verbatim-template corpus.
 *
 * Separate from the GitHub ingest routes in `http.ts`: that pipeline discovers remote repos,
 * verifies licenses and stores composition recipes, while this one reads a local bundle of zips
 * and stores the templates themselves. Mounted under the same `adminGuard`.
 */
import express, { type Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { templatesBundleDir } from "../templates/config.js";
import { ingestTemplateZip, readManifest, templateCachePath } from "../templates/ingest/ingest-template.js";
import { runBundleIngest } from "../templates/ingest/run-ingest.js";
import { templateStore } from "../templates/store.js";
import { getGeneration, listGenerations } from "../templates/generation-store.js";
import { templateRepository } from "../templates/db/repository.js";

export function templateRoutes(): Router {
  const api = express.Router();
  const store = templateStore();
  const repo = templateRepository();

  api.get("/", async (req, res) => {
    const index = await store.index();
    const summary = await repo.summary();
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const templates = await repo.templates({
      ...(status && status !== "all" ? { status: status as "ready" } : {}),
      ...(search ? { search } : {}),
      // Was 500 — silently dropped ~400 of this corpus's 906 templates from the admin view (and,
      // confirmed live, from the client-side "below quality gate" filter too: 4 of the real 8
      // flagged templates happened to fall past row 500 and were simply invisible). This is an
      // internal admin tool serving one JSON response, not a paginated customer list — sending the
      // whole corpus is a few hundred KB, a fine trade for the view actually being complete.
      limit: 2000,
    });
    res.json({
      bundleDir: templatesBundleDir(),
      updatedAt: index.updatedAt,
      totals: {
        templates: summary.templates,
        ready: summary.ready,
        needsReview: summary.needsReview,
        failed: summary.failed,
        sections: summary.sections,
        untagged: summary.untagged,
        qualityBelowGate: summary.qualityBelowGate,
      },
      bundle: summary.bundle,
      sectionsByRole: summary.byRole,
      byIndustry: summary.byIndustry,
      byIndustryTemplates: summary.byIndustryTemplates,
      byCategory: summary.byCategory,
      byTheme: summary.byTheme,
      templates,
    });
  });

  // Registered before the `/:templateId` catch-all below, same reason `/generations` is — a
  // literal path segment ("consumers") must come first or Express matches it as `templateId`.
  /** The anti-repeat memory driving "don't give this consumer the same template twice" — no admin
   *  surface existed for this at all before, despite the pipeline reading and writing it on every
   *  generation. */
  api.get("/consumers/:consumerId/history", async (req, res) => {
    const consumerId = String(req.params.consumerId);
    const used = await repo.consumerHistory(consumerId);
    const distinctTemplates = new Set(used.map((row) => row.templateId)).size;
    res.json({ consumerId, sectionsUsed: used.length, distinctTemplates, used });
  });

  /**
   * Render one ingested template as a standalone page — the corpus equivalent of the skin preview.
   * Assets are served back through this router rather than from the site output, so a template can
   * be reviewed before it has ever been used in a generation.
   */
  api.get("/:templateId/preview", async (req, res) => {
    const templateId = String(req.params.templateId);
    const manifest = await repo.template(templateId);
    if (!manifest || manifest.status !== "ready") {
      res.status(404).send("Template not ingested (or not ready)");
      return;
    }
    const dir = templateCachePath(templateId);
    const assetBase = `/api/admin/local-templates/${templateId}/asset/`;
    const roleFilter = typeof req.query.role === "string" ? req.query.role : undefined;
    const sections = roleFilter
      ? manifest.sections.filter((section) => section.role === roleFilter)
      : manifest.sections;

    const parts: string[] = [];
    for (const section of sections.slice(0, 40)) {
      try {
        const html = await fs.readFile(path.join(dir, section.htmlCachePath), "utf8");
        parts.push(
          `<div class="tpl-sec"><span class="tpl-tag">${section.role} · ${section.id}</span>` +
            `<div data-tpl="${templateId}" data-role="${section.role}" data-section="${section.id}">` +
            `${html.replaceAll("_tpl-assets/" + templateId + "/", assetBase)}</div></div>`
        );
      } catch {
        // A section whose cached fragment is gone is skipped — the rest still previews.
      }
    }

    let css = "";
    if (manifest.cssCachePath) {
      try {
        css = (await fs.readFile(path.join(dir, manifest.cssCachePath), "utf8")).replaceAll(
          "_tpl-assets/" + templateId + "/",
          assetBase
        );
      } catch {
        // No stylesheet: the markup still previews, unstyled, which is itself the finding.
      }
    }

    res.type("html").send(`<!doctype html><html><head><meta charset="utf-8">
<title>${manifest.name} — template preview</title>
<style>
  body{margin:0;background:#0b0b0c;color:#eee;font:14px/1.5 system-ui,sans-serif}
  .tpl-head{padding:12px 16px;background:#111;border-bottom:1px solid #222;position:sticky;top:0;z-index:99}
  .tpl-head b{color:#fff}
  .tpl-head span{color:#8b8b90;margin-left:10px}
  .tpl-sec{position:relative;border-bottom:1px dashed #2a2a2e}
  .tpl-tag{position:absolute;top:4px;left:4px;z-index:98;background:#6366f1;color:#fff;
    font:600 11px/1 system-ui,sans-serif;padding:4px 7px;border-radius:5px;opacity:.9}
</style>
<style>${css}</style></head>
<body>
<div class="tpl-head"><b>${manifest.name}</b>
  <span>${manifest.templateId}</span>
  <span>${manifest.industry ?? "no industry"} / ${manifest.category ?? "no category"}</span>
  <span>${manifest.theme ?? "theme unknown"}</span>
  <span>${manifest.sections.length} sections</span>
</div>
${parts.join("\n")}
</body></html>`);
  });

  /** Assets for the preview above, read from the template's own cached source tree. */
  api.get("/:templateId/asset/*", async (req, res) => {
    const templateId = String(req.params.templateId);
    const manifest = await repo.template(templateId);
    if (!manifest) {
      res.status(404).end();
      return;
    }
    // Express 4 exposes a `*` match as params[0]; its types model it as a string[] union, so this
    // reads it defensively rather than asserting one shape.
    const wildcard = (req.params as unknown as Record<string, string | string[] | undefined>)[0];
    const rel = Array.isArray(wildcard) ? wildcard.join("/") : String(wildcard ?? "");
    const root = path.resolve(templateCachePath(templateId), "src", manifest.sourceRootRelPath);
    const target = path.resolve(root, rel);
    // Never serve outside the template's own extracted tree.
    if (!target.startsWith(root)) {
      res.status(403).end();
      return;
    }
    res.sendFile(target, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  // Registered before the `/:templateId` catch-all below — Express matches routes in
  // registration order, so a literal `/generations` path must come first or it is swallowed as
  // `templateId === "generations"` and 404s as "Unknown template" (confirmed live).
  /** Which template every site's every section came from, and exactly what changed in it. */
  api.get("/generations", async (req, res) => {
    const limitRaw = Number.parseInt(String(req.query.limit ?? ""), 10);
    const rows = await listGenerations({
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100,
      ...(req.query.consumerId ? { consumerId: String(req.query.consumerId) } : {}),
    });
    res.json({ count: rows.length, generations: rows });
  });

  api.get("/generations/:id", async (req, res) => {
    const record = await getGeneration(String(req.params.id));
    if (!record) {
      res.status(404).json({ error: "Unknown generation" });
      return;
    }
    res.json(record);
  });

  api.get("/:templateId", async (req, res) => {
    const manifest = await readManifest(String(req.params.templateId));
    if (!manifest) {
      res.status(404).json({ error: "Unknown template" });
      return;
    }
    res.json(manifest);
  });

  /** Re-ingest a single archive by file name inside the bundle directory. */
  api.post("/ingest-one", async (req, res) => {
    const name = String(req.body?.name ?? "");
    // Name only — never an arbitrary path, so this cannot be pointed at the rest of the disk.
    if (!name || name.includes("/") || name.includes("\\") || !name.toLowerCase().endsWith(".zip")) {
      res.status(400).json({ error: "Expected a .zip file name inside the bundle directory" });
      return;
    }
    try {
      const manifest = await ingestTemplateZip(path.join(templatesBundleDir(), name), { force: true });
      store.invalidate();
      await store.rebuild();
      res.json(manifest);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Ingest the whole bundle. Streams progress as newline-delimited text. */
  api.post("/ingest", async (req, res) => {
    const force = req.body?.force === true || req.body?.force === "1";
    const limit = Number.parseInt(String(req.body?.limit ?? ""), 10);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    try {
      const summary = await runBundleIngest({
        force,
        ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
        onProgress: (line) => res.write(`${line}\n`),
      });
      res.end(`done ready=${summary.ready} needs_review=${summary.needsReview} failed=${summary.failed}\n`);
    } catch (err) {
      res.end(`error ${err instanceof Error ? err.message : String(err)}\n`);
    }
  });

  api.post("/reindex", async (_req, res) => {
    store.invalidate();
    res.json(await store.rebuild());
  });

  return api;
}
