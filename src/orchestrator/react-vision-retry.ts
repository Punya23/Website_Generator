import fs from "fs/promises";
import path from "path";
import type { PageBlueprint, QAResult, ReactPage, SiteContext } from "../types.js";
import { refineDesignSystem } from "../agents/design-refine-agent.js";
import { profileCoherenceFromContext } from "../theme/profile-coherence.js";
import { directMotionPlan } from "../agents/motion-director-agent.js";
import { directChromeSpec } from "../agents/chrome-director-agent.js";
import { fillSectionProps } from "../agents/section-props-agent.js";
import { generateCustomHeroSection } from "../agents/section-codegen-agent.js";
import { applyLayoutFixes, layoutSpecToProps } from "../agents/layout-fix-agent.js";
import { attachMotionPlan } from "../agents/contracts/index.js";
import { generateReactProject, buildReactProject } from "../react-codegen/assemble-project.js";
import { screenshotPageDual, extractBlockManifest } from "../qa/code-qa.js";
import { runVisionQa } from "../agents/vision-agent.js";
import { routeVisionIssues, visionFixPlanHasWork, type VisionFixPlan } from "../qa/vision-router.js";
import { MediaRegistry } from "../media/media-registry.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { llm } from "../llm/client.js";
import type { BlueprintSection } from "../agents/page-composer-agent.js";

export const MAX_VISION_RETRIES = 1;

export interface VisionQaBundle {
  passed: boolean;
  issues: QAResult["issues"];
}

export async function buildAndVisionQa(
  ctx: SiteContext,
  previewPath: string,
  pageSlug = "home"
): Promise<VisionQaBundle> {
  const file =
    pageSlug === "home"
      ? path.join(previewPath, "index.html")
      : path.join(previewPath, pageSlug, "index.html");
  const html = await fs.readFile(file, "utf8");
  const shots = await screenshotPageDual(html);
  const manifest = await extractBlockManifest(html);
  const vision = await runVisionQa(
    shots.desktop,
    pageSlug,
    manifest,
    ctx.designSystem,
    shots.mobile
  );
  const hard = vision.issues.filter((i) => i.severity === "hard");
  return { passed: hard.length === 0, issues: vision.issues };
}

export async function regenerateReactPreview(
  ctx: SiteContext,
  reactPages: Record<string, ReactPage>,
  outputDir: string,
  options: { previewBasePath?: string } = {}
): Promise<{ previewPath: string; buildSucceeded: boolean }> {
  const { projectPath } = await generateReactProject(ctx, reactPages, outputDir, {
    basePath: options.previewBasePath,
  });
  try {
    const previewPath = await buildReactProject(projectPath);
    return { previewPath, buildSucceeded: true };
  } catch {
    return { previewPath: projectPath, buildSucceeded: false };
  }
}

function findBlueprintSection(
  blueprints: PageBlueprint[],
  sectionId: string
): { blueprint: PageBlueprint; section: BlueprintSection } | null {
  for (const blueprint of blueprints) {
    const section = blueprint.sections.find((s) => s.id === sectionId);
    if (section) return { blueprint, section };
  }
  return null;
}

function reattachMotionAll(
  reactPages: Record<string, ReactPage>,
  ctx: SiteContext
): void {
  if (!ctx.motionPlan) return;
  for (const page of Object.values(reactPages)) {
    page.sections = attachMotionPlan(page.sections, ctx.motionPlan);
  }
}

function mergeLayoutIntoProps(
  ctx: SiteContext,
  props: Record<string, unknown>,
  sectionId: string
): Record<string, unknown> {
  const spec = ctx.layoutPlan?.sections[sectionId];
  if (!spec) return props;
  return { ...props, ...layoutSpecToProps(spec) };
}

export async function applyVisionFixPlan(
  ctx: SiteContext,
  plan: VisionFixPlan,
  blueprints: PageBlueprint[],
  reactPages: Record<string, ReactPage>,
  registry: MediaRegistry
): Promise<string[]> {
  const applied: string[] = [];

  if (plan.design) {
    ctx.designSystem = await refineDesignSystem(
      ctx.businessName,
      ctx.expandedBrief.expandedBrief,
      ctx.designSystem,
      profileCoherenceFromContext(ctx)
    );
    applied.push("design");
    pipelineLog("[pipeline] Vision retry: design refine applied");
  }

  if (plan.motion) {
    ctx.motionPlan = await directMotionPlan(ctx, blueprints);
    reattachMotionAll(reactPages, ctx);
    applied.push("motion");
    pipelineLog("[pipeline] Vision retry: motion plan refreshed");
  }

  if (plan.chrome) {
    ctx.chromeSpec = await directChromeSpec(ctx, blueprints);
    applied.push("chrome");
    pipelineLog("[pipeline] Vision retry: chrome spec refreshed");
  }

  const layoutFixes = plan.sections.filter((s) => s.domain === "layout");
  if (layoutFixes.length > 0) {
    applyLayoutFixes(ctx, layoutFixes);
    applied.push("layout");
  }

  for (const fix of plan.sections) {
    const found = findBlueprintSection(blueprints, fix.sectionId);
    if (!found) continue;

    const { blueprint, section } = found;
    const page = reactPages[blueprint.slug];
    if (!page) continue;

    if (fix.domain === "copy" || fix.domain === "layout") {
      const instance = await fillSectionProps(ctx, blueprint.slug, section, registry);
      const idx = page.sections.findIndex((s) => s.id === fix.sectionId);
      if (idx >= 0) {
        const existing = page.sections[idx];
        let customCodegen = existing?.customCodegen;
        if (customCodegen && fix.domain === "copy") {
          const regen = await generateCustomHeroSection(ctx, instance);
          if (regen) customCodegen = regen;
        }
        page.sections[idx] = {
          ...instance,
          customCodegen,
          props: mergeLayoutIntoProps(ctx, instance.props, fix.sectionId),
          layoutSpec: ctx.layoutPlan?.sections[fix.sectionId],
        };
      }
      applied.push(`${fix.domain}:${fix.sectionId}`);
    }
  }

  if (plan.design || plan.motion) {
    reattachMotionAll(reactPages, ctx);
  }

  return applied;
}

export async function runVisionRetryLoop(
  ctx: SiteContext,
  reactPages: Record<string, ReactPage>,
  blueprints: PageBlueprint[],
  registry: MediaRegistry,
  previewPath: string,
  outputDir: string,
  initialIssues: QAResult["issues"],
  options: { previewBasePath?: string } = {}
): Promise<{ qa: VisionQaBundle; applied: string[]; previewPath: string; buildSucceeded: boolean } | null> {
  if (!llm.supportsVision) return null;

  const hard = initialIssues.filter((i) => i.severity === "hard");
  if (hard.length === 0) return null;

  const plan = routeVisionIssues(hard, "home");
  if (!visionFixPlanHasWork(plan)) return null;

  pipelineLog(
    `[pipeline] Vision retry: routing ${hard.length} issue(s) → design=${plan.design} motion=${plan.motion} chrome=${plan.chrome} sections=${plan.sections.length}`
  );

  const applied = await applyVisionFixPlan(ctx, plan, blueprints, reactPages, registry);
  const { previewPath: newPreview, buildSucceeded } = await regenerateReactPreview(
    ctx,
    reactPages,
    outputDir,
    options
  );

  if (!buildSucceeded) {
    return { qa: { passed: false, issues: initialIssues }, applied, previewPath, buildSucceeded: false };
  }

  const retryQa = await buildAndVisionQa(ctx, newPreview, "home");
  return { qa: retryQa, applied, previewPath: newPreview, buildSucceeded: true };
}
