import type {
  ContentBlock,
  GenerationResult,
  LayoutNode,
  PageSpec,
  PageSection,
  QAResult,
  SiteContext,
} from "../types.js";
import { expandBrief } from "../agents/expand-brief-agent.js";
import { planSite, getPagePlan } from "../agents/site-planner-agent.js";
import { generateDesignSystem } from "../agents/design-director-agent.js";
import { buildPageSections } from "../agents/section-builder-agent.js";
import { applyFixes, applyContentPatches, applySectionScopedFixes } from "../agents/fix-agent.js";
import { runVisionQa } from "../agents/vision-agent.js";
import { sanitizeContentBlocks } from "../media/enrich-content.js";
import { MediaRegistry } from "../media/media-registry.js";
import {
  assemblePageFromSections,
  initSiteContext,
  recordQaIteration,
} from "../site-context/assemble.js";
import { renderSite } from "../renderer/render.js";
import {
  runCodeQA,
  screenshotPage,
  screenshotPageDual,
  extractBlockManifest,
  closeQABrowser,
} from "../qa/code-qa.js";
import { generateCmsCollections } from "../cms/generate.js";
import { renderCmsPages } from "../cms/render.js";
import { stockImageUrl } from "../media/stock-images.js";
import fs from "fs/promises";
import path from "path";
import { llm } from "../llm/client.js";
import { timedStep } from "../util/timed.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { clearImageCache, activeImageProviders } from "../media/image-providers.js";
import { requireLlm } from "../util/llm-required.js";
import { persistDebugArtifacts } from "../util/debug-artifacts.js";

const MAX_QA_RETRIES = 3;

export interface GenerateSiteOptions {
  businessName?: string;
  businessBrief: string;
  onPreviewReady?: (result: Partial<GenerationResult>) => void;
  enableVisionPolish?: boolean;
}

export interface PagePipelineResult {
  spec: PageSpec;
  html: string;
  qa: QAResult;
  retries: number;
}

async function runPagePipeline(
  ctx: SiteContext,
  pageSlug: string,
  pageTitle: string,
  registry: MediaRegistry,
  enableVision: boolean
): Promise<PagePipelineResult> {
  const pagePlan = getPagePlan(ctx.sitePlan, pageSlug)!;
  let sections = await timedStep(pageSlug, "sections", () =>
    buildPageSections(ctx, pagePlan, registry)
  );
  ctx.pages[pageSlug] = {
    slug: pageSlug,
    title: pageTitle,
    navLabel: pagePlan.navLabel,
    sections,
  };
  ctx.mediaRegistry = registry.toJSON();

  let { content, layout } = assemblePageFromSections(sections);
  let html = "";
  let qa: QAResult = { passed: false, issues: [] };
  let retries = 0;

  const renderPage = () => {
    const single = [
      {
        slug: pageSlug,
        title: pageTitle,
        navLabel: pagePlan.navLabel,
        content,
        layout,
        sections,
      },
    ];
    return renderSite(
      ctx.businessName,
      ctx.expandedBrief.expandedBrief,
      ctx.designSystem,
      single,
      ctx.sitePlan.motionStyle
    )[pageSlug]!;
  };

  for (let attempt = 0; attempt <= MAX_QA_RETRIES; attempt++) {
    html = renderPage();

    qa = await timedStep(pageSlug, `QA${attempt > 0 ? ` retry ${attempt}` : ""}`, () =>
      runCodeQA(html, pageSlug)
    );

    let allIssues = [...qa.issues];

    if (!qa.passed || (enableVision && llm.supportsVision && attempt < MAX_QA_RETRIES)) {
      if (enableVision && llm.supportsVision) {
        const shots = await screenshotPageDual(html);
        const manifest = await extractBlockManifest(html);
        const vision = await timedStep(pageSlug, "vision QA", () =>
          runVisionQa(shots.desktop, pageSlug, manifest, ctx.designSystem, shots.mobile)
        );
        if (vision.issues.length > 0) {
          allIssues = [...allIssues, ...vision.issues];
          pipelineLog(`[pipeline] ${pageSlug}: vision found ${vision.issues.length} issue(s)`);
        }
      }
    }

    recordQaIteration(ctx, pageSlug, attempt, allIssues);

    const hardIssues = allIssues.filter((i) => i.severity === "hard");
    if (hardIssues.length === 0 && qa.passed) break;

    retries = attempt + 1;
    if (attempt >= MAX_QA_RETRIES) break;

    const sectionFix = await applySectionScopedFixes({
      ctx,
      pageSlug,
      sections,
      issues: allIssues,
    });

    if (sectionFix) {
      for (const patch of sectionFix.sections) {
        const idx = sections.findIndex((s) => s.id === patch.sectionId);
        if (idx === -1) continue;
        sections[idx] = {
          ...sections[idx]!,
          layout: patch.layout,
          blocks: applyContentPatches(sections[idx]!.blocks, patch.contentPatches),
        };
      }
      ({ content, layout } = assemblePageFromSections(sections));
      ctx.pages[pageSlug]!.sections = sections;
      pipelineLog(
        `[pipeline] ${pageSlug}: section-scoped fix (${sectionFix.sections.map((s) => s.sectionId).join(", ")})`
      );
      continue;
    }

    const fix = await timedStep(pageSlug, "fix", () =>
      applyFixes({
        ctx,
        pageSlug,
        layout,
        content,
        issues: allIssues,
      })
    );

    layout = fix.layout;
    content = applyContentPatches(content, fix.contentPatches);
    sections = rebuildSectionsFromFix(sections, content, layout);
    ctx.pages[pageSlug]!.sections = sections;

    pipelineLog(
      `[pipeline] ${pageSlug}: applied fix (${allIssues.map((i) => i.code).join(", ")})`
    );
  }

  return {
    spec: { slug: pageSlug, title: pageTitle, content, layout, sections },
    html,
    qa,
    retries,
  };
}

