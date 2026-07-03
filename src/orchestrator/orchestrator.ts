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
import { refineDesignSystem } from "../agents/design-refine-agent.js";
import { skipSecondDesignRefine, isQualityPipeline } from "../llm/pipeline-speed.js";
import { runDesignQA } from "../qa/react-qa.js";
import { buildPageSections } from "../agents/section-builder-agent.js";
import { applyFixes, applyContentPatches, applySectionScopedFixes } from "../agents/fix-agent.js";
import { runVisionQa } from "../agents/vision-agent.js";
import { MediaRegistry } from "../media/media-registry.js";
import { clearImageCache, activeImageProviders } from "../media/image-providers.js";
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
  screenshotUrlDual,
  extractBlockManifest,
  closeQABrowser,
} from "../qa/code-qa.js";
import { startReactPreviewServer, stopReactPreviewServer } from "../react-codegen/react-preview-server.js";
import { generateCmsCollections } from "../cms/generate.js";
import { renderCmsPages } from "../cms/render.js";
import { stockImageUrl } from "../media/stock-images.js";
import fs from "fs/promises";
import path from "path";
import { llm } from "../llm/client.js";
import { timedStep } from "../util/timed.js";
import { pipelineLog, pipelineStructured, setPipelineContext, clearPipelineContext } from "../util/pipeline-log.js";
import { resetFallbackTracker, getFallbackSummary, totalFallbacks } from "../util/fallback-tracker.js";
import { summarizeQaResults, hasHardQaFailures } from "../qa/qa-summary.js";
import { requireLlm } from "../util/llm-required.js";
import { persistDebugArtifacts } from "../util/debug-artifacts.js";
import { getOutputMode, runReactPipeline } from "./react-pipeline.js";
import { applyHtmlVisionRetry } from "./html-vision-retry.js";
import { renderReactPreviewFallback } from "../react-codegen/preview-fallback.js";
import { inferVerticalProfile } from "../design/vertical-profiles.js";
import {
  autoPublishEnabled,
  publishSite,
  saveSiteAfterGeneration,
} from "../hosting/publish-site.js";
import { cleanupAfterPublish } from "../hosting/cleanup-artifacts.js";
import { siteSlugFromName } from "../hosting/slug.js";
import { hashString } from "../design/variation.js";

const MAX_QA_RETRIES = 3;

export interface GenerateSiteOptions {
  businessName?: string;
  businessBrief: string;
  onPreviewReady?: (result: Partial<GenerationResult>) => void;
  enableVisionPolish?: boolean;
  variationSeed?: number;
  jobId?: string;
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
  let htmlVisionRetried = false;

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
    let visionHard: QAResult["issues"] = [];

    if (!qa.passed || (enableVision && llm.supportsVision && attempt < MAX_QA_RETRIES)) {
      if (enableVision && llm.supportsVision) {
        const shots = await screenshotPageDual(html);
        const manifest = await extractBlockManifest(html);
        const vision = await timedStep(pageSlug, "vision QA", () =>
          runVisionQa(shots.desktop, pageSlug, manifest, ctx.designSystem, shots.mobile)
        );
        if (vision.issues.length > 0) {
          allIssues = [...allIssues, ...vision.issues];
          visionHard = vision.issues.filter((i) => i.severity === "hard");
          pipelineLog(`[pipeline] ${pageSlug}: vision found ${vision.issues.length} issue(s)`);
        }
      }
    }

    recordQaIteration(ctx, pageSlug, attempt, allIssues);

    const hardIssues = allIssues.filter((i) => i.severity === "hard");
    if (hardIssues.length === 0 && qa.passed) break;

    retries = attempt + 1;
    if (attempt >= MAX_QA_RETRIES) break;

    if (!htmlVisionRetried && enableVision && visionHard.length > 0) {
      const applied = await applyHtmlVisionRetry(ctx, visionHard, pageSlug);
      if (applied) {
        htmlVisionRetried = true;
        continue;
      }
    }

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
  llm.resetTokenUsage();
  resetFallbackTracker();
  setPipelineContext({
    jobId: options.jobId,
    seed: options.variationSeed,
  });
  clearImageCache();
  pipelineLog(`[pipeline] Image providers: ${activeImageProviders().join(" → ")}`);

