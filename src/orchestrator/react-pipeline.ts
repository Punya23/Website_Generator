import type { PageBlueprint, QAResult, ReactPage, SectionInstance, SiteContext } from "../types.js";
import { composePageSections } from "../agents/page-composer-agent.js";
import { generateReactProject, buildReactProject } from "../react-codegen/assemble-project.js";
import { startReactPreviewServer, stopReactPreviewServer } from "../react-codegen/react-preview-server.js";
import { runReactQA, runDesignQA } from "../qa/react-qa.js";
import { runMotionQA } from "../qa/motion-qa.js";
import { runChromeQA } from "../qa/chrome-qa.js";
import { runLayoutQA } from "../qa/layout-qa.js";
import { runBlueprintQA } from "../qa/blueprint-qa.js";
import {
  isQualityPipeline,
  isFastPipeline,
  visionQaEnabled,
  visionQaHomeOnly,
  maxVisionRetries,
  useSkinFillPipeline,
} from "../llm/pipeline-speed.js";
import { mapPool } from "../util/async-pool.js";
import { attachMotionPlan } from "../agents/contracts/index.js";
import { MediaRegistry } from "../media/media-registry.js";
import { timedStep } from "../util/timed.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { llm } from "../llm/client.js";
import {
  buildAndVisionQa,
  runSiteVisionRetryLoop,
} from "./react-vision-retry.js";
import { repairBespokeSectionWithBuildError } from "../agents/build-repair-agent.js";
import {
  generatePageSections,
  instancesToBlueprint,
} from "../agents/page-codegen-agent.js";
import { buildSiteCompositionPlan } from "../agents/page-composition-hints.js";
import { proposeSiteLookProfile, applyDesignBriefToTheme } from "../agents/site-look-agent.js";
import { resolveSiteFxTreatment } from "../design/site-fx.js";
import {
  applyPageRhythm,
  resolveSiteVisualContract,
} from "../design/design-language.js";
import { minimalChromeSpec, minimalMotionPlan } from "../agents/minimal-site-chrome.js";
import { acceptGeneratedProject } from "../react-codegen/accept-generated.js";
import { fillSiteSkin } from "../agents/skin-fill-agent.js";
import { alignSitePlanToSkin, pickSiteSkin } from "../skins/picker.js";
import type { SiteLayoutPlan } from "../types.js";

export function getOutputMode(): "react" | "html" {
  const mode = (process.env.OUTPUT_MODE ?? "react").toLowerCase();
  return mode === "html" ? "html" : "react";
}

