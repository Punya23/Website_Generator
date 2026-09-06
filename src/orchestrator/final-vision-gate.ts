/**
 * The one whole-site, already-rendered visual QA gate. Everything that already existed before this
 * (`runVisionQa` per classic-HTML page, the react-codegen branch's own vision-retry loop) either
 * runs mid-pipeline on one page in isolation, or finishes and is judged entirely inside a branch
 * before `generateSite()` even resumes — never on the actually-final, CMS-merged, multi-page site
 * `orchestrator.ts` is about to persist and publish. This reuses the same LLM-vision-judge call
 * (`runVisionQa`) those already use — no new vision-model code — just aimed at the right screenshots
 * at the right time.
 */
import type { QAIssue, SiteTheme } from "../types.js";
import { runVisionQa } from "../agents/vision-agent.js";
import type { BlockManifestEntry } from "../qa/code-qa.js";

export interface FinalVisionPageVerdict {
  passed: boolean;
  issues: QAIssue[];
}

export interface FinalVisionVerdict {
  passed: boolean;
  hardIssueCount: number;
  perPage: Record<string, FinalVisionPageVerdict>;
}

/**
 * Judges every already-captured final-page screenshot. Pages the caller didn't screenshot (an
 * empty `screenshots` map — e.g. under `VITEST`, or a screenshot server that failed to start) are
 * simply not judged; `passed` on an empty input is `true` so an unavailable screenshot pass never
 * blocks a generation that would otherwise have shipped.
 */
export async function judgeFinalScreenshots(
  screenshots: Record<string, string>,
  designSystem: SiteTheme,
  /** Per-page structural section data, when the caller has it (the verbatim path does — see
   *  `VerbatimPipelineResult.blockManifests`). Omitted (or missing for a given page) falls back to
   *  an empty manifest, same as before this existed — issues just come back without a resolved
   *  `sectionId`, the same graceful degradation `runVisionQa` already has for that field. */
  manifests: Record<string, BlockManifestEntry[]> = {}
): Promise<FinalVisionVerdict> {
  const perPage: Record<string, FinalVisionPageVerdict> = {};

  await Promise.all(
    Object.entries(screenshots).map(async ([slug, screenshot]) => {
      const result = await runVisionQa(screenshot, slug, manifests[slug] ?? [], designSystem);
      const hardIssues = result.issues.filter((issue) => issue.severity === "hard");
      perPage[slug] = { passed: hardIssues.length === 0, issues: result.issues };
    })
  );

  const hardIssueCount = Object.values(perPage).reduce(
    (n, page) => n + page.issues.filter((issue) => issue.severity === "hard").length,
    0
  );
  const passed = Object.values(perPage).every((page) => page.passed);
  return { passed, hardIssueCount, perPage };
}

/** True when redo B is strictly better than redo A — fewer hard issues, ties keep the original
 *  (a redo that merely shuffles which pages fail is not an improvement worth discarding a working
 *  attempt for). */
export function isStrictlyBetter(candidate: FinalVisionVerdict, incumbent: FinalVisionVerdict): boolean {
  return candidate.hardIssueCount < incumbent.hardIssueCount;
}
