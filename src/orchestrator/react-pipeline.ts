import type { PagePlan, QAResult, ReactPage, SiteContext } from "../types.js";
import { directPageBlueprints } from "../agents/creative-director-agent.js";
import { directChromeSpec } from "../agents/chrome-director-agent.js";
import { directMotionPlan } from "../agents/motion-director-agent.js";
import { directLayoutPlan } from "../agents/layout-director-agent.js";
import { fillSectionProps } from "../agents/section-props-agent.js";
import { composePageSections } from "../agents/page-composer-agent.js";
import { generateReactProject } from "../react-codegen/assemble-project.js";
import { buildReactProject } from "../react-codegen/build-project.js";
import { runReactQA, runDesignQA } from "../qa/react-qa.js";
import { runMotionQA } from "../qa/motion-qa.js";
import { runChromeQA } from "../qa/chrome-qa.js";
import { runLayoutQA } from "../qa/layout-qa.js";
import { runBlueprintQA } from "../qa/blueprint-qa.js";
import { repairBlueprints } from "../design/blueprint-repair.js";
import {
  creativeDirectorPoolOnly,
  isFastPipeline,
  sectionFillConcurrency,
  skipDirectorRetries,
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
  runVisionRetryLoop,
} from "./react-vision-retry.js";
import {
  generateCustomHeroSection,
  shouldCodegenCustomHero,
} from "../agents/section-codegen-agent.js";

export function getOutputMode(): "react" | "html" {
  const mode = (process.env.OUTPUT_MODE ?? "react").toLowerCase();
  return mode === "html" ? "html" : "react";
}

export interface ReactPipelineResult {
  reactPages: Record<string, ReactPage>;
  projectPath: string;
  previewPath: string;
  buildSucceeded: boolean;
  qaResults: Record<string, QAResult>;
}

