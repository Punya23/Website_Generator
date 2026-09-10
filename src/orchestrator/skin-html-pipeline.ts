/** Skin fill → static HTML pages. No Next.js, no design-council, no section-builder pipeline. */
import type { QAResult, ReactPage, SiteContext } from "../types.js";
import type { SiteSkin } from "../skins/schema.js";
import { fillSiteSkin } from "../agents/skin-fill-agent.js";
import { MediaRegistry } from "../media/media-registry.js";
import { timedStep } from "../util/timed.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { runCodeQA } from "../qa/code-qa.js";
import { reactPagesFromSkin, renderSkinHtmlSite } from "../skins/render-html-site.js";
import { SKIN_PAGE_TITLES } from "../skins/schema.js";

export interface SkinHtmlPipelineResult {
  htmlPages: Record<string, string>;
  reactPages: Record<string, ReactPage>;
  qaResults: Record<string, QAResult>;
}

export async function runSkinHtmlPipeline(
  ctx: SiteContext,
  skin: SiteSkin,
  registry: MediaRegistry
): Promise<SkinHtmlPipelineResult> {
  pipelineLog(`[pipeline] HTML site from skin ${skin.id} — templates page-to-page, no React build`);
  const filled = await timedStep("site", "skin fill", () =>
    fillSiteSkin(ctx, skin, registry, {
      enrichMedia: !process.env.VITEST,
    })
  );
  for (const [slug, list] of Object.entries(filled.instances)) {
    pipelineLog(`[pipeline] ${slug}: ${list.map((s) => s.templateId).join("→")}`);
  }
  const reactPages = reactPagesFromSkin(ctx, skin, filled.instances);
  const htmlPages = renderSkinHtmlSite(ctx, skin, filled.instances);
  const qaResults: Record<string, QAResult> = {};
  for (const slug of Object.keys(skin.pages)) {
    const html = htmlPages[slug] ?? "";
    qaResults[slug] = await timedStep(slug, "QA", () => runCodeQA(html, slug));
    ctx.pages[slug] = {
      slug,
      title: SKIN_PAGE_TITLES[slug]?.title ?? slug,
      navLabel: SKIN_PAGE_TITLES[slug]?.navLabel ?? slug,
      sections: [],
    };
  }
  ctx.reactPages = reactPages;
  return { htmlPages, reactPages, qaResults };
}
