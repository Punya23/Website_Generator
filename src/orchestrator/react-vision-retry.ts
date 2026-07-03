import type { PageBlueprint, QAResult, ReactPage, SiteContext } from "../types.js";
import { refineDesignSystem } from "../agents/design-refine-agent.js";
import { profileCoherenceFromContext } from "../theme/profile-coherence.js";
import { directMotionPlan } from "../agents/motion-director-agent.js";
import { directChromeSpec } from "../agents/chrome-director-agent.js";
import { fillSectionProps } from "../agents/section-props-agent.js";
import { generateBespokeSection } from "../agents/section-codegen-agent.js";
import { applyLayoutFixes, layoutSpecToProps } from "../agents/layout-fix-agent.js";
import { attachMotionPlan } from "../agents/contracts/index.js";
import { generateReactProject, buildReactProject } from "../react-codegen/assemble-project.js";
import { startReactPreviewServer } from "../react-codegen/react-preview-server.js";
import { screenshotUrlDual, extractBlockManifestFromUrl } from "../qa/code-qa.js";
import { runVisionQa } from "../agents/vision-agent.js";
import { routeVisionIssues, visionFixPlanHasWork, type VisionFixPlan } from "../qa/vision-router.js";
import { MediaRegistry } from "../media/media-registry.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { llm } from "../llm/client.js";
import type { BlueprintSection } from "../agents/page-composer-agent.js";

export interface VisionQaBundle {
  passed: boolean;
  issues: QAResult["issues"];
}

/** previewUrl is a served base URL (e.g. from startReactPreviewServer) — screenshotting must
 *  navigate to a real URL rather than page.setContent() raw HTML, since the static export
 *  references CSS/JS via root-relative paths that only resolve against a real origin. */
export async function buildAndVisionQa(
  ctx: SiteContext,
  previewUrl: string,
  pageSlug = "home"
): Promise<VisionQaBundle> {
  const base = previewUrl.endsWith("/") ? previewUrl : `${previewUrl}/`;
  const url = pageSlug === "home" ? base : `${base}${pageSlug}/`;
  const [shots, manifest] = await Promise.all([screenshotUrlDual(url), extractBlockManifestFromUrl(url)]);
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
): Promise<{ previewPath: string; projectPath: string; buildSucceeded: boolean }> {
  const { projectPath } = await generateReactProject(ctx, reactPages, outputDir, {
    basePath: options.previewBasePath,
  });
  try {
    const previewPath = await buildReactProject(projectPath);
    return { previewPath, projectPath, buildSucceeded: true };
  } catch {
    return { previewPath: projectPath, projectPath, buildSucceeded: false };
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

    if (fix.domain === "copy" || fix.domain === "layout" || fix.domain === "regen") {
      const instance = await fillSectionProps(ctx, blueprint.slug, section, registry);
      const idx = page.sections.findIndex((s) => s.id === fix.sectionId);
      if (idx >= 0) {
        const existing = page.sections[idx];
        let customCodegen = existing?.customCodegen;
        if ((customCodegen && fix.domain === "copy") || fix.domain === "regen") {
          const regen = await generateBespokeSection(ctx, instance);
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

export function mergeFixPlans(plans: VisionFixPlan[]): VisionFixPlan {
  return {
    design: plans.some((p) => p.design),
    motion: plans.some((p) => p.motion),
    chrome: plans.some((p) => p.chrome),
    sections: plans.flatMap((p) => p.sections),
  };
}

/** One retry round covering every flagged page in a single fix-apply + rebuild, instead of a
 *  separate rebuild per page. A full `next build` static-exports every page regardless of which
 *  one triggered it, so retrying page-by-page just repeats the same rebuild cost N times for
 *  no benefit — this batches all pages' issues into one round. */
export async function runSiteVisionRetryLoop(
  ctx: SiteContext,
  reactPages: Record<string, ReactPage>,
  blueprints: PageBlueprint[],
  registry: MediaRegistry,
  outputDir: string,
  pageIssues: Map<string, QAResult["issues"]>,
  options: { previewBasePath?: string } = {}
): Promise<{ applied: string[]; previewPath: string; previewUrl: string | null; buildSucceeded: boolean } | null> {
  if (!llm.supportsVision) return null;

  const plans: VisionFixPlan[] = [];
  let hardCount = 0;
  for (const [pageSlug, issues] of pageIssues) {
    const hard = issues.filter((i) => i.severity === "hard");
    if (hard.length === 0) continue;
    hardCount += hard.length;
    plans.push(routeVisionIssues(hard, pageSlug));
  }
  if (plans.length === 0) return null;

  const merged = mergeFixPlans(plans);
  if (!visionFixPlanHasWork(merged)) return null;

  pipelineLog(
    `[pipeline] Vision retry: routing ${hardCount} issue(s) across ${plans.length} page(s) → design=${merged.design} motion=${merged.motion} chrome=${merged.chrome} sections=${merged.sections.length}`
  );

  const applied = await applyVisionFixPlan(ctx, merged, blueprints, reactPages, registry);
  const { previewPath, projectPath, buildSucceeded } = await regenerateReactPreview(
    ctx,
    reactPages,
    outputDir,
    options
  );
  if (!buildSucceeded) return { applied, previewPath, previewUrl: null, buildSucceeded: false };

  const previewUrl = await startReactPreviewServer(projectPath);
  return { applied, previewPath, previewUrl, buildSucceeded: true };
}
