import type {
  ContentBlock,
  GenerationResult,
  LayoutNode,
  PageSpec,
  PageSection,
  QAResult,
  SiteContext,
} from "../types.js";
import { expandBrief, expandBriefFromInput } from "../agents/expand-brief-agent.js";
import { planSite, getPagePlan } from "../agents/site-planner-agent.js";
import { generateDesignSystem } from "../agents/design-director-agent.js";
import { refineDesignSystem } from "../agents/design-refine-agent.js";
import {
  skipSecondDesignRefine,
  isQualityPipeline,
  useSkinFillPipeline,
  useVerbatimTemplatePipeline,
  visionQaEnabled,
  finalVisionMaxRedos,
} from "../llm/pipeline-speed.js";
import { judgeFinalScreenshots, isStrictlyBetter, type FinalVisionVerdict } from "./final-vision-gate.js";
import { runDesignQA } from "../qa/react-qa.js";
import { buildPageSections } from "../agents/section-builder-agent.js";
import { applyFixes, applyContentPatches, applySectionScopedFixes } from "../agents/fix-agent.js";
import { runVisionQa } from "../agents/vision-agent.js";
import { MediaRegistry } from "../media/media-registry.js";
import { clearImageCache, activeImageProviders } from "../media/image-providers.js";
import type { UserMediaLibrary } from "../media/user-media.js";
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
  type BlockManifestEntry,
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
import { runSkinHtmlPipeline } from "./skin-html-pipeline.js";
import { runVerbatimTemplatePipeline, stageSite } from "./verbatim-template-pipeline.js";
import { pageFileName } from "../templates/compose.js";
import { pathToFileURL } from "node:url";
import type { VerbatimSiteState } from "../templates/revise.js";
import { templateStore } from "../templates/store.js";
import { VERBATIM_PLACEHOLDER_THEME } from "../templates/theme-placeholder.js";
import type { FileCopy } from "../templates/compose.js";
import { applyHtmlVisionRetry } from "./html-vision-retry.js";
import { inferVerticalProfile } from "../design/vertical-profiles.js";
import { pickSiteSkin } from "../skins/picker.js";
import { applySkinToContext, emptySitePlan, themeFromSkin } from "../skins/theme.js";
import type { SiteSkin } from "../skins/schema.js";
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
  consumerId?: string;
  userMedia?: UserMediaLibrary;
}

export interface PagePipelineResult {
  spec: PageSpec;
  html: string;
  qa: QAResult;
  retries: number;
}

/**
 * Screenshots every verbatim-template page with a real `file://` base — the same staging
 * `runVerbatimTemplatePipeline`'s own `runCodeQA` call already uses — instead of `screenshotPage`'s
 * bare `page.setContent()`, which never resolves this output's external stylesheets or local
 * `_tpl-assets/...` images (confirmed live: every debug screenshot and the final vision-QA verdict
 * for the verbatim path were rendering, and judging, a page with zero CSS and zero images loaded).
 * Cleans up its temp staging directory itself — this is the only consumer of it.
 */