export function parseFailedCustomComponent(buildError: string): string | null {
  const match = buildError.match(/components\/custom\/([^/\s'"]+\.tsx)/);
  return match?.[1] ?? null;
}

export function dropCustomCodegenByFileName(reactPages: Record<string, ReactPage>, fileName: string): boolean {
  for (const page of Object.values(reactPages)) {
    const section = page.sections.find((s) => s.customCodegen?.fileName === fileName);
    if (section) {
      section.customCodegen = undefined;
      return true;
    }
  }
  return false;
}

export function dropAllCustomCodegen(reactPages: Record<string, ReactPage>): number {
  let dropped = 0;
  for (const page of Object.values(reactPages)) {
    for (const section of page.sections) {
      if (section.customCodegen) {
        section.customCodegen = undefined;
        dropped++;
      }
    }
  }
  return dropped;
}

export interface ReactPipelineResult {
  reactPages: Record<string, ReactPage>;
  projectPath: string;
  previewPath: string;
  buildSucceeded: boolean;
  buildError?: string;
  qaResults: Record<string, QAResult>;
}

interface DirectorQa {
  blueprintQa: QAResult;
  chromeQa: QAResult;
  motionQa: QAResult;
  layoutQa: QAResult;
}

async function finishReactPipeline(
  ctx: SiteContext,
  reactPages: Record<string, ReactPage>,
  blueprints: PageBlueprint[],
  registry: MediaRegistry,
  outputDir: string,
  options: { previewBasePath?: string },
  directorQa: DirectorQa
): Promise<ReactPipelineResult> {
  const qaResults: Record<string, QAResult> = {};

  pipelineLog("[pipeline] Generating React project…");
  let projectPath = (
    await generateReactProject(ctx, reactPages, outputDir, { basePath: options.previewBasePath })
  ).projectPath;

  let previewPath = projectPath;
  let buildSucceeded = false;
  let lastBuildError = "";

  const MAX_BUILD_ATTEMPTS = 6;
  const MAX_REPAIR_ATTEMPTS_PER_FILE = 2;
  const repairAttemptsByFile = new Map<string, number>();
  for (let attempt = 0; attempt < MAX_BUILD_ATTEMPTS; attempt++) {
    try {
      // Hard typecheck gate before/during build acceptance
      const typeGate = await acceptGeneratedProject(projectPath, { skipBuild: true });
      if (!typeGate.ok) {
        throw new Error(typeGate.error ?? "Generated project typecheck failed");
      }
      previewPath = await buildReactProject(projectPath);
      buildSucceeded = true;
      pipelineLog(`[pipeline] React build complete → ${previewPath}`);
      break;
    } catch (err) {
      lastBuildError = err instanceof Error ? err.message : String(err);
      pipelineLog(
        `[pipeline] React build failed (attempt ${attempt + 1}): ${lastBuildError.slice(0, 400)}`
      );

      const brokenFile =
        attempt < MAX_BUILD_ATTEMPTS - 1 ? parseFailedCustomComponent(lastBuildError) : null;

      if (brokenFile) {
        const repairsUsed = repairAttemptsByFile.get(brokenFile) ?? 0;
        if (repairsUsed < MAX_REPAIR_ATTEMPTS_PER_FILE) {
          repairAttemptsByFile.set(brokenFile, repairsUsed + 1);
          const repaired = await repairBespokeSectionWithBuildError(
            reactPages,
            brokenFile,
            lastBuildError,
            repairsUsed + 1,
            MAX_REPAIR_ATTEMPTS_PER_FILE
          );
          if (repaired) {
            projectPath = (
              await generateReactProject(ctx, reactPages, outputDir, { basePath: options.previewBasePath })
            ).projectPath;
            continue;
          }
        }
      }
      if (brokenFile && dropCustomCodegenByFileName(reactPages, brokenFile)) {
        pipelineLog(
          `[pipeline] Dropping bespoke section ${brokenFile} after build failure — falling back to its template render…`
        );
        projectPath = (
          await generateReactProject(ctx, reactPages, outputDir, { basePath: options.previewBasePath })
        ).projectPath;
        continue;
      }
      if (
        attempt < MAX_BUILD_ATTEMPTS - 1 &&
        !brokenFile &&
        /useContext|Cannot read properties of null/i.test(lastBuildError)
      ) {
        const dropped = dropAllCustomCodegen(reactPages);
        if (dropped > 0) {
          pipelineLog(
            `[pipeline] Prerender hook failure — dropping ${dropped} bespoke section(s), retrying with fixed templates…`
          );
          projectPath = (
            await generateReactProject(ctx, reactPages, outputDir, { basePath: options.previewBasePath })
          ).projectPath;
          continue;
        }
      }
      break;
    }
  }

  if (!buildSucceeded) {
    pipelineLog(
      `[pipeline] React build failed after acceptance attempts — site will not be marked successful. Last error: ${lastBuildError.slice(0, 400)}`
    );
    pipelineLog(
      `[pipeline] Failed React project kept at ${projectPath} (npm run build && npm run preview — open /preview/)`
    );
  }

  for (const slug of Object.keys(reactPages)) {
    qaResults[slug] = runReactQA(reactPages[slug]!, slug, ctx.expandedBrief.expandedBrief);
  }

  const designQa = runDesignQA(ctx.designSystem);
  if (!designQa.passed) {
    pipelineLog(`[pipeline] Design token QA: ${designQa.issues.map((i) => i.message).join("; ")}`);
  }
  qaResults.__design__ = designQa;
  qaResults.__motion__ = directorQa.motionQa;
  qaResults.__chrome__ = directorQa.chromeQa;
  qaResults.__layout__ = directorQa.layoutQa;
  qaResults.__blueprint__ = directorQa.blueprintQa;

  if (buildSucceeded && llm.supportsVision && visionQaEnabled()) {
    const pagesToCheck = (visionQaHomeOnly() ? ["home"] : Object.keys(reactPages)).filter(
      (slug) => reactPages[slug]
    );
    const pageIssues = new Map<string, QAResult["issues"]>();

    try {
      let previewUrl = await startReactPreviewServer(projectPath);

      await mapPool(pagesToCheck, Math.min(4, pagesToCheck.length), async (pageSlug) => {
        try {
          const vision = await buildAndVisionQa(ctx, previewUrl, pageSlug);
          qaResults[`__vision_${pageSlug}__`] = { passed: vision.passed, issues: vision.issues };
          if (vision.issues.length > 0) {
            pipelineLog(
              `[pipeline] Vision QA (${pageSlug}): ${vision.issues.map((i) => i.message).join("; ")}`
            );
          }
          pageIssues.set(pageSlug, vision.issues);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          pipelineLog(`[pipeline] Vision QA failed (${pageSlug}): ${message}`);
          qaResults[`__vision_${pageSlug}__`] = {
            passed: false,
            issues: [{ severity: "hard", code: "VISION_QA_ERROR", message: `Vision QA failed: ${message}` }],
          };
        }
      });

      let retriesLeft = maxVisionRetries();
      const hasHardIssues = () =>
        [...pageIssues.values()].some((issues) => issues.some((i) => i.severity === "hard"));

      while (retriesLeft > 0 && hasHardIssues()) {
        retriesLeft--;
        const retry = await runSiteVisionRetryLoop(ctx, reactPages, blueprints, registry, outputDir, pageIssues, {
          previewBasePath: options.previewBasePath,
        });
        if (!retry) break;

        pipelineLog(
          `[pipeline] Vision retry: ${retry.applied.join(", ")} — ${retry.buildSucceeded ? "rebuilt" : "rebuild failed"}`
        );
        if (!retry.buildSucceeded || !retry.previewUrl) break;
        previewPath = retry.previewPath;
        previewUrl = retry.previewUrl;

        const stillFailing = pagesToCheck.filter((slug) =>
          pageIssues.get(slug)?.some((i) => i.severity === "hard")
        );
        await mapPool(stillFailing, Math.min(4, stillFailing.length), async (pageSlug) => {
          const revision = await buildAndVisionQa(ctx, previewUrl, pageSlug);
          qaResults[`__vision_retry_${pageSlug}__`] = { passed: revision.passed, issues: revision.issues };
          pipelineLog(`[pipeline] Vision retry (${pageSlug}): ${revision.passed ? "passed" : "still failing"}`);
          pageIssues.set(pageSlug, revision.issues);
        });
      }
    } finally {
      stopReactPreviewServer();
    }
  }

  void isQualityPipeline;
  void isFastPipeline;

  return {
    reactPages,
    projectPath,
    previewPath,
    buildSucceeded,
    buildError: buildSucceeded ? undefined : lastBuildError,
    qaResults,
  };
}

function layoutPlanFromInstances(pages: Record<string, SectionInstance[]>): SiteLayoutPlan {
  const sections: SiteLayoutPlan["sections"] = {};
  for (const list of Object.values(pages)) {
    for (const section of list) {
      sections[section.id] = {
        variant: section.layoutSpec?.variant ?? "default",
        density: section.layoutSpec?.density,
        mediaPosition: section.layoutSpec?.mediaPosition,
      };
    }
  }
  return { sections };
}

function assembleReactPages(
  ctx: SiteContext,
  pageRows: Array<{ blueprint: PageBlueprint; instances: SectionInstance[] }>,
  visualContract: ReturnType<typeof resolveSiteVisualContract>
): Record<string, ReactPage> {
  const reactPages: Record<string, ReactPage> = {};
  for (const pagePlan of ctx.sitePlan.pages) {
    const row = pageRows.find((r) => r.blueprint.slug === pagePlan.slug);
    if (!row) continue;
    const stamped: SectionInstance[] = row.instances.map((s) => ({
      ...s,
      props: { ...s.props },
    }));
    applyPageRhythm(stamped, visualContract);
    const composed = attachMotionPlan(
      composePageSections(row.blueprint, stamped),
      ctx.motionPlan!
    );
    reactPages[pagePlan.slug] = {
      slug: pagePlan.slug,
      title: pagePlan.title,
      navLabel: pagePlan.navLabel,
      sections: composed,
    };
    ctx.reactPages = { ...ctx.reactPages, [pagePlan.slug]: reactPages[pagePlan.slug]! };
  }
  return reactPages;
}

async function lookAndContract(ctx: SiteContext) {
  const lookProfile = await proposeSiteLookProfile(ctx);
  applyDesignBriefToTheme(ctx.designSystem, lookProfile);
  const siteFx = resolveSiteFxTreatment(ctx, lookProfile);
  const visualContract = resolveSiteVisualContract(ctx.designSystem, siteFx);
  ctx.siteFx = siteFx;
  pipelineLog(`[pipeline] Site FX treatment: ${siteFx}`);
  pipelineLog(
    `[pipeline] Visual contract: fx=${visualContract.visualFx} surface=${visualContract.defaultSurface} panel=${visualContract.defaultPanel}`
  );
  return { lookProfile, visualContract };
}

function directorQaFrom(
  ctx: SiteContext,
  blueprints: PageBlueprint[],
  instances: Record<string, SectionInstance[]>,
  skinChrome?: { footerLayout?: "two-column" | "centered" | "cta-heavy"; grainOverlay?: boolean }
) {
  const blueprintQa = runBlueprintQA(blueprints, ctx);
  if (blueprintQa.issues.length > 0) {
    pipelineLog(
      `[pipeline] Blueprint QA notes: ${blueprintQa.issues.map((i) => i.message).join("; ")}`
    );
  }
  const chromeSpec0 = minimalChromeSpec(ctx, blueprints);
  if (skinChrome?.footerLayout) chromeSpec0.footer.layout = skinChrome.footerLayout;
  if (skinChrome?.grainOverlay !== undefined) {
    chromeSpec0.immersive = {
      ...chromeSpec0.immersive,
      grainOverlay: skinChrome.grainOverlay,
    };
  }
  const motionPlan = minimalMotionPlan(ctx, blueprints, chromeSpec0);
  const layoutPlan = layoutPlanFromInstances(instances);
  ctx.chromeSpec = chromeSpec0;
  ctx.motionPlan = motionPlan;
  ctx.layoutPlan = layoutPlan;
  return {
    blueprintQa,
    chromeQa: runChromeQA(chromeSpec0),
    motionQa: runMotionQA(motionPlan, blueprints),
    layoutQa: runLayoutQA(layoutPlan, blueprints),
  };
}

async function runSkinFillReactPipeline(
  ctx: SiteContext,
  registry: MediaRegistry,
  outputDir: string,
  options: { previewBasePath?: string }
): Promise<ReactPipelineResult> {
  pipelineLog(
    `[pipeline] Skin fill (default React path)${isQualityPipeline() ? " · quality" : isFastPipeline() ? " · fast" : ""}`
  );
  const { lookProfile, visualContract } = await lookAndContract(ctx);
  void lookProfile;

  const skin = await timedStep("site", "pick skin", () =>
    pickSiteSkin({
      brief: ctx.expandedBrief,
      consumerId: ctx.consumerId,
      variationSeed: ctx.variationSeed,
      profileId: ctx.verticalProfile?.profileId,
    })
  );
  ctx.skinId = skin.id;
  ctx.skinName = skin.name;
  ctx.sitePlan = alignSitePlanToSkin(ctx.sitePlan, skin);
  ctx.designSystem = {
    ...ctx.designSystem,
    navShape: skin.chrome.navShape,
    motionPreset: skin.motionPreset,
  };
  pipelineLog(
    `[pipeline] Skin ${skin.id} (${skin.name}) · ${skin.categories.join(", ")} · ${skin.visualFamily}`
  );

  const filled = await timedStep("site", "skin fill", () => fillSiteSkin(ctx, skin, registry));
  for (const [slug, list] of Object.entries(filled.instances)) {
    pipelineLog(`[pipeline] ${slug}: ${list.map((s) => s.templateId).join("→")}`);
  }

  const directorQa = directorQaFrom(ctx, filled.blueprints, filled.instances, {
    footerLayout: skin.chrome.footerLayout,
    grainOverlay: skin.chrome.grainOverlay,
  });
  const pageRows = ctx.sitePlan.pages.map((page) => ({
    blueprint: filled.blueprints.find((bp) => bp.slug === page.slug)!,
    instances: filled.instances[page.slug] ?? [],
  }));
  const reactPages = assembleReactPages(ctx, pageRows, visualContract);
  return finishReactPipeline(ctx, reactPages, filled.blueprints, registry, outputDir, options, directorQa);
}

async function runPageCodegenReactPipeline(
  ctx: SiteContext,
  registry: MediaRegistry,
  outputDir: string,
  options: { previewBasePath?: string }
): Promise<ReactPipelineResult> {
  const pages = ctx.sitePlan.pages;
  pipelineLog(
    `[pipeline] Page codegen (opt-in)${isQualityPipeline() ? " · quality" : isFastPipeline() ? " · fast" : ""}`
  );

  type PageRow = {
    blueprint: PageBlueprint;
    instances: SectionInstance[];
  };

  const { lookProfile, visualContract } = await lookAndContract(ctx);
  const siteComposition = buildSiteCompositionPlan(ctx, lookProfile);
  pipelineLog(
    `[pipeline] Site composition: ${Object.entries(siteComposition.pages)
      .map(([slug, h]) => `${slug}→${h.heroComponent}`)
      .join(", ")}`
  );

  const pageRows = await mapPool(
    pages,
    Math.min(4, Math.max(1, pages.length)),
    async (pagePlan): Promise<PageRow> => {
      const instances = await timedStep(pagePlan.slug, "page codegen", () =>
        generatePageSections(ctx, pagePlan, registry, siteComposition)
      );
      const blueprint = instancesToBlueprint(pagePlan.slug, instances);
      pipelineLog(
        `[pipeline] ${pagePlan.slug}: ${instances.map((s) => s.templateId).join("→")}`
      );
      return { blueprint, instances };
    }
  );

  const blueprints = pageRows.map((r) => r.blueprint);
  const instancesBySlug: Record<string, SectionInstance[]> = {};
  for (const row of pageRows) instancesBySlug[row.blueprint.slug] = row.instances;
  const directorQa = directorQaFrom(ctx, blueprints, instancesBySlug);
  const reactPages = assembleReactPages(ctx, pageRows, visualContract);
  return finishReactPipeline(ctx, reactPages, blueprints, registry, outputDir, options, directorQa);
}

/**
 * Default production React path: authored site skin + one copy-fill call.
 * Opt into the old per-page composer with PIPELINE_PAGE_CODEGEN=1.
 */
export async function runReactPipeline(
  ctx: SiteContext,
  registry: MediaRegistry,
  outputDir: string,
  options: { previewBasePath?: string } = {}
): Promise<ReactPipelineResult> {
  if (useSkinFillPipeline()) {
    return runSkinFillReactPipeline(ctx, registry, outputDir, options);
  }
  return runPageCodegenReactPipeline(ctx, registry, outputDir, options);
}
