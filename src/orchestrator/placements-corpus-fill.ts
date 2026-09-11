/**
 * Phase 2B of `docs/PLACEMENTS_ORCHESTRATION_PLAN.md`: the placements engine applied to a
 * corpus-selected composition instead of a hand-mapped `real-estate/*` template. Same engine
 * (`fill.ts`/`llm-view.ts`), same prompt/schema (`fillPlacementsFile`, shared with the curated
 * path so the two never drift), different `PlacementsFile` producer (`from-corpus.ts`'s
 * `buildPlacementsFromSelection` instead of a hand-authored `placements.json`).
 *
 * Replaces `polishComposedCopy` for a site this runs on — do not run both. Polish rewrites
 * arbitrary text runs across the composed HTML and, when it has any edits, recomposes with them as
 * `overrides`; that recompose has no idea a placements fill already wrote real per-business copy
 * into the same nodes and would silently revert it. See `verbatim-template-pipeline.ts`'s call
 * site for the branch.
 *
 * nav/footer sections are excluded before `buildPlacementsFromSelection` is even called, not
 * filtered out afterward — see `from-corpus.ts`'s `excludeChromeSections` (moved there so
 * `templates/revise.ts`'s `reapplyPlacementsFill` replay path can share the same exclusion without
 * `templates/` importing from `orchestrator/`). The Phase 2A spike (`scripts/spike-corpus-
 * placements.ts`, run against the real 910-template cache) measured 100% selector hit rate on body
 * sections but only 86.2% once nav/footer were included — every miss was one of the two, because
 * `compose.ts` deliberately rebuilds both regardless of what a placement would have written.
 *
 * Edit/recompose parity (`VerbatimSiteState.placementsFill` + `from-corpus.ts`'s
 * `reapplyPlacementsFill`) and corpus-side brand-leak detection (`brand-leak.ts`'s
 * `collectTemplateBrandNames`/`checkBrandLeakAgainst`, wired into `verbatim-template-pipeline.ts`'s
 * QA loop) are both built — see those modules. This file's own job stays narrow: run ONE fresh LLM
 * fill and apply it, via the same `applyPlacementsFillToPages` a recompose's replay also uses.
 */
import type { PlacedSection } from "../templates/types.js";
import type { TemplateStore } from "../templates/store.js";
import {
  applyPlacementsFillToPages,
  buildPlacementsFromSelection,
  excludeChromeSections,
  type CorpusPlacementsMeta,
  type PlacementsFillPageResult,
} from "../templates/placements/from-corpus.js";
import { fillPlacementsFile, type Locale } from "../templates/placements/fill-real-estate-template.js";
import type { ClampNote, PlacementBrief } from "../templates/placements/fill.js";
import type { BusinessDataFeed } from "../templates/placements/business-data.js";
import { businessDataResolver } from "../templates/placements/business-data.js";

/** Preserved name/shape for existing importers (`verbatim-template-pipeline.ts`) — the real
 *  definition now lives in `from-corpus.ts` as `PlacementsFillPageResult`, shared with the replay
 *  path (`reapplyPlacementsFill`) so both report the same breakdown. */
export type CorpusPlacementsPageResult = PlacementsFillPageResult;

export interface CorpusPlacementsFillResult {
  /** Every page from `htmlPages`, placements-filled where a page had a body section to fill —
   *  unioned with `pageOrder` this way so an anchor's `[data-tpl]`-tagged chrome, drawn from
   *  whatever the anchor's OWN section already contributes to `htmlPages`, ships unaffected. */
  htmlPages: Record<string, string>;
  appliedText: number;
  appliedImages: number;
  /** Placement ids whose selector did not resolve — markup drift, not "nothing to fill". The 2A
   *  spike measured this at 0 once nav/footer are excluded; a nonzero count here on a real run is
   *  worth investigating, not expected. */
  skipped: string[];
  clamped: ClampNote[];
  /** Same three numbers, keyed by page slug — only pages this fill actually touched appear here. */
  byPage: Record<string, CorpusPlacementsPageResult>;
  /** Every `ImagePlacement.id` this fill actually wrote, mapped to the final URL —
   *  `verbatim-template-pipeline.ts` turns this into a `composed.photos` patch (via `from-corpus.ts`'s
   *  `composePhotoKey`) so a later recompose keeps the SAME photo instead of reverting to
   *  compose.ts's own generic stock pick for that slot. */
  appliedImageUrls: Record<string, string>;
  /** Everything needed to REPLAY this exact fill later with no new LLM call — persisted verbatim
   *  onto `VerbatimSiteState.placementsFill` by the caller. See `from-corpus.ts`'s
   *  `PersistedPlacementsFill` and `reapplyPlacementsFill`. */
  brief: PlacementBrief;
  locale: Locale;
  llmValues: Record<string, string>;
  illustrativeValues: Record<string, string>;
}

/**
 * Builds a `PlacementsFile` from `selected` (excluding chrome — see module doc comment), fills it
 * for `rawBrief` with ONE fresh LLM pass, and applies the result onto `htmlPages` (`composeSite`'s
 * own output — this is meant to run AFTER compose, replacing the LLM copy-polish step that would
 * otherwise run next).
 *
 * A page with no body sections at all (only nav/hero/footer, say) or with no HTML in `htmlPages`
 * ships unchanged — this only ever adds real per-business copy on top of what compose already
 * produced, never removes a page.
 *
 * `businessData`, when given, resolves `data`-sourced placements (a real listing, an agent's real
 * name/photo, a real customer testimonial) from the business's own supplied records instead of
 * leaving them to `illustrativeFill`'s plausible example — see `business-data.ts`. Omitted, behavior
 * is byte-identical to before this option existed.
 */
export async function runCorpusPlacementsFill(
  selected: { pages: Record<string, PlacedSection[]> },
  store: TemplateStore,
  meta: CorpusPlacementsMeta,
  htmlPages: Record<string, string>,
  rawBrief: string,
  onProgress?: (line: string) => void,
  businessData?: BusinessDataFeed
): Promise<CorpusPlacementsFillResult> {
  const file = await buildPlacementsFromSelection({ pages: excludeChromeSections(selected.pages) }, store, meta);
  const fill = await fillPlacementsFile(file, rawBrief, { onProgress });

  // No `templateBusinessName` here — that option exists to swap ONE known fictional demo brand
  // (a hand-mapped real-estate/* skin's own "Prestige Realty") out of fallback text. A corpus
  // composition can draw its sections from several different source templates, each with its own
  // demo brand, so there is no single name to pass; corpus-side brand-leak detection instead runs
  // as its own generic post-fill check — see `brand-leak.ts`'s `collectTemplateBrandNames`.
  const result = await applyPlacementsFillToPages(file, fill, htmlPages, {
    ...(businessData ? { resolveData: businessDataResolver(businessData) } : {}),
  });

  return {
    htmlPages: result.htmlPages,
    appliedText: result.appliedText,
    appliedImages: result.appliedImages,
    skipped: result.skipped,
    clamped: result.clamped,
    byPage: result.byPage,
    appliedImageUrls: result.appliedImageUrls,
    brief: fill.brief,
    locale: fill.locale,
    llmValues: fill.llmValues,
    illustrativeValues: fill.illustrativeValues,
  };
}