export async function runReactPipeline(
  ctx: SiteContext,
  registry: MediaRegistry,
  outputDir: string,
  options: { previewBasePath?: string } = {}
): Promise<ReactPipelineResult> {
  const pages = ctx.sitePlan.pages;
  if (isFastPipeline()) {
    pipelineLog(
      `[pipeline] Fast mode: parallel sections (×${sectionFillConcurrency()}), unified section LLM, pool blueprints`
    );
  }

  let blueprints = await timedStep("site", "creative director", () =>
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
    pipelineLog(
      `[pipeline] Blueprint QA failed (${blueprintQa.issues.map((i) => i.message).join("; ")}); regenerating from profile pool…`
    );
    blueprints = await timedStep("site", "creative director (pool retry)", () =>
      directPageBlueprints(ctx, pages, { poolOnly: true })
    );
    blueprintQa = runBlueprintQA(blueprints, ctx);
    if (!blueprintQa.passed) {
      pipelineLog(
        `[pipeline] Blueprint QA still failing after pool retry — applying deterministic repair…`
      );
      blueprints = repairBlueprints(blueprints, ctx);
      blueprintQa = runBlueprintQA(blueprints, ctx);
    }
  }

  let chromeSpec = await timedStep("site", "chrome director", () =>
    directChromeSpec(ctx, blueprints)
  );
  ctx.chromeSpec = chromeSpec;

  let chromeQa = runChromeQA(chromeSpec);
  if (!chromeQa.passed && !skipDirectorRetries()) {
    pipelineLog(
      `[pipeline] Chrome QA failed (${chromeQa.issues.map((i) => i.message).join("; ")}); retrying chrome director…`
    );
    chromeSpec = await directChromeSpec(ctx, blueprints);
    ctx.chromeSpec = chromeSpec;
    chromeQa = runChromeQA(chromeSpec);
  }

  const [motionPlan, layoutPlan] = await timedStep("site", "motion + layout directors", () =>
    Promise.all([
      directMotionPlan(ctx, blueprints),
      directLayoutPlan(ctx, blueprints),
    ])
  );
  ctx.motionPlan = motionPlan;
  ctx.layoutPlan = layoutPlan;

  let motionQa = runMotionQA(motionPlan, blueprints);
  if (!motionQa.passed && !skipDirectorRetries()) {
    pipelineLog(
      `[pipeline] Motion QA failed (${motionQa.issues.map((i) => i.message).join("; ")}); retrying motion director…`
    );
    ctx.motionPlan = await directMotionPlan(ctx, blueprints);
    motionQa = runMotionQA(ctx.motionPlan, blueprints);
  }

  let layoutQa = runLayoutQA(layoutPlan, blueprints);
  if (!layoutQa.passed && !skipDirectorRetries()) {
    pipelineLog(
      `[pipeline] Layout QA failed (${layoutQa.issues.map((i) => i.message).join("; ")}); retrying layout director…`
    );
    ctx.layoutPlan = await directLayoutPlan(ctx, blueprints);
    layoutQa = runLayoutQA(ctx.layoutPlan, blueprints);
  }

  const reactPages: Record<string, ReactPage> = {};
  const qaResults: Record<string, QAResult> = {};

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
    let instance = await timedStep(job.blueprint.slug, `${job.section.id}: props`, () =>
      fillSectionProps(ctx, job.blueprint.slug, job.section, registry)
    );

    if (shouldCodegenCustomHero(ctx, job.blueprint.slug, job.section, job.sectionIndex)) {
      const custom = await timedStep(job.blueprint.slug, `${job.section.id}: custom hero`, () =>
        generateCustomHeroSection(ctx, instance)
      );
      if (custom) {
        instance = { ...instance, customCodegen: custom };
      }
    }

    return { ...job, instance };
  });

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

  pipelineLog("[pipeline] Generating React project…");
  const { projectPath } = await generateReactProject(ctx, reactPages, outputDir, {
    basePath: options.previewBasePath,
  });

  let previewPath = projectPath;
  let buildSucceeded = false;
  try {
    previewPath = await buildReactProject(projectPath);
    buildSucceeded = true;
    pipelineLog(`[pipeline] React build complete → ${previewPath}`);
  } catch (err) {
    pipelineLog(
      `[pipeline] React build skipped (${err instanceof Error ? err.message : String(err)}) — using HTML preview fallback`
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
  qaResults.__motion__ = motionQa;
  qaResults.__chrome__ = chromeQa;
  qaResults.__layout__ = layoutQa;
  qaResults.__blueprint__ = blueprintQa;

  if (buildSucceeded && llm.supportsVision) {
    try {
      const vision = await buildAndVisionQa(ctx, previewPath, "home");
      qaResults.__vision__ = {
        passed: vision.passed,
        issues: vision.issues,
      };
      if (vision.issues.length > 0) {
        pipelineLog(
          `[pipeline] Vision QA: ${vision.issues.map((i) => i.message).join("; ")}`
        );
      }

      if (!vision.passed) {
        const retry = await runVisionRetryLoop(
          ctx,
          reactPages,
          blueprints,
          registry,
          previewPath,
          outputDir,
          vision.issues,
          { previewBasePath: options.previewBasePath }
        );
        if (retry) {
          qaResults.__vision_retry__ = {
            passed: retry.qa.passed,
            issues: retry.qa.issues,
          };
          pipelineLog(
            `[pipeline] Vision retry applied: ${retry.applied.join(", ")} — ${retry.qa.passed ? "passed" : "still failing"}`
          );
          if (retry.buildSucceeded) {
            previewPath = retry.previewPath;
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pipelineLog(`[pipeline] Vision QA failed: ${message}`);
      qaResults.__vision__ = {
        passed: false,
        issues: [
          {
            severity: "hard",
            code: "VISION_QA_ERROR",
            message: `Vision QA failed: ${message}`,
          },
        ],
      };
    }
  }

  return { reactPages, projectPath, previewPath, buildSucceeded, qaResults };
}
