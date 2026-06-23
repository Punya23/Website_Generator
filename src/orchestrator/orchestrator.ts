import type { ContentBlock, GenerationResult, PageSpec, QAResult, SitePlan, SiteTheme } from "../types.js";
import type { ExpandedBrief } from "../types.js";
import { generateContent } from "../agents/content-agent.js";
import { composeLayout } from "../agents/composition-agent.js";
import { expandBrief } from "../agents/expand-brief-agent.js";
import { planSite, getPagePlan } from "../agents/site-planner-agent.js";
import { generateTheme } from "../agents/theme-agent.js";
import { applyFixes, applyContentPatches } from "../agents/fix-agent.js";
import { enrichContentWithImages, sanitizeContentBlocks } from "../media/enrich-content.js";
import { scheduleVisionPolish } from "../agents/vision-agent.js";
import { renderSite } from "../renderer/render.js";
import { runCodeQA, screenshotPage, closeQABrowser } from "../qa/code-qa.js";
import { llm } from "../llm/client.js";
import { timedStep } from "../util/timed.js";

const MAX_QA_RETRIES = 2;

export interface GenerateSiteOptions {
  businessName?: string;
  businessBrief: string;
  onPreviewReady?: (result: Partial<GenerationResult>) => void;
  enableVisionPolish?: boolean;
}

export interface PagePipelineResult {
  spec: PageSpec;
  html: string;
  qa: QAResult;
  retries: number;
}

async function runPagePipeline(
  expanded: ExpandedBrief,
  sitePlan: SitePlan,
  theme: SiteTheme,
  pageSlug: string,
  pageTitle: string
): Promise<PagePipelineResult> {
  const pagePlan = getPagePlan(sitePlan, pageSlug)!;
  const briefText = expanded.expandedBrief;

  let content = enrichContentWithImages(
    sanitizeContentBlocks(
      await timedStep(pageSlug, "content", () => generateContent(expanded, pagePlan))
    ),
    pageSlug as "home",
    expanded.businessName,
    briefText,
    theme
  );
  let layout = await timedStep(pageSlug, "composition", () =>
    composeLayout(content, pagePlan, expanded, sitePlan)
  );
  let html = "";
  let qa: QAResult = { passed: false, issues: [] };
  let retries = 0;

  const singlePage = [{ slug: pageSlug, title: pageTitle, content, layout }];

  for (let attempt = 0; attempt <= MAX_QA_RETRIES; attempt++) {
    html = renderSite(expanded.businessName, briefText, theme, singlePage, sitePlan.visualArchetype)[pageSlug]!;

    qa = await timedStep(pageSlug, `QA${attempt > 0 ? ` retry ${attempt}` : ""}`, () =>
      runCodeQA(html, pageSlug)
    );

    if (qa.passed) break;

    retries = attempt + 1;
    if (attempt >= MAX_QA_RETRIES) break;

    const fix = await timedStep(pageSlug, "fix layout", () =>
      applyFixes(layout, content, qa.issues, briefText, pageSlug)
    );
    layout = fix.layout;
    content = enrichContentWithImages(
      applyContentPatches(content, fix.contentPatches),
      pageSlug as "home",
      expanded.businessName,
      briefText,
      theme
    );
  }

  return {
    spec: { slug: pageSlug, title: pageTitle, content, layout },
    html,
    qa,
    retries,
  };
}

