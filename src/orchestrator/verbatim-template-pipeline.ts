/** Verbatim third-party templates → static HTML pages. No skin, no design system, no React build. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { QAIssue, QAResult, SiteContext } from "../types.js";
import { extractTemplateSectionManifestFromUrl, runCodeQA, type BlockManifestEntry } from "../qa/code-qa.js";
import { timedStep } from "../util/timed.js";
import { pipelineLog, updatePipelineContext } from "../util/pipeline-log.js";
import { composeSite, pageFileName, type ComposedSite, type FileCopy } from "../templates/compose.js";
import { selectSiteSections } from "../templates/select.js";
import { polishComposedCopy } from "../agents/copy-polish-agent.js";
import { repairFlaggedSections } from "../agents/section-repair-agent.js";
import { runCorpusPlacementsFill } from "./placements-corpus-fill.js";
import { usePlacementsCorpusFill } from "../llm/pipeline-speed.js";
import { templateStore } from "../templates/store.js";
import type { GenerationRecord } from "../templates/generation-store.js";
import type { VerbatimSiteState } from "../templates/revise.js";
import type { PlacedSection } from "../templates/types.js";
import type { MediaRegistry } from "../media/media-registry.js";

export interface VerbatimPipelineResult {
  htmlPages: Record<string, string>;
  qaResults: Record<string, QAResult>;
  /** Stylesheets + assets the output writer must copy next to the HTML. */
  files: FileCopy[];
  /** Per-page structural section data (`[data-tpl]`/`[data-role]`/`[data-section]`, real bounding
   *  boxes) extracted during QA staging, before the staged files are cleaned up — grounds the final
   *  vision judge in what actually rendered instead of leaving it structurally blind. See
   *  `final-vision-gate.ts`. */
  blockManifests: Record<string, BlockManifestEntry[]>;
  pages: Record<string, PlacedSection[]>;
  templateIds: string[];
  /** The template every role-pick preferred for this attempt, if any qualified (`select.ts`) — a
   *  final-visual-QA redo passes this back as `excludeAnchorTemplateIds` to force a genuinely
   *  different anchor on the next attempt rather than re-deriving the same one. */
  anchorTemplateId?: string;
  /** Everything an edit needs to recompose this exact site without re-running selection: the
   *  brief, the placed sections, the palette/logo it was rendered with, and the theme lock. Kept
   *  on the result (and on the editor session) because selection is seeded and history-aware —
   *  re-deriving it would not reproduce the same site. */
  state: VerbatimSiteState;
  /** Everything `recordGeneration` (`templates/generation-store.ts`) needs — this function no
   *  longer calls it. A final-visual-QA redo runs this whole function a SECOND time for one
   *  generation request, and each call used to independently `recordGeneration` itself: when the
   *  redo did not improve and got discarded, its record was still written, orphaned, with a LATER
   *  timestamp than the one actually shipped — the admin Generations list (sorted newest-first)
   *  showed the discarded attempt above the real one. The orchestrator now collects this from
   *  whichever attempt (this one, or a redo) ends up kept, and calls `recordGeneration` exactly
   *  once per user-facing request, after that decision is final. */
  theme?: "light" | "dark";
  themeConfidence?: "confirmed" | "partial-fallback";
  taxonomy?: GenerationRecord["taxonomy"];
  composed: Pick<ComposedSite, "provenance" | "stats">;
}

/** Real files on disk with a real `file://` base for every page — required for anything that
 *  renders this HTML and needs its external stylesheets/local images to actually resolve (they
 *  never do against a bare `page.setContent()`, which leaves the document on `about:blank` with no
 *  base URL at all). Exported so screenshot capture (`orchestrator.ts`'s debug artifacts + the
 *  final vision-QA judge) can stage the exact same way `runCodeQA` already does below, instead of
 *  rendering — and judging — a page with zero CSS and zero images loaded. */