  let buildSucceeded: boolean | undefined;
  let reactProjectPath: string | undefined;
  let reactStaticOutPath: string | undefined;
  let siteSlug: string | undefined;
  let publishedUrl: string | undefined;
  let outBytes: number | undefined;
  let htmlPages: Record<string, string> = {};
  let qaResults: Record<string, QAResult> = {};
  let outputMode: "react" | "html" = getOutputMode();
  let pageResults: PagePipelineResult[] = [];

  try {

  const expanded = await expandBrief(options.businessBrief, options.businessName);
  pipelineLog("[pipeline] Expanding brief… done");

  const variationSeed =
    options.variationSeed ??
    (isQualityPipeline()
      ? hashString(crypto.randomUUID())
      : Date.now());
  pipelineLog("[pipeline] Planning site structure…");
  const sitePlan = await planSite(expanded);
  pipelineLog(`[pipeline] Site plan ready (${sitePlan.pages.length} pages)`);
  const verticalProfile = inferVerticalProfile(expanded, sitePlan);

  pipelineLog("[pipeline] Generating design system…");
  let designSystem = await generateDesignSystem(
    expanded.businessName,
    expanded.expandedBrief,
    options.businessBrief,
    expanded,
    { sitePlan, verticalProfile, variationSeed }
  );
  const profileCoherence = {
    profileId: verticalProfile.profileId,
    pageTone: verticalProfile.pageTone,
    navTreatment: verticalProfile.navTreatment,
    motionPreset: verticalProfile.motionPreset,
  };
  designSystem = await refineDesignSystem(
    expanded.businessName,
    expanded.expandedBrief,
    designSystem,
    profileCoherence
  );
  let designQa = runDesignQA(designSystem);
  if (!designQa.passed && !skipSecondDesignRefine()) {
    pipelineLog(
      `[pipeline] Design token QA failed (${designQa.issues.map((i) => i.message).join("; ")}); refining once more…`
    );
    designSystem = await refineDesignSystem(
      expanded.businessName,
      expanded.expandedBrief,
      designSystem,
      profileCoherence
    );
    designQa = runDesignQA(designSystem);
    if (!designQa.passed) {
      pipelineLog(
        `[pipeline] Design token QA still failing: ${designQa.issues.map((i) => i.message).join("; ")}`
      );
    }
  } else if (!designQa.passed && skipSecondDesignRefine()) {
    pipelineLog(
      `[pipeline] Design token QA issues (fast mode, skipping second refine): ${designQa.issues.map((i) => i.message).join("; ")}`
    );
  }
  pipelineLog(`[pipeline] Site plan + design system ready (${sitePlan.pages.length} pages)`);

  const ctx = initSiteContext(options.businessBrief, expanded, sitePlan, designSystem);
  ctx.verticalProfile = {
    profileId: verticalProfile.profileId,
    pageTone: verticalProfile.pageTone,
    heroBias: verticalProfile.heroBias,
    blueprintFamily: verticalProfile.blueprintFamily,
    grainOverlay: verticalProfile.grainOverlay,
    industryFamily: verticalProfile.industryFamily,
    copyHints: verticalProfile.copyHints,
    imageHints: verticalProfile.imageHints,
    ctaPatterns: verticalProfile.ctaPatterns,
    proofPatterns: verticalProfile.proofPatterns,
  };
  ctx.variationSeed = variationSeed;
  setPipelineContext({
    jobId: options.jobId,
    profileId: verticalProfile.profileId,
    seed: variationSeed,
  });
  pipelineLog(
    `[pipeline] Vertical profile: ${verticalProfile.profileId} (${verticalProfile.pageTone}) — seed ${variationSeed}`
  );
  ctx.cmsCollections = generateCmsCollections(expanded);
  ctx.reactPages = {};
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

  if (outputMode === "react") {
    const reactOut = path.resolve("output", "_playground-react");
    pipelineLog("[pipeline] Output mode: React (Framer-parity)");
    const reactResult = await runReactPipeline(ctx, registry, reactOut, { previewBasePath: "/preview" });
    reactProjectPath = reactResult.projectPath;
    buildSucceeded = reactResult.buildSucceeded;
    if (reactResult.buildSucceeded) {
      reactStaticOutPath = reactResult.previewPath;
      if (reactProjectPath && reactStaticOutPath) {
        const stats = await cleanupAfterPublish(reactProjectPath, reactStaticOutPath);
        outBytes = stats.bytes;
      }
    }
    ctx.reactPages = reactResult.reactPages;
    qaResults = reactResult.qaResults;

    for (const [slug, page] of Object.entries(reactResult.reactPages)) {
      ctx.pages[slug] = {
        slug,
        title: page.title,
        navLabel: page.navLabel,
        sections: [],
      };
    }

    try {
      if (reactResult.buildSucceeded) {
        const outDir = reactResult.previewPath;
        for (const slug of Object.keys(reactResult.reactPages)) {
          const file =
            slug === "home"
              ? path.join(outDir, "index.html")
              : path.join(outDir, slug, "index.html");
          htmlPages[slug] = await fs.readFile(file, "utf8");
        }
      } else {
        throw new Error("build failed");
      }
    } catch {
      pipelineLog("[pipeline] React static export unavailable — using styled HTML preview fallback");
      htmlPages = renderReactPreviewFallback(ctx, reactResult.reactPages);
    }

    pageResults = sitePlan.pages.map((p) => ({
      spec: {
        slug: p.slug,
        title: p.title,
        content: [],
        layout: { type: "Stack", children: [] },
        sections: [],
      },
      html: htmlPages[p.slug] ?? "",
      qa: qaResults[p.slug] ?? {
        passed: false,
        issues: [
          {
            severity: "hard",
            code: "MISSING_PAGE_QA",
            message: `No QA result for page ${p.slug}`,
          },
        ],
      },
      retries: 0,
    }));
  } else {
    pageResults =
      llm.provider === "groq" || llm.provider === "mistral" || llm.provider === "openrouter"
        ? await runPagesSequentially(ctx, registry, enableVision)
        : await Promise.all(
            sitePlan.pages.map((p) =>
              runPagePipeline(ctx, p.slug, p.title, registry, enableVision)
            )
          );

    const pages: PageSpec[] = pageResults.map((r) => r.spec);

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
    htmlPages = { ...mergedHtml };

    for (const r of pageResults) {
      qaResults[r.spec.slug] = r.qa;
    }
  }

  const pages: PageSpec[] = pageResults.map((r) => r.spec);

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
  if (outputMode !== "react") {
    Object.assign(htmlPages, cmsHtml);
  }

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
    reactProjectPath,
    reactStaticOutPath,
    outputMode,
  });

  if (outputMode === "html") {
    for (const r of pageResults) {
      qaResults[r.spec.slug] = r.qa;
    }
  }

  const timingMs = Date.now() - start;
  ctx.mediaRegistry = registry.toJSON();

  const screenshots: Record<string, string> = {};
  const slugsToShoot = Object.keys(htmlPages).filter((slug) => slug !== "index");
  if (outputMode === "react" && buildSucceeded && reactProjectPath) {
    // The React static export references CSS/JS via root-relative paths that only resolve
    // against a real served origin — page.setContent() on the raw HTML (screenshotPage) has no
    // base URL and silently renders unstyled, same root cause as the vision-QA screenshot bug.
    try {
      const previewUrl = await startReactPreviewServer(reactProjectPath);
      try {
        for (const slug of slugsToShoot) {
          const base = previewUrl.endsWith("/") ? previewUrl : `${previewUrl}/`;
          const url = slug === "home" ? base : `${base}${slug}/`;
          screenshots[slug] = (await screenshotUrlDual(url)).desktop;
        }
      } finally {
        stopReactPreviewServer();
      }
    } catch (err) {
      pipelineLog(
        `[pipeline] Debug screenshot server failed (${err instanceof Error ? err.message : String(err)}) — skipping debug screenshots`
      );
    }
  } else {
    for (const slug of slugsToShoot) {
      screenshots[slug] = await screenshotPage(htmlPages[slug]!);
    }
  }
  const debugDir = await persistDebugArtifacts(ctx, screenshots);
  if (debugDir) pipelineLog(`[pipeline] Debug artifacts → ${debugDir}`);

  const qaSummary = summarizeQaResults(qaResults);
  const hardPipelineQa = hasHardQaFailures(qaResults);
  const fallbackSummary = getFallbackSummary();
  const degraded =
    (outputMode === "react" && buildSucceeded === false) ||
    hardPipelineQa ||
    !qaSummary.passed ||
    (isQualityPipeline() ? totalFallbacks() > 0 : totalFallbacks() > 8);

  const estimatedCostUsd = llm.getEstimatedCostUsd();
  const costCap = llm.getCostCapUsd();
  pipelineLog(
    `[pipeline] LLM cost estimate: ~$${estimatedCostUsd.toFixed(4)}${costCap ? ` (cap $${costCap})` : ""} — ${llm.getTokenUsage().total} tokens`
  );

  const previewSource: GenerationResult["previewSource"] =
    outputMode === "react"
      ? buildSucceeded
        ? reactProjectPath
          ? "live-server"
          : "next-static"
        : "html-fallback"
      : "html-fallback";

  pipelineStructured({
    step: "complete",
    durationMs: timingMs,
    message: degraded ? "generation degraded" : "generation succeeded",
    tokens: llm.getTokenUsage(),
    estimatedCostUsd,
    costCapUsd: costCap ?? undefined,
    fallbacks: Object.keys(fallbackSummary).length > 0 ? fallbackSummary : undefined,
  });

  if (Object.keys(fallbackSummary).length > 0) {
    pipelineLog(
      `[pipeline] Agent fallbacks: ${Object.entries(fallbackSummary)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`
    );
  }

  siteSlug = siteSlugFromName(expanded.businessName);
  try {
    const saved = await saveSiteAfterGeneration(ctx, siteSlug);
    if (saved) siteSlug = saved;
  } catch (err) {
    pipelineLog(
      `[hosting] Site context save skipped: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (
    autoPublishEnabled() &&
    outputMode === "react" &&
    buildSucceeded &&
    reactStaticOutPath &&
    reactProjectPath
  ) {
    try {
      const published = await publishSite({
        ctx,
        outPath: reactStaticOutPath,
        projectPath: reactProjectPath,
        slug: siteSlug,
      });
      publishedUrl = published.publishedUrl;
      outBytes = published.outBytes;
      siteSlug = published.slug;
    } catch (err) {
      pipelineLog(
        `[hosting] Auto-publish failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return {
    site,
    siteContext: ctx,
    htmlPages,
    qaResults,
    timingMs,
    reactProjectPath,
    reactStaticOutPath,
    outputMode,
    buildSucceeded,
    degraded,
    previewSource,
    qaSummary,
    jobId: options.jobId,
    variationSeed: ctx.variationSeed,
    verticalProfileId: ctx.verticalProfile?.profileId,
    siteSlug,
    publishedUrl,
    outBytes,
    visionPolish: {
      status: enableVision && llm.supportsVision ? "complete" : "skipped",
      issues: ctx.qaHistory.flatMap((h) => h.issues),
      appliedFixes: ctx.qaHistory.map(
        (h) => `${h.pageSlug} iter ${h.iteration}: ${h.issues.map((i) => i.code).join(", ") || "pass"}`
      ),
    },
  };
  } finally {
    await closeQABrowser();
    clearPipelineContext();
  }
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
  const reactSectionCount = result.siteContext.reactPages
    ? Object.values(result.siteContext.reactPages).reduce((n, p) => n + p.sections.length, 0)
    : 0;
  const blockCount = result.site.pages.reduce((n, p) => n + p.content.length, 0);
  const lines = [
    `Generated "${result.site.businessName}" in ${(result.timingMs / 1000).toFixed(1)}s`,
    `Output: ${result.outputMode ?? "html"}`,
    `Strategy: ${result.site.sitePlan.compositionStrategy}`,
    `Design: ${result.site.theme.vertical} · ${result.site.theme.mood}`,
  ];

  if (result.outputMode === "react") {
    lines.push(
      `React sections: ${reactSectionCount}`,
      `Pages: ${result.site.pages.map((p) => p.slug).join(", ")}`
    );
  } else {
    lines.push(
      `Pages (${result.site.pages.length}): ${result.site.pages.map((p) => `${p.slug} (${p.content.length} blocks, ${p.sections?.length ?? 0} sections)`).join(", ")}`,
      `Total content blocks: ${blockCount}`
    );
  }

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
