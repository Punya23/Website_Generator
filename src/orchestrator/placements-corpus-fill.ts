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
 * filtered out afterward. The Phase 2A spike (`scripts/spike-corpus-placements.ts`, run against
 * the real 910-template cache) measured 100% selector hit rate on body sections but only 86.2%
 * once nav/footer were included — every miss was one of the two, because `compose.ts` deliberately
 * rebuilds both regardless of what a placement would have written: `rewriteNavLinks` replaces every
 * `<li>` in the primary menu with one built from this site's own pages, and a logo `<img>` becomes a
 * `<span class="tpl-wordmark">` text node when no logo was uploaded. Chrome copy is compose-owned;
 * asking placements to fill it is 14 points of guaranteed skip for nothing.
 *
 * Known gap (matches `placements-pipeline.ts`'s own documented gap for the curated path): the
 * result here is written straight into `composed.htmlPages`, never through `composeSite`'s
 * `overrides` mechanism — so `VerbatimSiteState.overrides` stays empty for a placements-filled
 * site, and a later edit/recompose session would rebuild from `compose.ts`'s own deterministic
 * copy-slots pass with no placements copy at all. Not a regression (the curated path has the
 * analogous gap already), but real — revise/edit parity is not in this phase's scope.
 */
import type { PlacedSection } from "../templates/types.js";
import type { TemplateStore } from "../templates/store.js";
import { buildPlacementsFromSelection, type CorpusPlacementsMeta } from "../templates/placements/from-corpus.js";
import { fillPlacementsFile } from "../templates/placements/fill-real-estate-template.js";
import { applyPlacements, type ClampNote } from "../templates/placements/fill.js";

/** Sections `compose.ts` rebuilds unconditionally regardless of what a placement would write —
 *  see this module's own doc comment and the Phase 2A spike for the measured cost of not excluding
 *  them. Keep in sync with `compose.ts`'s `rewriteNavLinks`/logo-wordmark call sites (`role ===
 *  "nav"` / `role === "footer"`), not with any placements-side concept. */
const CHROME_ROLES = new Set(["nav", "footer"]);

function excludeChromeSections(pages: Record<string, PlacedSection[]>): Record<string, PlacedSection[]> {
  const out: Record<string, PlacedSection[]> = {};
  for (const [slug, sections] of Object.entries(pages)) {
    out[slug] = sections.filter((section) => !CHROME_ROLES.has(section.role));
  }
  return out;
}

/** One page's own fill outcome — the per-page breakdown `verbatim-template-pipeline.ts` needs to
 *  attach a skipped/clamped note to the RIGHT page's `QAResult`, not just log a site-wide total
 *  (Phase 4, docs/PLACEMENTS_ORCHESTRATION_PLAN.md: "skipped-selector count surfaced"). */
export interface CorpusPlacementsPageResult {
  appliedText: number;
  appliedImages: number;
  skipped: string[];
  clamped: ClampNote[];
}

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
}

/**
 * Builds a `PlacementsFile` from `selected` (excluding chrome — see module doc comment), fills it
 * for `rawBrief`, and applies the result onto `htmlPages` (`composeSite`'s own output — this is
 * meant to run AFTER compose, replacing the LLM copy-polish step that would otherwise run next).
 *
 * A page with no body sections at all (only nav/hero/footer, say) or with no HTML in `htmlPages`
 * ships unchanged — this only ever adds real per-business copy on top of what compose already
 * produced, never removes a page.
 */
export async function runCorpusPlacementsFill(
  selected: { pages: Record<string, PlacedSection[]> },
  store: TemplateStore,
  meta: CorpusPlacementsMeta,
  htmlPages: Record<string, string>,
  rawBrief: string,
  onProgress?: (line: string) => void
): Promise<CorpusPlacementsFillResult> {
  const file = await buildPlacementsFromSelection(
    { pages: excludeChromeSections(selected.pages) },
    store,
    meta
  );
  const fill = await fillPlacementsFile(file, rawBrief, { onProgress });
  const illustrativeFill = async (placement: { id: string }) => fill.illustrativeValues[placement.id] ?? null;

  const out: Record<string, string> = { ...htmlPages };
  let appliedText = 0;
  let appliedImages = 0;
  const skipped: string[] = [];
  const clamped: ClampNote[] = [];
  const byPage: Record<string, CorpusPlacementsPageResult> = {};

  for (const slug of file.pageOrder) {
    const pageSet = file.pages[slug];
    const html = htmlPages[slug];
    if (!pageSet || pageSet.text.length + pageSet.images.length === 0 || !html) continue;

    // No `templateBusinessName` here — that option exists to swap ONE known fictional demo brand
    // (a hand-mapped real-estate/* skin's own "Prestige Realty") out of fallback text. A corpus
    // composition can draw its sections from several different source templates, each with its own
    // demo brand, so there is no single name to pass; a generic multi-brand detector for the
    // corpus path is still an open item — Phase 3 (landed) only built the curated path's
    // fixed-name checker (`brand-leak.ts`), which doesn't fit a composition with no single brand.
    const result = await applyPlacements(html, pageSet, {
      brief: fill.brief,
      llmValues: fill.llmValues,
      illustrativeFill,
      placeholderPhone: fill.locale.phoneFormat,
    });
    out[slug] = result.html;
    appliedText += result.appliedText;
    appliedImages += result.appliedImages;
    skipped.push(...result.skipped);
    clamped.push(...result.clamped);
    byPage[slug] = {
      appliedText: result.appliedText,
      appliedImages: result.appliedImages,
      skipped: result.skipped,
      clamped: result.clamped,
    };
  }

  return { htmlPages: out, appliedText, appliedImages, skipped, clamped, byPage };
}