export async function stageSite(
  htmlPages: Record<string, string>,
  files: FileCopy[]
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verbatim-qa-"));
  for (const [slug, html] of Object.entries(htmlPages)) {
    await fs.writeFile(path.join(dir, pageFileName(slug)), html, "utf8");
  }
  for (const file of files) {
    const target = path.resolve(dir, file.to);
    if (!target.startsWith(dir)) continue;
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(file.from, target);
    } catch {
      // Missing vendor decoration — QA will report it as a broken asset, which is the point.
    }
  }
  return dir;
}

export async function runVerbatimTemplatePipeline(
  ctx: SiteContext,
  registry: MediaRegistry,
  options: {
    variationSeed: number | string;
    consumerId?: string;
    editable?: boolean;
    /** A final-visual-QA redo passes the failed attempt's `anchorTemplateId` here so selection is
     *  forced to consider a genuinely different anchor rather than re-deriving the same one from
     *  the same (brief, seed) pair. See `select.ts`'s `excludeAnchorTemplateIds`. */
    excludeAnchorTemplateIds?: string[];
  }
): Promise<VerbatimPipelineResult> {
  const selected = await timedStep("site", "template selection", () =>
    selectSiteSections({
      brief: ctx.expandedBrief,
      variationSeed: options.variationSeed,
      ...(options.consumerId ? { consumerId: options.consumerId } : {}),
      ...(options.excludeAnchorTemplateIds ? { excludeAnchorTemplateIds: options.excludeAnchorTemplateIds } : {}),
    })
  );

  // The orchestrator's initial pipeline-log context carries no profileId for verbatim runs (it's
  // genuinely unknown before selection). Now that selection has locked a theme, refine the
  // context so every structured log line from here on (compose, section-repair, etc.) reports the
  // real theme instead of leaving the earlier undefined/placeholder value stamped for the rest of
  // the run — this is what was previously surfacing as a hardcoded "luxury-dark" that disagreed
  // with the theme actually recorded on the generation.
  updatePipelineContext({ profileId: selected.theme ? `verbatim-${selected.theme}` : "verbatim" });
  pipelineLog(`[pipeline] Theme locked: ${selected.theme ?? "none (no dominant theme in the selected mix)"}`);
  if (selected.dynamicPages && selected.dynamicPages.length > 0) {
    pipelineLog(
      `[pipeline] Added ${selected.dynamicPages.join(", ")} page(s) — the anchor had real, distinct content for ${selected.dynamicPages.length > 1 ? "them" : "it"}`
    );
  }

  for (const [slug, sections] of Object.entries(selected.pages)) {
    pipelineLog(
      `[pipeline] ${slug}: ${sections.map((section) => `${section.role}@${section.templateId.slice(4, 10)}`).join(" → ")}`
    );
  }
  if (selected.taxonomy) {
    const { industry, category, archetype, tier, strict, widened } = selected.taxonomy;
    pipelineLog(
      `[pipeline] Brief classified ${industry} / ${category} / ${archetype} — corpus locked to tier "${tier}"` +
        `${strict ? "" : " (strict scope disabled)"}`
    );
    if (widened) {
      // Not a warning about this run so much as about the corpus: nothing in it fits this vertical.
      pipelineLog(
        `[pipeline] WARNING: no template in the corpus matches "${industry}" or its category — ` +
          `the strict taxonomy lock was broken to produce a site at all. Ingest templates for this vertical.`
      );
    }
  }
  pipelineLog(
    `[pipeline] Verbatim mix across ${selected.templateIds.length} source template(s) — markup and CSS unchanged, colors remapped`
  );

  const state: VerbatimSiteState & { photos: Record<string, string> } = {
    brief: ctx.expandedBrief,
    rawBrief: ctx.businessBrief,
    pages: selected.pages,
    overrides: {},
    photos: {},
    ...(ctx.logoSrc ? { logoSrc: ctx.logoSrc } : {}),
    ...(selected.theme ? { theme: selected.theme } : {}),
    ...(selected.anchorTemplateId ? { anchorTemplateId: selected.anchorTemplateId } : {}),
  };

  const composed = await timedStep("site", "compose", () =>
    composeSite({
      brief: ctx.expandedBrief,
      rawBrief: ctx.businessBrief,
      pages: selected.pages,
      registry,
      logoSrc: ctx.logoSrc,
      ...(selected.anchorTemplateId ? { anchorTemplateId: selected.anchorTemplateId } : {}),
      ...(options.editable ? { editable: true } : {}),
    })
  );
  pipelineLog(
    `[pipeline] ${composed.stats.sectionsPlaced} sections placed · ${composed.stats.slotsApplied} copy slots filled · ` +
      `${composed.stats.fillerRewritten} placeholder block(s) replaced · ${composed.stats.photosApplied} photo(s) resolved` +
      `${composed.stats.photosSkipped > 0 ? ` (${composed.stats.photosSkipped} skipped)` : ""} · ${composed.files.length} file(s) to copy`
  );
  if (composed.stats.selectorErrors > 0) {
    // Not "the brief had nothing to say" — the ingest-time locator no longer resolves against this
    // section's cached HTML. Worth a distinct log line: it points at a specific template to re-ingest.
    pipelineLog(
      `[pipeline] WARNING: ${composed.stats.selectorErrors} copy-slot selector(s) failed to resolve — ` +
        `ingest-time markup drift on one or more source templates. Re-ingest to fix.`
    );
  }

  // Compulsory LLM copy step: the deterministic compose above never calls an LLM at all (see
  // `compose.ts`'s own module comment) — one of the two paths below is what actually writes real
  // per-business marketing copy, not an optional enhancement that can be silently dropped.
  //
  // Read once and reused below to gate section repair too, not just this branch: repair's own
  // recompose (further down) rebuilds `htmlPages` from `selected.pages` + `overrides`, with no
  // idea placements already wrote real copy into nodes that recompose has no override for — the
  // exact same hazard `polishComposedCopy`'s recompose has, on the same mechanism. Placements fill
  // stays this generation's one and only copy pass; QA below still runs and reports issues either
  // way, only the auto-rewrite-and-recompose reaction to them is out of scope for this phase.
  const placementsFillActive = usePlacementsCorpusFill();
  let finalComposed: ComposedSite;
  if (placementsFillActive) {
    // Phase 2B (docs/PLACEMENTS_ORCHESTRATION_PLAN.md) — placements fill replaces polish entirely
    // for this site; see placements-corpus-fill.ts's own doc comment for why the two must not both
    // run. No recompose here: the result is written straight into `composed.htmlPages`, so
    // `state.overrides` stays empty (see that module's documented editor/revise gap) and
    // `composed.photos` is untouched — nothing about the deterministic compose pass changes,
    // only the text/photo VALUES placements' own applyPlacements pass overwrites.
    const placementsResult = await timedStep("site", "placements fill (corpus)", () =>
      runCorpusPlacementsFill(
        selected,
        templateStore(),
        {
          templateId: selected.anchorTemplateId ?? `corpus-${options.variationSeed}`,
          // A record label for this composition, not a fictional demo brand — a multi-template
          // corpus site has no single one to name (see placements-corpus-fill.ts's own comment on
          // why `applyPlacements` gets no `templateBusinessName` here).
          templateName: `Corpus composition (${selected.templateIds.length} template${selected.templateIds.length === 1 ? "" : "s"})`,
          vertical: selected.taxonomy?.industry ?? "general",
        },
        composed.htmlPages,
        ctx.businessBrief,
        (line) => pipelineLog(`[pipeline] Placements fill (corpus) — ${line}`)
      )
    );
    finalComposed = { ...composed, htmlPages: placementsResult.htmlPages };
    pipelineLog(
      `[pipeline] Placements fill (corpus): ${placementsResult.appliedText} text + ${placementsResult.appliedImages} image placement(s) applied` +
        `${placementsResult.skipped.length > 0 ? ` (${placementsResult.skipped.length} selector(s) skipped)` : ""}` +
        `${placementsResult.clamped.length > 0 ? ` — ${placementsResult.clamped.length} value(s) clamped` : ""}`
    );
  } else {
    const polish = await timedStep("site", "copy polish", () =>
      polishComposedCopy(ctx.expandedBrief, composed.htmlPages)
    );
    state.overrides = polish.overrides;

    finalComposed =
      Object.keys(polish.overrides).length > 0
        ? await timedStep("site", "recompose (polish)", () =>
            composeSite({
              brief: ctx.expandedBrief,
              rawBrief: ctx.businessBrief,
              pages: selected.pages,
              registry,
              logoSrc: ctx.logoSrc,
              ...(selected.anchorTemplateId ? { anchorTemplateId: selected.anchorTemplateId } : {}),
              overrides: polish.overrides,
              // Pin the images the first pass already resolved — a recompose must change only the
              // text an override targets, never re-roll imagery (stock lookups are seeded and
              // would return the same URL anyway, but a user's own uploaded photo is taken from
              // the registry once and must not be silently replaced by stock on a second pass).
              photos: composed.photos,
              ...(options.editable ? { editable: true } : {}),
            })
          )
        : composed;
    if (polish.skipped) {
      pipelineLog(`[pipeline] Copy polish skipped — no LLM provider configured`);
    } else {
      pipelineLog(`[pipeline] Copy polish: ${finalComposed.stats.editsApplied} text run(s) rewritten by the LLM`);
    }
  }

  // Pin what this render resolved so any later edit reproduces the same imagery.
  state.photos = finalComposed.photos;

  // QA needs the real files on disk: these pages link external stylesheets and images, and a
  // page checked without them reports every asset broken. Staging once also surfaces genuinely
  // missing assets, which is the failure mode that actually matters here.
  let stageDir = await stageSite(finalComposed.htmlPages, finalComposed.files);

  let qaResults: Record<string, QAResult> = {};
  let blockManifests: Record<string, BlockManifestEntry[]> = {};
  for (const [slug, html] of Object.entries(finalComposed.htmlPages)) {
    const pageUrl = pathToFileURL(path.join(stageDir, pageFileName(slug))).href;
    qaResults[slug] = await timedStep(slug, "QA", () =>
      runCodeQA(html, slug, { pageUrl, businessName: ctx.expandedBrief.businessName })
    );
    try {
      blockManifests[slug] = await extractTemplateSectionManifestFromUrl(pageUrl);
    } catch {
      // Structural grounding is a bonus for the vision judge, not a requirement — an extraction
      // failure leaves that page ungrounded (same as before this existed) rather than failing QA.
      blockManifests[slug] = [];
    }
  }

  // Section repair: two independent sources feed the same repair pass. QA names sections it
  // pattern-matched as broken (EMPTY_SECTION, UNDEFINED_LEAK, RAW_JSON_LEAK, TEMPLATE_FILLER_LEAK)
  // — but a skipped copy slot (the brief had nothing to say, so the template author's own generic
  // prose ships unchanged) is neither lorem, an address, nor a self-referential heading, so no leak
  // pattern ever catches it; `compose.ts`'s own per-section `slotsSkipped` count already knows
  // exactly which sections these are, with no pattern-matching or guessing involved. Both sources
  // are just "this section needs a real pass", so they're merged into the same repair call. One
  // repair round, bounded: the agent's own tool loop (up to 3 turns, see `section-repair-agent.ts`)
  // is where "check the fix before shipping it" happens, not a pipeline-level retry loop that could
  // re-run QA indefinitely.
  const repairOverrides: Record<string, string> = {};
  let sectionsAttempted = 0;
  // Skipped entirely when placements fill is active — see the comment above `placementsFillActive`.
  // `finalComposed.provenance` here is still `composed`'s own, computed BEFORE placements
  // overwrote anything, so its `slotsSkipped` counts would misreport sections placements already
  // filled as needing repair, and repair's recompose would discard the placements fill regardless.
  if (!placementsFillActive) {
    for (const slug of Object.keys(finalComposed.htmlPages)) {
      const qaIssues = qaResults[slug]?.issues.filter((i) => i.sectionId) ?? [];
      const skippedSlotIssues: QAIssue[] = (finalComposed.provenance[slug] ?? [])
        .filter((section) => section.slotsSkipped > 0)
        .map((section) => ({
          severity: "hard" as const,
          code: "SLOT_SKIPPED",
          message: `${section.slotsSkipped} copy slot(s) in section ${section.sectionId} left as the template's own text — the brief had nothing to say for them`,
          sectionId: section.sectionId,
        }));
      const flaggable = [...qaIssues, ...skippedSlotIssues];
      if (flaggable.length === 0) continue;
      const repair = await timedStep(slug, "section repair", () =>
        repairFlaggedSections(ctx.expandedBrief, slug, finalComposed.htmlPages[slug] ?? "", flaggable)
      );
      sectionsAttempted += repair.attempted;
      Object.assign(repairOverrides, repair.overrides);
    }
  }

  if (Object.keys(repairOverrides).length > 0) {
    pipelineLog(
      `[pipeline] Section repair: fixed ${Object.keys(repairOverrides).length}/${sectionsAttempted} flagged run(s) — recomposing and re-checking`
    );
    await fs.rm(stageDir, { recursive: true, force: true });
    const repaired = await timedStep("site", "recompose (section repair)", () =>
      composeSite({
        brief: ctx.expandedBrief,
        rawBrief: ctx.businessBrief,
        pages: selected.pages,
        registry,
        logoSrc: ctx.logoSrc,
        ...(selected.anchorTemplateId ? { anchorTemplateId: selected.anchorTemplateId } : {}),
        overrides: { ...state.overrides, ...repairOverrides },
        photos: finalComposed.photos,
        ...(options.editable ? { editable: true } : {}),
      })
    );
    finalComposed = repaired;
    state.overrides = { ...state.overrides, ...repairOverrides };
    state.photos = repaired.photos;

    stageDir = await stageSite(finalComposed.htmlPages, finalComposed.files);
    qaResults = {};
    blockManifests = {};
    for (const [slug, html] of Object.entries(finalComposed.htmlPages)) {
      const pageUrl = pathToFileURL(path.join(stageDir, pageFileName(slug))).href;
      qaResults[slug] = await timedStep(slug, "QA (post-repair)", () =>
        runCodeQA(html, slug, { pageUrl, businessName: ctx.expandedBrief.businessName })
      );
      try {
        blockManifests[slug] = await extractTemplateSectionManifestFromUrl(pageUrl);
      } catch {
        blockManifests[slug] = [];
      }
    }
  } else if (sectionsAttempted > 0) {
    pipelineLog(`[pipeline] Section repair: attempted ${sectionsAttempted} flagged run(s), none fixed`);
  }

  // "faq" is the one dynamic-page slug (see select.ts's DYNAMIC_PAGE_ROLE_PLAN) that plain
  // capitalize-the-first-letter gets wrong ("Faq" instead of "FAQ") — everything else, fixed pages
  // and "pricing"/"gallery" alike, reads fine that way.
  const pageLabel = (slug: string): string => (slug === "faq" ? "FAQ" : `${slug[0]!.toUpperCase()}${slug.slice(1)}`);
  for (const slug of Object.keys(finalComposed.htmlPages)) {
    ctx.pages[slug] = {
      slug,
      title: slug === "home" ? ctx.expandedBrief.businessName : pageLabel(slug),
      navLabel: slug === "home" ? "Home" : pageLabel(slug),
      sections: [],
    };
  }

  await fs.rm(stageDir, { recursive: true, force: true });

  return {
    htmlPages: finalComposed.htmlPages,
    qaResults,
    blockManifests,
    files: finalComposed.files,
    pages: selected.pages,
    templateIds: selected.templateIds,
    ...(selected.anchorTemplateId ? { anchorTemplateId: selected.anchorTemplateId } : {}),
    state,
    ...(selected.theme ? { theme: selected.theme } : {}),
    ...(selected.themeConfidence ? { themeConfidence: selected.themeConfidence } : {}),
    ...(selected.taxonomy ? { taxonomy: selected.taxonomy } : {}),
    composed: { provenance: finalComposed.provenance, stats: finalComposed.stats },
  };
}
