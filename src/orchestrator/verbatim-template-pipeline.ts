/** Verbatim third-party templates → static HTML pages. No skin, no design system, no React build. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { QAIssue, QAResult, SiteContext } from "../types.js";
import { extractTemplateSectionManifestFromUrl, runCodeQA, type BlockManifestEntry } from "../qa/code-qa.js";
import { timedStep } from "../util/timed.js";
import { pipelineLog, updatePipelineContext } from "../util/pipeline-log.js";
import { composeSite, pageFileName, type FileCopy } from "../templates/compose.js";
import { selectSiteSections } from "../templates/select.js";
import { polishComposedCopy } from "../agents/copy-polish-agent.js";
import { repairFlaggedSections } from "../agents/section-repair-agent.js";
import { recordGeneration, type GenerationRecord } from "../templates/generation-store.js";
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
  generation: GenerationRecord;
  /** Everything an edit needs to recompose this exact site without re-running selection: the
   *  brief, the placed sections, the palette/logo it was rendered with, and the theme lock. Kept
   *  on the result (and on the editor session) because selection is seeded and history-aware —
   *  re-deriving it would not reproduce the same site. */
  state: VerbatimSiteState;
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

  // Compulsory LLM copy-polish pass: the deterministic compose above never calls an LLM at all
  // (see `compose.ts`'s own module comment) — this is the LLM copy step, and its accepted output
  // is what actually ships (recomposed below), not an optional enhancement that can be silently
  // dropped. See `copy-polish-agent.ts` for the strict/degrade semantics.
  const polish = await timedStep("site", "copy polish", () =>
    polishComposedCopy(ctx.expandedBrief, composed.htmlPages)
  );
  state.overrides = polish.overrides;

  let finalComposed =
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
            // text an override targets, never re-roll imagery (stock lookups are seeded and would
            // return the same URL anyway, but a user's own uploaded photo is taken from the
            // registry once and must not be silently replaced by stock on a second pass).
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
        overrides: { ...polish.overrides, ...repairOverrides },
        photos: finalComposed.photos,
        ...(options.editable ? { editable: true } : {}),
      })
    );
    finalComposed = repaired;
    state.overrides = { ...polish.overrides, ...repairOverrides };
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

  const generation = await recordGeneration({
    businessName: ctx.expandedBrief.businessName,
    rawBrief: ctx.businessBrief,
    ...(options.consumerId ? { consumerId: options.consumerId } : {}),
    ...(selected.theme ? { theme: selected.theme } : {}),
    ...(selected.themeConfidence ? { themeConfidence: selected.themeConfidence } : {}),
    ...(selected.taxonomy ? { taxonomy: selected.taxonomy } : {}),
    composed: finalComposed,
  });
  const themeLabel = selected.theme
    ? ` (${selected.theme}-theme mix${selected.themeConfidence === "partial-fallback" ? ", some sections theme-unknown" : ""})`
    : "";
  pipelineLog(`[pipeline] Generation logged: ${generation.id}${themeLabel}`);

  return {
    htmlPages: finalComposed.htmlPages,
    qaResults,
    blockManifests,
    files: finalComposed.files,
    pages: selected.pages,
    templateIds: selected.templateIds,
    ...(selected.anchorTemplateId ? { anchorTemplateId: selected.anchorTemplateId } : {}),
    generation,
    state,
  };
}