function rebuildSectionsFromFix(
  sections: PageSection[],
  content: ContentBlock[],
  layout: LayoutNode
): PageSection[] {
  const contentMap = new Map(content.map((b) => [b.id, b]));
  const sectionLayouts = extractSectionLayouts(layout);

  return sections.map((s, i) => ({
    ...s,
    blocks: s.blocks
      .map((b) => contentMap.get(b.id))
      .filter((b): b is ContentBlock => Boolean(b)),
    layout: sectionLayouts[i] ?? s.layout,
  }));
}

function extractSectionLayouts(layout: LayoutNode): LayoutNode[] {
  if (layout.type === "Stack") {
    return layout.children.filter((c): c is LayoutNode => typeof c !== "string");
  }
  return [layout];
}

export async function generateSite(options: GenerateSiteOptions): Promise<GenerationResult> {
  requireLlm("website generation");
  const start = Date.now();
  clearImageCache();
  pipelineLog(`[pipeline] Image providers: ${activeImageProviders().join(" → ")}`);

  const expanded = await expandBrief(options.businessBrief, options.businessName);
  pipelineLog("[pipeline] Expanding brief… done");

  const [sitePlan, designSystem] = await Promise.all([
    planSite(expanded),
    generateDesignSystem(expanded.businessName, expanded.expandedBrief, options.businessBrief),
  ]);
  pipelineLog(`[pipeline] Site plan + design system ready (${sitePlan.pages.length} pages)`);

  const ctx = initSiteContext(options.businessBrief, expanded, sitePlan, designSystem);
  ctx.cmsCollections = generateCmsCollections(expanded);
  for (const collection of ctx.cmsCollections) {
    for (const item of collection.items) {
      if (!item.imageQuery) continue;
      item.imageUrl = await stockImageUrl(
        item.imageQuery,
        `${collection.id}-${item.id}`,
        undefined,
        1200,
        800
      );
    }
  }
  const registry = new MediaRegistry();
  const enableVision = options.enableVisionPolish !== false;

  const pageResults =
    llm.provider === "groq" || llm.provider === "mistral"
      ? await runPagesSequentially(ctx, registry, enableVision)
      : await Promise.all(
          sitePlan.pages.map((p) =>
            runPagePipeline(ctx, p.slug, p.title, registry, enableVision)
          )
        );

  const pages: PageSpec[] = pageResults.map((r) => r.spec);
  const htmlPages: Record<string, string> = {};
  const qaResults: Record<string, QAResult> = {};

  const navPages = pages.map((p) => {
    const plan = getPagePlan(sitePlan, p.slug);
    return {
      slug: p.slug,
      title: p.title,
      navLabel: plan?.navLabel,
      content: p.content,
      layout: p.layout,
    };
  });

  const mergedHtml = renderSite(
    expanded.businessName,
    expanded.expandedBrief,
    designSystem,
    navPages,
    sitePlan.motionStyle
  );
  for (const [slug, html] of Object.entries(mergedHtml)) {
    htmlPages[slug] = html;
  }

  const cmsNav = pages.map((p) => {
    const plan = getPagePlan(sitePlan, p.slug);
    return { slug: p.slug, label: plan?.navLabel ?? p.title };
  });
  for (const collection of ctx.cmsCollections ?? []) {
    cmsNav.push({ slug: collection.slug, label: collection.name });
  }

  const cmsHtml = renderCmsPages(
    ctx.cmsCollections ?? [],
    expanded.businessName,
    expanded.expandedBrief,
    designSystem,
    cmsNav,
    sitePlan.motionStyle
  );
  Object.assign(htmlPages, cmsHtml);

  try {
    const cmsDir = path.resolve("output", "_cms");
    await fs.mkdir(cmsDir, { recursive: true });
    await fs.writeFile(
      path.join(cmsDir, `${expanded.businessName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`),
      JSON.stringify(ctx.cmsCollections, null, 2),
      "utf8"
    );
  } catch {
    // non-fatal
  }

  const site: GenerationResult["site"] = {
    businessName: expanded.businessName,
    businessBrief: options.businessBrief,
    expandedBrief: expanded,
    sitePlan,
    theme: designSystem,
    pages,
  };

  options.onPreviewReady?.({
    site,
    siteContext: ctx,
    htmlPages,
    timingMs: Date.now() - start,
  });

  for (const r of pageResults) {
    qaResults[r.spec.slug] = r.qa;
  }

  const timingMs = Date.now() - start;
  ctx.mediaRegistry = registry.toJSON();

  const screenshots: Record<string, string> = {};
  for (const slug of Object.keys(htmlPages)) {
    if (slug === "index") continue;
    screenshots[slug] = await screenshotPage(htmlPages[slug]!);
  }
  const debugDir = await persistDebugArtifacts(ctx, screenshots);
  if (debugDir) pipelineLog(`[pipeline] Debug artifacts → ${debugDir}`);

  await closeQABrowser();

  return {
    site,
    siteContext: ctx,
    htmlPages,
    qaResults,
    timingMs,
    visionPolish: {
      status: enableVision && llm.supportsVision ? "complete" : "skipped",
      issues: ctx.qaHistory.flatMap((h) => h.issues),
      appliedFixes: ctx.qaHistory.map(
        (h) => `${h.pageSlug} iter ${h.iteration}: ${h.issues.map((i) => i.code).join(", ") || "pass"}`
      ),
    },
  };
}

