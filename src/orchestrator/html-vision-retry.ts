import type { QAIssue, SiteContext } from "../types.js";
import { refineDesignSystem } from "../agents/design-refine-agent.js";
import { profileCoherenceFromContext } from "../theme/profile-coherence.js";
import { routeVisionIssues, visionFixPlanHasWork } from "../qa/vision-router.js";
import { pipelineLog } from "../util/pipeline-log.js";

/** One-shot design token refine when HTML vision QA flags contrast/nav issues. */
export async function applyHtmlVisionRetry(
  ctx: SiteContext,
  issues: QAIssue[],
  pageSlug: string
): Promise<boolean> {
  const hard = issues.filter((i) => i.severity === "hard");
  if (hard.length === 0) return false;

  const plan = routeVisionIssues(hard, pageSlug);
  if (!plan.design || !visionFixPlanHasWork(plan)) return false;

  ctx.designSystem = await refineDesignSystem(
    ctx.businessName,
    ctx.expandedBrief.expandedBrief,
    ctx.designSystem,
    profileCoherenceFromContext(ctx)
  );
  pipelineLog(`[pipeline] ${pageSlug}: HTML vision retry refined design tokens`);
  return true;
}
