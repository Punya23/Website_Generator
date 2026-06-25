import type { PagePlan, QAResult, ReactPage, SiteContext } from "../types.js";
import { directPageBlueprints } from "../agents/creative-director-agent.js";
import { fillSectionProps } from "../agents/section-props-agent.js";
import { composePageSections } from "../agents/page-composer-agent.js";
import { generateReactProject, buildReactProject } from "../react-codegen/assemble-project.js";
import { runReactQA } from "../qa/react-qa.js";
import { MediaRegistry } from "../media/media-registry.js";
import { timedStep } from "../util/timed.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { getPagePlan } from "../agents/site-planner-agent.js";

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
  const blueprints = await timedStep("site", "creative director", () =>
    directPageBlueprints(ctx, pages)
  );

  const reactPages: Record<string, ReactPage> = {};
  const qaResults: Record<string, QAResult> = {};

  for (const blueprint of blueprints) {
    const pagePlan = getPagePlan(ctx.sitePlan, blueprint.slug)!;
    pipelineLog(`[pipeline] ${blueprint.slug}: filling ${blueprint.sections.length} sections…`);

    const instances = [];
    for (const section of blueprint.sections) {
      const instance = await timedStep(
        blueprint.slug,
        `${section.id}: props`,
        () => fillSectionProps(ctx, blueprint.slug, section, registry)
      );
      instances.push(instance);
    }

    const composed = composePageSections(blueprint, instances);
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
  }

  for (const slug of Object.keys(reactPages)) {
    qaResults[slug] = await runReactQA(reactPages[slug]!, slug);
  }

  return { reactPages, projectPath, previewPath, buildSucceeded, qaResults };
}
