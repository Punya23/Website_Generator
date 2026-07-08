import type { PageBlueprint, PagePlan, QAResult, ReactPage, SectionInstance, SiteContext } from "../types.js";
import { directPageBlueprints } from "../agents/creative-director-agent.js";
import { directChromeSpec } from "../agents/chrome-director-agent.js";
import { directMotionPlan } from "../agents/motion-director-agent.js";
import { directLayoutPlan } from "../agents/layout-director-agent.js";
import { fillSectionProps } from "../agents/section-props-agent.js";
import { composePageSections } from "../agents/page-composer-agent.js";
import { generateReactProject } from "../react-codegen/assemble-project.js";
import { buildReactProject } from "../react-codegen/build-project.js";
import { startReactPreviewServer, stopReactPreviewServer } from "../react-codegen/react-preview-server.js";
import { runReactQA, runDesignQA } from "../qa/react-qa.js";
import { runMotionQA } from "../qa/motion-qa.js";
import { runChromeQA } from "../qa/chrome-qa.js";
import { runLayoutQA } from "../qa/layout-qa.js";
import { runBlueprintQA } from "../qa/blueprint-qa.js";
import { repairBlueprints } from "../design/blueprint-repair.js";
import {
  creativeDirectorPoolOnly,
  isFastPipeline,
  isQualityPipeline,
  sectionFillConcurrency,
  bespokeCodegenConcurrency,
  skipDirectorRetries,
  visionQaEnabled,
  visionQaHomeOnly,
  maxVisionRetries,
  usePageCodegenPipeline,
} from "../llm/pipeline-speed.js";
import { mapPool } from "../util/async-pool.js";
import { attachMotionPlan } from "../agents/contracts/index.js";
import { MediaRegistry } from "../media/media-registry.js";
import { timedStep } from "../util/timed.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { getPagePlan } from "../agents/site-planner-agent.js";
import { llm } from "../llm/client.js";
import {
  buildAndVisionQa,
  runSiteVisionRetryLoop,
} from "./react-vision-retry.js";
import {
  generateBespokeSection,
  shouldAttemptBespokeSection,
} from "../agents/section-codegen-agent.js";
import { repairBespokeSectionWithBuildError } from "../agents/build-repair-agent.js";
import {
  generatePageSections,
  instancesToBlueprint,
} from "../agents/page-codegen-agent.js";
import { buildSiteCompositionPlan } from "../agents/page-composition-hints.js";
import { proposeSiteLookProfile } from "../agents/site-look-agent.js";
import { resolveSiteFxTreatment, type SiteFxTreatment } from "../design/site-fx.js";
import { minimalChromeSpec, minimalMotionPlan } from "../agents/minimal-site-chrome.js";

export function getOutputMode(): "react" | "html" {
  const mode = (process.env.OUTPUT_MODE ?? "react").toLowerCase();
  return mode === "html" ? "html" : "react";
}