async function screenshotVerbatimPages(
  htmlPages: Record<string, string>,
  files: FileCopy[]
): Promise<Record<string, string>> {
  const stageDir = await stageSite(htmlPages, files);
  try {
    const shots: Record<string, string> = {};
    for (const slug of Object.keys(htmlPages).filter((s) => s !== "index")) {
      const pageUrl = pathToFileURL(path.join(stageDir, pageFileName(slug))).href;
      shots[slug] = await screenshotPage(htmlPages[slug]!, { pageUrl });
    }
    return shots;
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
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

/** Shared by the verbatim branch and its final-visual-QA redo — one page-result list shape built
 *  straight from a pipeline's `htmlPages`/`qaResults`, so a redo doesn't have to duplicate this
 *  mapping inline a second time. */
function pageResultsFromHtmlPages(
  htmlPages: Record<string, string>,
  qaResults: Record<string, QAResult>,
  ctx: SiteContext
): PagePipelineResult[] {
  return Object.keys(htmlPages).map((slug) => ({
    spec: {
      slug,
      title: ctx.pages[slug]?.title ?? slug,
      content: [],
      layout: { type: "Stack", children: [] },
      sections: [],
    },
    html: htmlPages[slug] ?? "",
    qa: qaResults[slug] ?? {
      passed: false,
      issues: [{ severity: "hard" as const, code: "MISSING_PAGE_QA", message: `No QA result for page ${slug}` }],
    },
    retries: 0,
  }));
}

/** Verbatim mode needs an ingested corpus; without one the run falls back to the skin pipeline. */
async function hasIngestedTemplates(): Promise<boolean> {
  try {
    const index = await templateStore().index();
    return index.sections.length > 0;
  } catch {
    return false;
  }
}

export async function generateSite(options: GenerateSiteOptions): Promise<GenerationResult> {
  const outputMode: "react" | "html" = getOutputMode();
  // Verbatim mode owns the default path, but only once templates have actually been ingested —
  // an empty cache falls through to the skin pipeline instead of failing the run.
  const verbatim = useVerbatimTemplatePipeline() && outputMode !== "react" && (await hasIngestedTemplates());
  const skinFill = !verbatim && useSkinFillPipeline();
  if (!skinFill && !verbatim) requireLlm("website generation");
  const start = Date.now();
  llm.resetTokenUsage();
  resetFallbackTracker();
  setPipelineContext({
    jobId: options.jobId,
    seed: options.variationSeed,
  });
  clearImageCache();
  pipelineLog(`[pipeline] Image providers: ${activeImageProviders().join(" → ")}`);
  pipelineLog(`[pipeline] LLM: ${llm.provider ?? "none"}`);

  let buildSucceeded: boolean | undefined;
  let reactProjectPath: string | undefined;
  let reactStaticOutPath: string | undefined;
  let siteSlug: string | undefined;
  let publishedUrl: string | undefined;
  let outBytes: number | undefined;
  let htmlPages: Record<string, string> = {};
  let qaResults: Record<string, QAResult> = {};
  let pageResults: PagePipelineResult[] = [];
  let verbatimFiles: FileCopy[] = [];
  let verbatimTemplateIds: string[] = [];
  let verbatimState: VerbatimSiteState | undefined;
  let verbatimAnchorTemplateId: string | undefined;
  let verbatimBlockManifests: Record<string, BlockManifestEntry[]> = {};
  let finalVision: GenerationResult["finalVision"];

  try {

  const expanded =
    skinFill || verbatim
      ? expandBriefFromInput(options.businessBrief, options.businessName)
      : await expandBrief(options.businessBrief, options.businessName);
  pipelineLog(
    skinFill || verbatim
      ? "[pipeline] Brief slotted from your input (no LLM rewrite)"
      : "[pipeline] Expanding brief… done"
  );

  const variationSeed =
    options.variationSeed ??
    (isQualityPipeline()
      ? hashString(crypto.randomUUID())
      : Date.now());

  let sitePlan;
  let verticalProfile;
  let designSystem;
  let pickedSkin: SiteSkin | undefined;

  if (verbatim) {
    // No skin, no design council, no token pack: the look comes from each source template's own
    // (scoped, recolored) stylesheet, so `designSystem` is only carried for context metadata.
    pipelineLog("[pipeline] Verbatim template mode — no skin, no design system");
    sitePlan = emptySitePlan();
    designSystem = VERBATIM_PLACEHOLDER_THEME;
  } else if (skinFill) {
    pipelineLog("[pipeline] Picking site skin…");
    pickedSkin = await pickSiteSkin({
      brief: expanded,
      consumerId: options.consumerId,
      variationSeed,
    });
    sitePlan = emptySitePlan();
    designSystem = themeFromSkin(pickedSkin, expanded);
    pipelineLog(
      `[pipeline] Skin ${pickedSkin.id} (${pickedSkin.name}) · ${pickedSkin.visualFamily} · nav ${pickedSkin.chrome.navShape} · footer ${pickedSkin.chrome.footerLayout}`
    );
  } else {
    pipelineLog("[pipeline] Planning site structure…");
    sitePlan = await planSite(expanded);
    pipelineLog(`[pipeline] Site plan ready (${sitePlan.pages.length} pages)`);
    verticalProfile = inferVerticalProfile(expanded, sitePlan);

    pipelineLog("[pipeline] Generating design system…");
    designSystem = await generateDesignSystem(
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
      navShape: verticalProfile.navShape,
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
  }

  const ctx = initSiteContext(options.businessBrief, expanded, sitePlan, designSystem);
  if (pickedSkin) {
    applySkinToContext(ctx, pickedSkin);
    sitePlan = ctx.sitePlan;
    designSystem = ctx.designSystem;
    verticalProfile = ctx.verticalProfile!;
  } else if (verbatim) {
    ctx.verticalProfile = {
      profileId: "luxury-dark",
      pageTone: "dark",
      heroBias: "verbatim",
      blueprintFamily: "verbatim",
      grainOverlay: false,
      industryFamily: "verbatim",
    };
  } else {
    if (!verticalProfile) {
      throw new Error("Design system path requires a vertical profile");
    }
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
  }
  ctx.variationSeed = variationSeed;
  ctx.consumerId = options.consumerId;
  if (options.userMedia) {
    const snap = options.userMedia.snapshot();
    ctx.logoSrc = snap.logoSrc;
    ctx.userMediaFiles = snap.files;
    pipelineLog(
      `[pipeline] User media: ${options.userMedia.logo ? "logo + " : ""}${options.userMedia.photos.length} photo(s); remaining slots from ${activeImageProviders().join(" → ")}`
    );
  }
  setPipelineContext({
    jobId: options.jobId,
    profileId: ctx.verticalProfile?.profileId,
    seed: variationSeed,
  });
  pipelineLog(
    pickedSkin
      ? `[pipeline] Skin ${pickedSkin.id} look (${ctx.designSystem.fontHeading}, ${ctx.designSystem.pageTone}) — seed ${variationSeed}`
      : `[pipeline] Vertical profile: ${ctx.verticalProfile?.profileId} (${ctx.verticalProfile?.pageTone}) — seed ${variationSeed}`
  );
  ctx.cmsCollections = skinFill || verbatim ? [] : generateCmsCollections(expanded);
  ctx.reactPages = {};
  if (!skinFill && !verbatim) {
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
  }
  const registry = new MediaRegistry();
  registry.userMedia = options.userMedia;
  const enableVision = options.enableVisionPolish !== false;

  if (verbatim) {
    const verbatimResult = await runVerbatimTemplatePipeline(ctx, registry, {
      variationSeed,
      ...(options.consumerId ? { consumerId: options.consumerId } : {}),
    });
    htmlPages = verbatimResult.htmlPages;
    qaResults = verbatimResult.qaResults;
    verbatimFiles = verbatimResult.files;
    verbatimTemplateIds = verbatimResult.templateIds;
    verbatimState = verbatimResult.state;
    verbatimAnchorTemplateId = verbatimResult.anchorTemplateId;
    verbatimBlockManifests = verbatimResult.blockManifests;
    pageResults = pageResultsFromHtmlPages(htmlPages, qaResults, ctx);
  } else if (skinFill && outputMode !== "react") {
    if (!pickedSkin) throw new Error("HTML skin path requires a picked site skin");
    const htmlResult = await runSkinHtmlPipeline(ctx, pickedSkin, registry);
    htmlPages = htmlResult.htmlPages;
    qaResults = htmlResult.qaResults;
    ctx.reactPages = htmlResult.reactPages;
    pageResults = Object.keys(htmlPages).map((slug) => ({
      spec: {
        slug,
        title: htmlResult.reactPages[slug]?.title ?? slug,
        content: [],
        layout: { type: "Stack", children: [] },
        sections: [],
      },
      html: htmlPages[slug] ?? "",
      qa: qaResults[slug] ?? {
        passed: false,
        issues: [{ severity: "hard" as const, code: "MISSING_PAGE_QA", message: `No QA result for page ${slug}` }],
      },
      retries: 0,
    }));
  } else if (outputMode === "react") {
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

    if (!reactResult.buildSucceeded) {
      throw new Error(
        `React site build failed after automatic repair attempts were exhausted: ${
          reactResult.buildError ?? "unknown build error"
        }`
      );
    }
    const outDir = reactResult.previewPath;
    for (const slug of Object.keys(reactResult.reactPages)) {
      const file =
        slug === "home" ? path.join(outDir, "index.html") : path.join(outDir, slug, "index.html");
      htmlPages[slug] = await fs.readFile(file, "utf8");
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
  if (outputMode !== "react" && !skinFill) {
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
  } else if (!process.env.VITEST && verbatim) {
    // See `screenshotVerbatimPages` — this output has external stylesheets and local images that
    // never resolve without a real base URL.
    Object.assign(screenshots, await screenshotVerbatimPages(htmlPages, verbatimFiles));
  } else if (!process.env.VITEST) {
    for (const slug of slugsToShoot) {
      screenshots[slug] = await screenshotPage(htmlPages[slug]!);
    }
  }
  const debugDir = await persistDebugArtifacts(ctx, screenshots);
  if (debugDir) pipelineLog(`[pipeline] Debug artifacts → ${debugDir}`);

  // The one true final visual QA gate: judges the already-rendered, already-CMS-merged pages
  // every mode produces (`screenshots`, captured just above), before anything is saved or
  // published. Every other vision-QA mechanism in this codebase either runs mid-pipeline on one
  // page in isolation (`applyHtmlVisionRetry`, inside `runPagePipeline`) or finishes entirely
  // inside the react-codegen branch before this function resumes — neither ever sees the final,
  // whole site. `screenshots` is empty (and this is skipped) whenever the screenshot pass itself
  // didn't run — `VITEST`, or the react preview server failing to start — so an unavailable
  // screenshot never blocks a generation that would otherwise have shipped.
  if (visionQaEnabled() && llm.supportsVision && Object.keys(screenshots).length > 0) {
    const verdict = await judgeFinalScreenshots(screenshots, designSystem, verbatim ? verbatimBlockManifests : undefined);
    let redoAttempted = false;
    let redoImproved = false;
    let effectiveVerdict: FinalVisionVerdict = verdict;
    // Deterministic layout QA (`code-qa.ts`) runs on the verbatim path independently of vision, and
    // catches defects (a cross-template width mismatch, real overflow) the vision judge might miss
    // or that vision is disabled/unavailable for. A hard code-qa issue on this path is as much a
    // reason to redo as a failing vision verdict — checked here, alongside vision, rather than only
    // ever surfacing as the `degraded` flag at the very end with no chance to self-correct.
    const codeQaHardBefore = summarizeQaResults(qaResults).hardCount;

    if ((!verdict.passed || (verbatim && codeQaHardBefore > 0)) && finalVisionMaxRedos() > 0) {
      const baseSeed = typeof variationSeed === "number" ? variationSeed : hashString(String(variationSeed));

      if (verbatim) {
        redoAttempted = true;
        pipelineLog(
          `[pipeline] Final QA: ${verdict.hardIssueCount} vision + ${codeQaHardBefore} code hard issue(s) across ${Object.keys(verdict.perPage).length} page(s) — redoing template selection…`
        );
        try {
          const redoResult = await runVerbatimTemplatePipeline(ctx, registry, {
            variationSeed: baseSeed + 1,
            ...(options.consumerId ? { consumerId: options.consumerId } : {}),
            ...(verbatimAnchorTemplateId ? { excludeAnchorTemplateIds: [verbatimAnchorTemplateId] } : {}),
          });
          const redoScreenshots = await screenshotVerbatimPages(redoResult.htmlPages, redoResult.files);
          const redoVerdict = await judgeFinalScreenshots(redoScreenshots, designSystem, redoResult.blockManifests);
          const redoCodeQaHard = summarizeQaResults(redoResult.qaResults).hardCount;
          // Compared combined (vision + code-qa) so a redo triggered by a code-qa-only failure
          // (vision may already read `passed` on both attempts, 0 == 0) is judged on the metric that
          // actually motivated it, not silently discarded as "no improvement" by a metric it never
          // meant to move.
          const improved = redoVerdict.hardIssueCount + redoCodeQaHard < verdict.hardIssueCount + codeQaHardBefore;
          if (improved) {
            redoImproved = true;
            effectiveVerdict = redoVerdict;
            htmlPages = redoResult.htmlPages;
            qaResults = redoResult.qaResults;
            verbatimFiles = redoResult.files;
            verbatimTemplateIds = redoResult.templateIds;
            verbatimState = redoResult.state;
            verbatimAnchorTemplateId = redoResult.anchorTemplateId;
            verbatimBlockManifests = redoResult.blockManifests;
            pageResults = pageResultsFromHtmlPages(htmlPages, qaResults, ctx);
            Object.assign(screenshots, redoScreenshots);
            const redoDebugDir = await persistDebugArtifacts(ctx, screenshots);
            if (redoDebugDir) pipelineLog(`[pipeline] Debug artifacts (redo) → ${redoDebugDir}`);
            pipelineLog(
              `[pipeline] Final QA redo improved the result: ${verdict.hardIssueCount + codeQaHardBefore} → ${redoVerdict.hardIssueCount + redoCodeQaHard} combined hard issue(s)`
            );
          } else {
            pipelineLog(
              `[pipeline] Final QA redo did not improve (still ${redoVerdict.hardIssueCount + redoCodeQaHard} combined hard issue(s)) — keeping the original attempt`
            );
          }
        } catch (err) {
          pipelineLog(
            `[pipeline] Final visual QA redo failed: ${err instanceof Error ? err.message : String(err)} — keeping the original attempt`
          );
        }
      } else if (skinFill && outputMode !== "react" && pickedSkin) {
        redoAttempted = true;
        pipelineLog(
          `[pipeline] Final visual QA: ${verdict.hardIssueCount} hard issue(s) across ${Object.keys(verdict.perPage).length} page(s) — reseeding skin selection…`
        );
        try {
          const redoSeed = baseSeed + 1;
          const redoSkin = await pickSiteSkin({
            brief: expanded,
            ...(options.consumerId ? { consumerId: options.consumerId } : {}),
            variationSeed: redoSeed,
          });
          applySkinToContext(ctx, redoSkin);
          ctx.variationSeed = redoSeed;
          const redoHtmlResult = await runSkinHtmlPipeline(ctx, redoSkin, registry);
          const redoScreenshots: Record<string, string> = {};
          for (const slug of Object.keys(redoHtmlResult.htmlPages).filter((s) => s !== "index")) {
            redoScreenshots[slug] = await screenshotPage(redoHtmlResult.htmlPages[slug]!);
          }
          const redoVerdict = await judgeFinalScreenshots(redoScreenshots, ctx.designSystem);
          if (isStrictlyBetter(redoVerdict, verdict)) {
            redoImproved = true;
            effectiveVerdict = redoVerdict;
            pickedSkin = redoSkin;
            designSystem = ctx.designSystem;
            htmlPages = redoHtmlResult.htmlPages;
            qaResults = redoHtmlResult.qaResults;
            pageResults = pageResultsFromHtmlPages(htmlPages, qaResults, ctx);
            Object.assign(screenshots, redoScreenshots);
            const redoDebugDir = await persistDebugArtifacts(ctx, screenshots);
            if (redoDebugDir) pipelineLog(`[pipeline] Debug artifacts (redo) → ${redoDebugDir}`);
            pipelineLog(
              `[pipeline] Final visual QA redo improved the result: ${verdict.hardIssueCount} → ${redoVerdict.hardIssueCount} hard issue(s) (skin ${redoSkin.id})`
            );
          } else {
            pipelineLog(
              `[pipeline] Final visual QA redo did not improve (still ${redoVerdict.hardIssueCount} hard issue(s)) — keeping the original attempt`
            );
          }
        } catch (err) {
          pipelineLog(
            `[pipeline] Final visual QA redo failed: ${err instanceof Error ? err.message : String(err)} — keeping the original attempt`
          );
        }
      }
    }

    finalVision = {
      passed: effectiveVerdict.passed,
      hardIssueCount: effectiveVerdict.hardIssueCount,
      redoAttempted,
      redoImproved,
    };
    if (!redoAttempted) {
      pipelineLog(
        verdict.passed
          ? "[pipeline] Final visual QA passed"
          : `[pipeline] Final visual QA: ${verdict.hardIssueCount} hard issue(s) across ${Object.keys(verdict.perPage).length} page(s) — no redo available for this output mode`
      );
    }
  }

  const qaSummary = summarizeQaResults(qaResults);
  const hardPipelineQa = hasHardQaFailures(qaResults);
  const fallbackSummary = getFallbackSummary();
  const degraded =
    (outputMode === "react" && buildSucceeded === false) ||
    hardPipelineQa ||
    !qaSummary.passed ||
    (finalVision !== undefined && !finalVision.passed) ||
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
    skinId: ctx.skinId,
    skinName: ctx.skinName,
    siteSlug,
    publishedUrl,
    outBytes,
    ...(verbatimFiles.length > 0 ? { verbatimFiles } : {}),
    ...(verbatimTemplateIds.length > 0 ? { verbatimTemplateIds } : {}),
    ...(verbatimState ? { verbatimState } : {}),
    ...(finalVision ? { finalVision } : {}),
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
    result.skinId ? `Skin: ${result.skinName ?? result.skinId} (${result.skinId})` : "",
  ].filter(Boolean);

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
