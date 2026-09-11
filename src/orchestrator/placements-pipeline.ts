/**
 * The real-estate placements path as an orchestrator pipeline: a hand-built template
 * (`real-estate/*`), filled via `fillRealEstateTemplate` (the same fill this project's own
 * `scripts/generate-real-site.ts` CLI uses), producing `htmlPages` in the same shape
 * `runVerbatimTemplatePipeline`/`runSkinHtmlPipeline` already do — a fixed page set owned by the
 * chosen asset, not `sitePlan` (same structural shape `runSkinHtmlPipeline` already has: a skin's
 * page set is fixed too, independent of the LLM-planned site).
 *
 * Deliberately NOT at parity with the other two pipelines yet: no vision-QA redo loop
 * (`final-vision-gate.ts`), no `recordGeneration` entry, no publish-path-specific wiring. Those are
 * real follow-ups, not oversights — see `pipeline-speed.ts`'s `usePlacementsPipeline` doc comment
 * for why this stays opt-in until they land. What IS here — `runCodeQA` per page, the same
 * `QAResult` shape every other path produces — is enough for `orchestrator.ts` to slot this in as a
 * fourth branch without special-casing the result downstream.
 *
 * Phase 4 (docs/PLACEMENTS_ORCHESTRATION_PLAN.md, "post-fill QA") found and fixed a real gap here,
 * not just added metrics: `runCodeQA` was called with no `pageUrl`, so QA ran against
 * `page.setContent()` on `about:blank` — the exact "cannot resolve stylesheets/images at all" case
 * `CodeQAOptions.pageUrl`'s own doc comment warns about. Worse, `files` (this template's own
 * `assets/css`, `assets/js`) was never returned to the orchestrator at all, so a real generation on
 * this path shipped with `verbatimFiles` empty and its CSS/JS never copied into output — a
 * completely unstyled site, invisible until now because QA had no real file:// base to catch it
 * against. Both fixed together: `files` now returned and staged, QA now runs against the staged
 * copy with a real `pageUrl`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { QAIssue, QAResult, SiteContext } from "../types.js";
import { fillRealEstateTemplate } from "../templates/placements/fill-real-estate-template.js";
import { checkBrandLeak } from "../templates/placements/brand-leak.js";
import { runCodeQA } from "../qa/code-qa.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { timedStep } from "../util/timed.js";
import { stageSite } from "./verbatim-template-pipeline.js";
import { pageFileName, type FileCopy } from "../templates/compose.js";

export const REAL_ESTATE_TEMPLATE_IDS = [
  "real-estate-agency",
  "luxury-real-estate",
  "commercial-real-estate",
  "property-management",
] as const;
export type RealEstateTemplateId = (typeof REAL_ESTATE_TEMPLATE_IDS)[number];

/** Keyword weight per sub-vertical — same shape as `skins/taxonomy.ts`'s industry scoring
 *  (strong/medium hits summed), kept local and small rather than extending that module: these four
 *  ids are sub-verticals WITHIN the one `"real-estate"` industry `classifyTaxonomy` already
 *  resolves upstream (see `orchestrator.ts`'s gate), not siblings of it, and nothing outside this
 *  file needs to classify against them. `real-estate-agency` (the generalist template) is also the
 *  fallback when nothing else scores above it — a brief that doesn't clearly signal luxury,
 *  commercial, or property-management belongs on the generalist template, not a guess. */
const SUB_VERTICAL_KEYWORDS: Record<RealEstateTemplateId, string[]> = {
  "luxury-real-estate": ["luxury", "high-end", "high end", "premier", "exclusive", "penthouse", "estate", "prestige", "waterfront", "bespoke", "elite"],
  "commercial-real-estate": ["commercial", "office space", "retail space", "industrial", "warehouse", "tenant", "cre", "investor", "lease rate", "square footage", "coworking"],
  "property-management": ["property management", "property manager", "landlord", "rental", "rent collection", "maintenance request", "hoa", "leasing office", "portfolio of properties"],
  "real-estate-agency": [],
};

/** Scores `brief` against each sub-vertical's keyword list (simple case-insensitive substring
 *  count, not `classifyTaxonomyWeighted`'s full hit-weighting — four short lists don't need it) and
 *  returns the highest-scoring id, `real-estate-agency` on a tie or an all-zero score. */