export function parseFailedCustomComponent(buildError: string): string | null {
  const match = buildError.match(/components\/custom\/([^/\s'"]+\.tsx)/);
  return match?.[1] ?? null;
}

/** Drops a broken bespoke section's customCodegen so it falls back to its already-valid
 *  fixed-template render (writePageTsx uses the template component whenever customCodegen is absent). */
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

/** Drop every bespoke section when the build error has no parseable file (e.g. prerender useContext). */
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
  /** The real compiler/build error from the final failed attempt, once repair + mechanical
   *  fallbacks are exhausted. Only set when buildSucceeded is false. */
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
      `[pipeline] React build skipped (${lastBuildError.slice(0, 400)}) — using HTML preview fallback`
    );
    pipelineLog(
      `[pipeline] Failed React project kept at ${projectPath} (npm run build && npm run preview — open /preview/)`
    );
  }

  for (const slug of Object.keys(reactPages)) {
    qaResults[slug] = await runReactQA(reactPages[slug]!, slug, ctx.expandedBrief.expandedBrief);
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

  return {
    reactPages,
    projectPath,
    previewPath,
    buildSucceeded,
    buildError: buildSucceeded ? undefined : lastBuildError,
    qaResults,
  };
}

export async function runReactPipeline(
  ctx: SiteContext,
  registry: MediaRegistry,
  outputDir: string,
  options: { previewBasePath?: string } = {}
): Promise<ReactPipelineResult> {
  const pages = ctx.sitePlan.pages;
  const pageCodegen = usePageCodegenPipeline();

  if (pageCodegen) {
    pipelineLog(
      "[pipeline] Page codegen mode: one LLM call per page composes components + copy"
    );
  } else if (isQualityPipeline()) {
    pipelineLog(
      `[pipeline] Quality mode: site architect (GLM), Gemini section copy, concurrency ×${sectionFillConcurrency()}`
    );
  } else if (isFastPipeline()) {
    pipelineLog(
      `[pipeline] Fast mode: parallel sections (×${sectionFillConcurrency()}), unified section LLM, pool blueprints`
    );
  }

  let blueprints: PageBlueprint[];
  const reactPages: Record<string, ReactPage> = {};

  if (pageCodegen) {
    type PageRow = {
      blueprint: PageBlueprint;
      instances: SectionInstance[];
    };

    const lookProfile = await proposeSiteLookProfile(ctx);
    const siteFx: SiteFxTreatment = resolveSiteFxTreatment(ctx, lookProfile);
    const siteComposition = buildSiteCompositionPlan(ctx, lookProfile);
    pipelineLog(`[pipeline] Site FX treatment: ${siteFx}`);
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

    blueprints = pageRows.map((r) => r.blueprint);

    const blueprintQa = runBlueprintQA(blueprints, ctx);
    if (!blueprintQa.passed) {
      pipelineLog(
        `[pipeline] Blueprint QA notes (page codegen): ${blueprintQa.issues.map((i) => i.message).join("; ")}`
      );
    }

    const chromeSpec0 = minimalChromeSpec(ctx, blueprints);
    const motionPlan = minimalMotionPlan(ctx, blueprints);
    const layoutPlan = { sections: {} };
    ctx.chromeSpec = chromeSpec0;
    ctx.motionPlan = motionPlan;
    ctx.layoutPlan = layoutPlan;

    const chromeQa = runChromeQA(chromeSpec0);
    const motionQa = runMotionQA(motionPlan, blueprints);
    const layoutQa = runLayoutQA(layoutPlan, blueprints);
    pipelineLog(`[pipeline] Page codegen: minimal chrome; visualFx=${siteFx}`);

    for (const pagePlan of pages) {
      const row = pageRows.find((r) => r.blueprint.slug === pagePlan.slug)!;
      const stamped: SectionInstance[] = row.instances.map((s) => ({
        ...s,
        props: { ...s.props, visualFx: siteFx },
      }));
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
      ctx.reactPages = { ...ctx.reactPages, [pagePlan.slug]: reactPages[pagePlan.slug] };
    }

    return finishReactPipeline(ctx, reactPages, blueprints, registry, outputDir, options, {
      blueprintQa,
      chromeQa,
      motionQa,
      layoutQa,
    });
  }

  blueprints = await timedStep("site", "creative director", () =>
    directPageBlueprints(ctx, pages, { poolOnly: creativeDirectorPoolOnly() })
  );

  let blueprintQa = runBlueprintQA(blueprints, ctx);
  const homeBp = blueprints.find((b) => b.slug === "home");
  if (homeBp) {
    const closer = homeBp.sections.find((s) => ["cta_band", "footer_cta"].includes(s.templateId));
    pipelineLog(
      `[pipeline] Home blueprint: ${homeBp.sections.length} sections, closer=${closer?.templateId ?? "none"}, profile=${ctx.verticalProfile?.profileId ?? "—"}, seed=${ctx.variationSeed ?? "—"}`
    );
  }
  if (!blueprintQa.passed) {
    const issueMessages = blueprintQa.issues.map((i) => i.message);
    pipelineLog(
      `[pipeline] Blueprint QA failed (${issueMessages.join("; ")}); ${isQualityPipeline() ? "architect retry…" : "regenerating from profile pool…"}`
    );
    if (isQualityPipeline()) {
      blueprints = await timedStep("site", "site architect (QA retry)", () =>
        directPageBlueprints(ctx, pages, { qaIssues: issueMessages })
      );
    } else {
      blueprints = await timedStep("site", "creative director (pool retry)", () =>
        directPageBlueprints(ctx, pages, { poolOnly: true })
      );
    }
    blueprintQa = runBlueprintQA(blueprints, ctx);
    if (!blueprintQa.passed) {
      pipelineLog(
        `[pipeline] Blueprint QA still failing — applying deterministic repair…`
      );
      blueprints = repairBlueprints(blueprints, ctx);
      blueprintQa = runBlueprintQA(blueprints, ctx);
    }
  }

  // Chrome, motion, and layout directors all take just (ctx, blueprints) and don't consume each
  // other's output — no reason to serialize them.
  const [chromeSpec0, motionPlan, layoutPlan] = await timedStep(
    "site",
    "chrome + motion + layout directors",
    () =>
      Promise.all([
        directChromeSpec(ctx, blueprints),
        directMotionPlan(ctx, blueprints),
        directLayoutPlan(ctx, blueprints),
      ])
  );
  ctx.chromeSpec = chromeSpec0;
  ctx.motionPlan = motionPlan;
  ctx.layoutPlan = layoutPlan;

  let chromeQa = runChromeQA(chromeSpec0);
  let motionQa = runMotionQA(motionPlan, blueprints);
  let layoutQa = runLayoutQA(layoutPlan, blueprints);

  if (!skipDirectorRetries()) {
    await Promise.all([
      (async () => {
        if (chromeQa.passed) return;
        pipelineLog(
          `[pipeline] Chrome QA failed (${chromeQa.issues.map((i) => i.message).join("; ")}); retrying chrome director…`
        );
        ctx.chromeSpec = await directChromeSpec(ctx, blueprints);
        chromeQa = runChromeQA(ctx.chromeSpec);
      })(),
      (async () => {
        if (motionQa.passed) return;
        pipelineLog(
          `[pipeline] Motion QA failed (${motionQa.issues.map((i) => i.message).join("; ")}); retrying motion director…`
        );
        ctx.motionPlan = await directMotionPlan(ctx, blueprints);
        motionQa = runMotionQA(ctx.motionPlan, blueprints);
      })(),
      (async () => {
        if (layoutQa.passed) return;
        pipelineLog(
          `[pipeline] Layout QA failed (${layoutQa.issues.map((i) => i.message).join("; ")}); retrying layout director…`
        );
        ctx.layoutPlan = await directLayoutPlan(ctx, blueprints);
        layoutQa = runLayoutQA(ctx.layoutPlan, blueprints);
      })(),
    ]);
  }

  type SectionJob = {
    blueprint: (typeof blueprints)[number];
    section: (typeof blueprints)[number]["sections"][number];
    sectionIndex: number;
  };

  const jobs: SectionJob[] = [];
  for (const blueprint of blueprints) {
    pipelineLog(`[pipeline] ${blueprint.slug}: filling ${blueprint.sections.length} sections…`);
    blueprint.sections.forEach((section, sectionIndex) => {
      jobs.push({ blueprint, section, sectionIndex });
    });
  }

  const concurrency = sectionFillConcurrency();
  const filled = await mapPool(jobs, concurrency, async (job) => {
    const instance = await timedStep(job.blueprint.slug, `${job.section.id}: props`, () =>
      fillSectionProps(ctx, job.blueprint.slug, job.section, registry)
    );
    return { ...job, instance };
  });

  // Bespoke codegen is a separate, slower pass with its own (wider) concurrency and request
  // queue — mixing it into the props-fill pool above serializes fast prop-fills behind slow
  // (10-150s) codegen calls sharing the same worker slots.
  const codegenEligible = filled
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => shouldAttemptBespokeSection(ctx, row.section));

  if (codegenEligible.length > 0) {
    const codegenConcurrency = bespokeCodegenConcurrency();
    pipelineLog(
      `[pipeline] Bespoke codegen: ${codegenEligible.length} eligible section(s), concurrency ×${codegenConcurrency}`
    );
    await mapPool(codegenEligible, codegenConcurrency, async ({ row, i }) => {
      const custom = await timedStep(row.blueprint.slug, `${row.section.id}: bespoke codegen`, () =>
        generateBespokeSection(ctx, row.instance)
      );
      if (custom) {
        filled[i] = { ...row, instance: { ...row.instance, customCodegen: custom } };
      }
    });
  }

  const byPage = new Map<string, typeof filled>();
  for (const row of filled) {
    const list = byPage.get(row.blueprint.slug) ?? [];
    list.push(row);
    byPage.set(row.blueprint.slug, list);
  }

  for (const blueprint of blueprints) {
    const pagePlan = getPagePlan(ctx.sitePlan, blueprint.slug)!;
    const rows = (byPage.get(blueprint.slug) ?? []).sort(
      (a, b) => a.sectionIndex - b.sectionIndex
    );
    const instances = rows.map((r) => r.instance);

    const composed = attachMotionPlan(
      composePageSections(blueprint, instances),
      ctx.motionPlan!
    );
    reactPages[blueprint.slug] = {
      slug: blueprint.slug,
      title: pagePlan.title,
      navLabel: pagePlan.navLabel,
      sections: composed,
    };

    ctx.reactPages = { ...ctx.reactPages, [blueprint.slug]: reactPages[blueprint.slug] };
  }

  return finishReactPipeline(ctx, reactPages, blueprints, registry, outputDir, options, {
    blueprintQa,
    chromeQa,
    motionQa,
    layoutQa,
  });
}