export async function generateSite(options: GenerateSiteOptions): Promise<GenerationResult> {
  const start = Date.now();

  const expanded = await expandBrief(options.businessBrief, options.businessName);
  console.log("[pipeline] Expanding brief… done");
  const [sitePlan, theme] = await Promise.all([
    planSite(expanded),
    generateTheme(expanded.businessName, expanded.expandedBrief, options.businessBrief),
  ]);
  console.log(`[pipeline] Site plan + theme ready (${sitePlan.pages.length} pages)`);

  const pageResults =
    llm.provider === "groq"
      ? await runPagesSequentially(expanded, sitePlan, theme)
      : await Promise.all(
          sitePlan.pages.map((p) =>
            runPagePipeline(expanded, sitePlan, theme, p.slug, p.title)
          )
        );

  const pages: PageSpec[] = pageResults.map((r) => r.spec);
  const htmlPages: Record<string, string> = {};
  const qaResults: Record<string, QAResult> = {};

  const navPages = pages.map((p) => ({
    slug: p.slug,
    title: p.title,
    content: p.content,
    layout: p.layout,
  }));

  const mergedHtml = renderSite(
    expanded.businessName,
    expanded.expandedBrief,
    theme,
    navPages,
    sitePlan.visualArchetype
  );
  for (const [slug, html] of Object.entries(mergedHtml)) {
    htmlPages[slug] = html;
  }

  options.onPreviewReady?.({
    site: {
      businessName: expanded.businessName,
      businessBrief: options.businessBrief,
      expandedBrief: expanded,
      sitePlan,
      theme,
      pages,
    },
    htmlPages,
    timingMs: Date.now() - start,
  });

  for (const r of pageResults) {
    qaResults[r.spec.slug] = r.qa;
  }

  if (process.env.SKIP_MERGED_QA !== "1") {
    for (const slug of Object.keys(htmlPages)) {
      if (slug === "index") continue;
      if (qaResults[slug]) continue;
      qaResults[slug] = await runCodeQA(htmlPages[slug]!, slug);
    }
  }

  const timingMs = Date.now() - start;

  const result: GenerationResult = {
    site: {
      businessName: expanded.businessName,
      businessBrief: options.businessBrief,
      expandedBrief: expanded,
      sitePlan,
      theme,
      pages,
    },
    htmlPages,
    qaResults,
    timingMs,
    visionPolish: { status: "pending", issues: [], appliedFixes: [] },
  };

  if (options.enableVisionPolish !== false) {
    scheduleVisionPolish(
      async () => {
        const shots: { slug: string; base64: string }[] = [];
        for (const [slug, html] of Object.entries(htmlPages)) {
          if (slug === "index") continue;
          shots.push({ slug, base64: await screenshotPage(html) });
        }
        return shots;
      },
      (visionResults) => {
        result.visionPolish = {
          status: "complete",
          issues: Object.values(visionResults).flatMap((v) => v.issues),
          appliedFixes: Object.entries(visionResults).flatMap(([slug, v]) =>
            v.appliedFixes.map((f) => `[${slug}] ${f}`)
          ),
        };
      }
    );
  } else {
    result.visionPolish = { status: "skipped", issues: [], appliedFixes: [] };
  }

  await closeQABrowser();
  return result;
}

async function runPagesSequentially(
  expanded: ExpandedBrief,
  sitePlan: SitePlan,
  theme: SiteTheme
): Promise<PagePipelineResult[]> {
  const results: PagePipelineResult[] = [];
  console.log(`[pipeline] ${sitePlan.pages.length} pages planned: ${sitePlan.pages.map((p) => p.slug).join(", ")}`);
  for (const page of sitePlan.pages) {
    results.push(
      await runPagePipeline(expanded, sitePlan, theme, page.slug, page.title)
    );
    console.log(`[pipeline] ✓ ${page.slug} complete`);
  }
  return results;
}

export async function waitForVisionPolish(
  result: GenerationResult,
  timeoutMs = 60_000
): Promise<GenerationResult> {
  const start = Date.now();
  while (
    result.visionPolish?.status === "pending" &&
    Date.now() - start < timeoutMs
  ) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return result;
}

export function summarizeGeneration(result: GenerationResult): string {
  const blockCount = result.site.pages.reduce((n, p) => n + p.content.length, 0);
  const lines = [
    `Generated "${result.site.businessName}" in ${(result.timingMs / 1000).toFixed(1)}s`,
    `Strategy: ${result.site.sitePlan.compositionStrategy}`,
    `Theme: ${result.site.theme.vertical} · ${result.site.theme.mood}`,
    `Pages (${result.site.pages.length}): ${result.site.pages.map((p) => `${p.slug} (${p.content.length} blocks)`).join(", ")}`,
    `Total content blocks: ${blockCount}`,
  ];

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