async function runPagesSequentially(
  ctx: SiteContext,
  registry: MediaRegistry,
  enableVision: boolean
): Promise<PagePipelineResult[]> {
  const results: PagePipelineResult[] = [];
  pipelineLog(
    `[pipeline] ${ctx.sitePlan.pages.length} pages planned: ${ctx.sitePlan.pages.map((p) => p.slug).join(", ")}`
  );
  for (const page of ctx.sitePlan.pages) {
    results.push(
      await runPagePipeline(ctx, page.slug, page.title, registry, enableVision)
    );
    pipelineLog(`[pipeline] ✓ ${page.slug} complete`);
  }
  return results;
}

export async function waitForVisionPolish(
  result: GenerationResult,
  _timeoutMs = 60_000
): Promise<GenerationResult> {
  return result;
}

export function summarizeGeneration(result: GenerationResult): string {
  const blockCount = result.site.pages.reduce((n, p) => n + p.content.length, 0);
  const lines = [
    `Generated "${result.site.businessName}" in ${(result.timingMs / 1000).toFixed(1)}s`,
    `Strategy: ${result.site.sitePlan.compositionStrategy}`,
    `Design: ${result.site.theme.vertical} · ${result.site.theme.mood}`,
    `Pages (${result.site.pages.length}): ${result.site.pages.map((p) => `${p.slug} (${p.content.length} blocks, ${p.sections?.length ?? 0} sections)`).join(", ")}`,
    `Total content blocks: ${blockCount}`,
  ];

  for (const [slug, qa] of Object.entries(result.qaResults)) {
    const status = qa.passed ? "PASS" : "FAIL";
    lines.push(`  QA [${slug}]: ${status} (${qa.issues.length} issues)`);
    if (!qa.passed) {
      for (const issue of qa.issues.filter((i) => i.severity === "hard")) {
        lines.push(`    ↳ ${issue.code}: ${issue.message}`);
      }
    }
  }

  if (result.visionPolish) {
    lines.push(`Vision polish: ${result.visionPolish.status}`);
  }

  return lines.join("\n");
}
