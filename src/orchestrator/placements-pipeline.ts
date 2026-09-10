/**
 * The real-estate placements path as an orchestrator pipeline: a hand-built template
 * (`real-estate/*`), filled via `fillRealEstateTemplate` (the same fill this project's own
 * `scripts/generate-real-site.ts` CLI uses), producing `htmlPages` in the same shape
 * `runVerbatimTemplatePipeline`/`runSkinHtmlPipeline` already do — a fixed page set owned by the
 * chosen asset, not `sitePlan` (same structural shape `runSkinHtmlPipeline` already has: a skin's
 * page set is fixed too, independent of the LLM-planned site).
 *
 * Deliberately NOT at parity with the other two pipelines yet: no vision-QA redo loop
 * (`final-vision-gate.ts`), no `recordGeneration` entry, no publish-path-specific wiring. Those are
 * real follow-ups, not oversights — see `pipeline-speed.ts`'s `usePlacementsPipeline` doc comment
 * for why this stays opt-in until they land. What IS here — `runCodeQA` per page, the same
 * `QAResult` shape every other path produces — is enough for `orchestrator.ts` to slot this in as a
 * fourth branch without special-casing the result downstream.
 */
import path from "node:path";
import type { QAResult, SiteContext } from "../types.js";
import { fillRealEstateTemplate } from "../templates/placements/fill-real-estate-template.js";
import { runCodeQA } from "../qa/code-qa.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { timedStep } from "../util/timed.js";

export const REAL_ESTATE_TEMPLATE_IDS = [
  "real-estate-agency",
  "luxury-real-estate",
  "commercial-real-estate",
  "property-management",
] as const;
export type RealEstateTemplateId = (typeof REAL_ESTATE_TEMPLATE_IDS)[number];

/** Keyword weight per sub-vertical — same shape as `skins/taxonomy.ts`'s industry scoring
 *  (strong/medium hits summed), kept local and small rather than extending that module: these four
 *  ids are sub-verticals WITHIN the one `"real-estate"` industry `classifyTaxonomy` already
 *  resolves upstream (see `orchestrator.ts`'s gate), not siblings of it, and nothing outside this
 *  file needs to classify against them. `real-estate-agency` (the generalist template) is also the
 *  fallback when nothing else scores above it — a brief that doesn't clearly signal luxury,
 *  commercial, or property-management belongs on the generalist template, not a guess. */
const SUB_VERTICAL_KEYWORDS: Record<RealEstateTemplateId, string[]> = {
  "luxury-real-estate": ["luxury", "high-end", "high end", "premier", "exclusive", "penthouse", "estate", "prestige", "waterfront", "bespoke", "elite"],
  "commercial-real-estate": ["commercial", "office space", "retail space", "industrial", "warehouse", "tenant", "cre", "investor", "lease rate", "square footage", "coworking"],
  "property-management": ["property management", "property manager", "landlord", "rental", "rent collection", "maintenance request", "hoa", "leasing office", "portfolio of properties"],
  "real-estate-agency": [],
};

/** Scores `brief` against each sub-vertical's keyword list (simple case-insensitive substring
 *  count, not `classifyTaxonomyWeighted`'s full hit-weighting — four short lists don't need it) and
 *  returns the highest-scoring id, `real-estate-agency` on a tie or an all-zero score. */
export function pickRealEstateTemplate(brief: string): RealEstateTemplateId {
  const text = brief.toLowerCase();
  let best: RealEstateTemplateId = "real-estate-agency";
  let bestScore = 0;
  for (const id of REAL_ESTATE_TEMPLATE_IDS) {
    const score = SUB_VERTICAL_KEYWORDS[id].reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/** `"index.html"` -> `"home"`, `"about.html"` -> `"about"` — the same slug convention
 *  `compose.ts`'s `pageFileName` uses in the other direction, so `htmlPages`/`qaResults` keys line
 *  up with what `ctx.pages`, publish, and the admin UI already expect from every other pipeline. */
function slugForPageFile(pageFile: string): string {
  return pageFile === "index.html" ? "home" : pageFile.replace(/\.html$/, "");
}

export interface PlacementsPipelineResult {
  templateId: RealEstateTemplateId;
  htmlPages: Record<string, string>;
  qaResults: Record<string, QAResult>;
}

export async function runPlacementsPipeline(ctx: SiteContext, businessBrief: string): Promise<PlacementsPipelineResult> {
  const templateId = pickRealEstateTemplate(businessBrief);
  const templateDir = path.resolve(process.cwd(), "real-estate", templateId);
  pipelineLog(`[pipeline] Real-estate placements — template ${templateId}`);

  const filled = await timedStep("site", "placements fill", () =>
    fillRealEstateTemplate(templateDir, businessBrief, {
      onProgress: (line) => pipelineLog(`[pipeline] placements: ${line}`),
    })
  );

  const htmlPages: Record<string, string> = {};
  const qaResults: Record<string, QAResult> = {};
  for (const [pageFile, page] of Object.entries(filled.pages)) {
    const slug = slugForPageFile(pageFile);
    htmlPages[slug] = page.html;
    qaResults[slug] = await timedStep(slug, "QA", () => runCodeQA(page.html, slug));
    ctx.pages[slug] = {
      slug,
      title: filled.file.pages[pageFile]?.title ?? slug,
      sections: [],
    };
  }

  pipelineLog(
    `[pipeline] Real-estate placements done — ${filled.llmFieldCount} copy + ${filled.exampleFieldCount} example fields, ~$${filled.costUsd.toFixed(4)}`
  );

  return { templateId, htmlPages, qaResults };
}