export function pickRealEstateTemplate(brief: string): RealEstateTemplateId {
  const text = brief.toLowerCase();
  let best: RealEstateTemplateId = "real-estate-agency";
  let bestScore = 0;
  for (const id of REAL_ESTATE_TEMPLATE_IDS) {
    const score = SUB_VERTICAL_KEYWORDS[id].reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/** `"index.html"` -> `"home"`, `"about.html"` -> `"about"` — the same slug convention
 *  `compose.ts`'s `pageFileName` uses in the other direction, so `htmlPages`/`qaResults` keys line
 *  up with what `ctx.pages`, publish, and the admin UI already expect from every other pipeline. */
function slugForPageFile(pageFile: string): string {
  return pageFile === "index.html" ? "home" : pageFile.replace(/\.html$/, "");
}

/**
 * Every file under `templateDir` a page might reference at output time — everything except the
 * pages themselves and the placements sidecar files, which `fillRealEstateTemplate`/this pipeline
 * already handle on their own path. For the four templates this repo ships, that's `assets/css` and
 * `assets/js`; written generically (a real recursive walk, not a hardcoded `assets/` path) so a
 * fifth curated template with a different asset layout is copied correctly with no change here.
 */
export async function collectTemplateAssets(templateDir: string): Promise<FileCopy[]> {
  const files: FileCopy[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (entry.name.endsWith(".html") || entry.name.endsWith(".json")) continue;
      files.push({ from: absolute, to: path.relative(templateDir, absolute) });
    }
  }
  await walk(templateDir);
  return files;
}

export interface PlacementsPipelineResult {
  templateId: RealEstateTemplateId;
  htmlPages: Record<string, string>;
  qaResults: Record<string, QAResult>;
  /** This template's own `assets/css`, `assets/js`, etc. — must reach `writeSiteOutput` the same
   *  way `verbatimFiles` does for the other pipelines, or the shipped site has no stylesheet. */
  files: FileCopy[];
}

export async function runPlacementsPipeline(ctx: SiteContext, businessBrief: string): Promise<PlacementsPipelineResult> {
  const templateId = pickRealEstateTemplate(businessBrief);
  const templateDir = path.resolve(process.cwd(), "real-estate", templateId);
  pipelineLog(`[pipeline] Real-estate placements — template ${templateId}`);

  const filled = await timedStep("site", "placements fill", () =>
    fillRealEstateTemplate(templateDir, businessBrief, {
      onProgress: (line) => pipelineLog(`[pipeline] placements: ${line}`),
    })
  );

  const htmlPages: Record<string, string> = {};
  const skippedByPage: Record<string, string[]> = {};
  for (const [pageFile, page] of Object.entries(filled.pages)) {
    const slug = slugForPageFile(pageFile);
    htmlPages[slug] = page.html;
    skippedByPage[slug] = page.skipped;
    ctx.pages[slug] = {
      slug,
      title: filled.file.pages[pageFile]?.title ?? slug,
      sections: [],
    };
  }

  // Staged with real files on disk — `runCodeQA`'s own `pageUrl` doc comment: without it, every
  // external stylesheet/image reports broken regardless of whether it actually is, because
  // `setContent()` has no base URL to resolve a relative path against at all. See this module's own
  // doc comment for the real bug that shipped because this used to be skipped.
  const files = await collectTemplateAssets(templateDir);
  const stageDir = await stageSite(htmlPages, files);

  const qaResults: Record<string, QAResult> = {};
  for (const slug of Object.keys(htmlPages)) {
    const pageUrl = pathToFileURL(path.join(stageDir, pageFileName(slug))).href;
    const result = await timedStep(slug, "QA", () =>
      runCodeQA(htmlPages[slug] ?? "", slug, { pageUrl, businessName: filled.brief.businessName })
    );

    const extraIssues: QAIssue[] = [];
    const leaks = checkBrandLeak(htmlPages[slug] ?? "", filled.brief.businessName ?? "");
    for (const leak of leaks) {
      pipelineLog(`[pipeline] WARNING: brand leak on ${slug} — "${leak.brand}" appears ${leak.count}x`);
      extraIssues.push({
        severity: "hard",
        code: "BRAND_LEAK",
        message: `Template's own demo brand "${leak.brand}" appears ${leak.count}x — swapTemplateBrandName should have caught this`,
      });
    }
    const skipped = skippedByPage[slug] ?? [];
    if (skipped.length > 0) {
      pipelineLog(`[pipeline] ${slug}: ${skipped.length} placement selector(s) skipped — markup drift, re-extract this template`);
      extraIssues.push({
        severity: "soft",
        code: "PLACEMENTS_SELECTOR_SKIPPED",
        message: `${skipped.length} placement selector(s) no longer resolved: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ", …" : ""}`,
      });
    }

    qaResults[slug] =
      extraIssues.length === 0
        ? result
        : { passed: result.passed && !extraIssues.some((i) => i.severity === "hard"), issues: [...result.issues, ...extraIssues] };
  }

  await fs.rm(stageDir, { recursive: true, force: true });

  pipelineLog(
    `[pipeline] Real-estate placements done — ${filled.llmFieldCount} copy + ${filled.exampleFieldCount} example fields, ~$${filled.costUsd.toFixed(4)}`
  );

  return { templateId, htmlPages, qaResults, files };
}
