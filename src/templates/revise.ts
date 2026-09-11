/**
 * Post-generation editing for verbatim sites.
 *
 * The existing editor (`src/editor/apply-revision.ts`) patches `SectionInstance.props` and
 * re-renders an internal template by id — it cannot touch vendored markup, which has no props and
 * no internal template id. This is the parallel path: edits are recorded against the state and the
 * site is recomposed through the exact code a first generation uses, so an edited site and a fresh
 * one are the same kind of artifact.
 *
 * Text edits address the anchors composition already emits (`data-wg-edit="<templateId>:<sectionId>#<n>"`,
 * see `anchorEditableText`) rather than slot kinds. That was a deliberate change: slot locators only
 * cover the copy ingest could classify, so a slot-keyed override could not reach the filler-pass
 * rewrites or the template text left alone on purpose — most of what someone actually wants to fix
 * in a preview. Overrides now go through `composeSite` itself, which also means they survive a
 * section swap and apply before the page is ever serialized.
 */
import { pickFrom } from "../design/variation.js";
import { classifyBriefTaxonomy } from "../skins/picker.js";
import { composeSite, type ComposedSite } from "./compose.js";
import { templateMixCompatibilityThreshold } from "./config.js";
import { fingerprintCompatibility } from "./ingest/design-fingerprint.js";
import { rankByTaxonomy, sectionKey } from "./select.js";
import { templateStore, type IndexedSection, type TemplateStore } from "./store.js";
import type { ExpandedBrief } from "../types.js";
import type { DesignFingerprint, PlacedSection, SectionRole } from "./types.js";
import { reapplyPlacementsFill, type PersistedPlacementsFill } from "./placements/from-corpus.js";

export interface VerbatimSiteState {
  brief: ExpandedBrief;
  rawBrief: string;
  pages: Record<string, PlacedSection[]>;
  /** Text edits keyed `<templateId>:<sectionId>#<ordinal>` — the address in the composed markup. */
  overrides?: Record<string, string>;
  /** Carried so a recompose reproduces the original render rather than drifting to env defaults. */
  paletteId?: string;
  logoSrc?: string;
  /** Photos this site already resolved, so an edit re-renders the same imagery instead of
   *  re-rolling it (and instead of losing the business's own uploads, which the media registry
   *  hands out once). See `ComposeOptions.photos`. */
  photos?: Record<string, string>;
  /** The site-wide original-theme lock selection applied, kept so a swap stays consistent with it. */
  theme?: "light" | "dark";
  /** The template `select.ts` locked as this site's identity — carried so every recompose (an edit,
   *  a swap, an add) keeps restyling any mixed-in section's CSS toward it (`ComposeOptions.
   *  anchorTemplateId`) instead of silently losing that pass the moment a site is edited, and so a
   *  swap/add here can gate its own candidate pool by the same compatibility check generation used. */
  anchorTemplateId?: string;
  /** Set only for a site `runVerbatimTemplatePipeline` generated with `PIPELINE_PLACEMENTS_CORPUS`
   *  active. Carried so every recompose (edit, swap, add, palette, logo) REPLAYS this exact
   *  placements fill — no new LLM call — instead of reverting to `compose.ts`'s own generic
   *  copy-slot/filler text, which is what shipped before this field existed. See
   *  `placements/from-corpus.ts`'s `reapplyPlacementsFill`, called from `composeVerbatimSite` below. */
  placementsFill?: PersistedPlacementsFill;
}

/** `<templateId>:<sectionId>` — what the preview's section wrapper carries and what every
 *  structural revision addresses. Text revisions use the same prefix plus `#<ordinal>`. */
export type SectionTarget = string;

export type VerbatimRevision =
  | { kind: "text"; target: string; value: string }
  | { kind: "swapSection"; target: SectionTarget; seed?: number | string }
  | { kind: "removeSection"; target: SectionTarget }
  | { kind: "moveSection"; target: SectionTarget; direction: "up" | "down" }
  /** Add a section of `role` to `page`, directly after `after` when given (otherwise before the
   *  footer, which is where a new band almost always belongs). */
  | { kind: "addSection"; page: string; role: SectionRole; after?: SectionTarget; seed?: number | string }
  /** Replace one resolved photo. `target` is the `<templateId>:<sectionId>#<ordinal>` key
   *  `ComposeOptions.photos`/`data-wg-photo` already use — same address, just a new URL. */
  | { kind: "photo"; target: string; value: string }
  /** Replace the business's own logo everywhere it's placed. */
  | { kind: "logo"; value: string }
  /** Recolor the whole site: a built-in palette id (`src/templates/palette.ts`) or `custom:#rrggbb`
   *  for a user-chosen brand color. */
  | { kind: "palette"; value: string };

export interface ReviseResult {
  state: VerbatimSiteState;
  site: ComposedSite;
  applied: string[];
  rejected: string[];
}

export interface ReviseOptions {
  store?: TemplateStore;
  /** Page the edit came from. Only narrows the search — a target is resolved site-wide otherwise,
   *  which is what keeps shared chrome (one nav, every page) editable from any page. */
  page?: string;
  /** Emit the in-preview editing layer in the recomposed HTML. */
  editable?: boolean;
}

/** Where a targeted section sits. Chrome is shared, so one target can resolve on several pages. */
function locate(
  state: VerbatimSiteState,
  target: SectionTarget,
  preferredPage?: string
): Array<{ slug: string; index: number; section: PlacedSection }> {
  const hits: Array<{ slug: string; index: number; section: PlacedSection }> = [];
  const slugs = Object.keys(state.pages);
  const ordered = preferredPage && state.pages[preferredPage] ? [preferredPage, ...slugs.filter((s) => s !== preferredPage)] : slugs;
  for (const slug of ordered) {
    (state.pages[slug] ?? []).forEach((section, index) => {
      if (sectionKey(section) === target) hits.push({ slug, index, section });
    });
  }
  return hits;
}

/** The site's locked original theme, read off whatever is already placed. */
function siteThemeOf(
  state: VerbatimSiteState,
  themeByKey: Map<string, "light" | "dark" | undefined>
): "light" | "dark" | undefined {
  return (
    state.theme ??
    Object.values(state.pages)
      .flat()
      .map((section) => themeByKey.get(sectionKey(section)))
      .find((theme): theme is "light" | "dark" => Boolean(theme))
  );
}

/** Apply revisions to a generated verbatim site and recompose it. */
export async function applyVerbatimRevisions(
  state: VerbatimSiteState,
  revisions: VerbatimRevision[],
  options: ReviseOptions = {}
): Promise<ReviseResult> {
  const store = options.store ?? templateStore();
  const index = await store.index();
  const next: VerbatimSiteState = {
    ...state,
    pages: Object.fromEntries(Object.entries(state.pages).map(([slug, list]) => [slug, [...list]])),
    overrides: { ...(state.overrides ?? {}) },
  };
  const applied: string[] = [];
  const rejected: string[] = [];
  const anchorFingerprint: DesignFingerprint | undefined = next.anchorTemplateId
    ? index.sections.find((section) => section.templateId === next.anchorTemplateId)?.designFingerprint
    : undefined;
  const mixThreshold = templateMixCompatibilityThreshold();
  /** Same bar generation itself gates cross-template mixing on (`select.ts`'s `pick()`) — a manual
   *  swap/add should not be able to reintroduce the exact visual clash the anchor lock prevents at
   *  generation time. The anchor's own sections always pass (nothing to compare against itself). */
  const compatibleWithAnchor = (section: IndexedSection): boolean =>
    !next.anchorTemplateId ||
    section.templateId === next.anchorTemplateId ||
    fingerprintCompatibility(anchorFingerprint, section.designFingerprint) >= mixThreshold;

  for (const revision of revisions) {
    if (revision.kind === "text") {
      const [prefix] = revision.target.split("#");
      if (!prefix || !revision.target.includes("#")) {
        rejected.push(`text: malformed target ${revision.target}`);
        continue;
      }
      next.overrides![revision.target] = revision.value;
      applied.push(`text ${revision.target}`);
      continue;
    }

    if (revision.kind === "photo") {
      next.photos = { ...(next.photos ?? {}), [revision.target]: revision.value };
      applied.push(`photo ${revision.target}`);
      continue;
    }

    if (revision.kind === "logo") {
      next.logoSrc = revision.value;
      applied.push("logo");
      continue;
    }

    if (revision.kind === "palette") {
      next.paletteId = revision.value;
      applied.push(`palette ${revision.value}`);
      continue;
    }

    if (revision.kind === "addSection") {
      const list = next.pages[revision.page];
      if (!list) {
        rejected.push(`add: unknown page ${revision.page}`);
        continue;
      }
      const themeByKey = new Map(index.sections.map((section) => [sectionKey(section), section.theme]));
      const theme = siteThemeOf(next, themeByKey);
      const alreadyHere = new Set(list.map((section) => sectionKey(section)));
      const themedPool = index.sections.filter(
        (section) =>
          section.role === revision.role &&
          !alreadyHere.has(sectionKey(section)) &&
          (!theme || !section.theme || section.theme === theme)
      );
      // Same compatibility bar generation gates cross-template mixing on — falls back to the
      // theme-only pool rather than rejecting the add outright when nothing clears it.
      const compatible = themedPool.filter(compatibleWithAnchor);
      const pool = compatible.length > 0 ? compatible : themedPool;
      if (pool.length === 0) {
        rejected.push(`add: no ${revision.role} section available for this site`);
        continue;
      }
      const fitted = rankByTaxonomy(pool, classifyBriefTaxonomy(next.brief));
      // Prefer a template this page has not drawn from — adding a section should widen the mix,
      // not deepen one template's share of the page.
      const usedTemplates = new Set(list.map((section) => section.templateId));
      const fresh = fitted.filter((section) => !usedTemplates.has(section.templateId));
      const chosen = pickFrom(
        revision.seed ?? `${revision.page}:${revision.role}:add:${list.length}`,
        "add",
        fresh.length > 0 ? fresh : fitted
      );
      const placed: PlacedSection = {
        templateId: chosen.templateId,
        sectionId: chosen.sectionId,
        role: revision.role,
      };
      const anchor = revision.after ? list.findIndex((section) => sectionKey(section) === revision.after) : -1;
      const footerAt = list.findIndex((section) => section.role === "footer");
      const at = anchor >= 0 ? anchor + 1 : footerAt >= 0 ? footerAt : list.length;
      list.splice(at, 0, placed);
      applied.push(`add ${revision.role} -> ${chosen.templateId}`);
      continue;
    }

    const hits = locate(next, revision.target, options.page);
    if (hits.length === 0) {
      rejected.push(`${revision.kind}: no section ${revision.target} on this site`);
      continue;
    }

    if (revision.kind === "removeSection") {
      // Chrome placed on every page is removed everywhere: a nav that survives on three pages and
      // vanishes on the fourth reads as a bug, not an edit.
      for (const hit of [...hits].reverse()) {
        next.pages[hit.slug]!.splice(hit.index, 1);
      }
      applied.push(`remove ${revision.target}`);
      continue;
    }

    if (revision.kind === "moveSection") {
      const hit = hits[0]!;
      const list = next.pages[hit.slug]!;
      const to = revision.direction === "up" ? hit.index - 1 : hit.index + 1;
      if (to < 0 || to >= list.length) {
        rejected.push(`move: already at the ${revision.direction === "up" ? "top" : "bottom"}`);
        continue;
      }
      const [moved] = list.splice(hit.index, 1);
      list.splice(to, 0, moved!);
      applied.push(`move ${revision.direction} ${revision.target}`);
      continue;
    }

    // swapSection: re-pick this role, never the section already in place. Section ids are only
    // unique within a template, so the composite key is what identifies "the same section". The
    // same taxonomy fit that picked this site's original mix narrows the swap pool too — a
    // "different hero" on a law-firm site should not land on a restaurant template's hero.
    const target = hits[0]!.section;
    const pool = index.sections.filter(
      (section) => section.role === target.role && sectionKey(section) !== revision.target
    );
    if (pool.length === 0) {
      rejected.push(`swap: no other ${target.role} section in the corpus`);
      continue;
    }
    // The rest of the site is locked to one original theme — a swap must not reintroduce the exact
    // light/dark mismatch selection prevents at generation time.
    const themeByKey = new Map(index.sections.map((section) => [sectionKey(section), section.theme]));
    const siteTheme = siteThemeOf(next, themeByKey);
    const themedPool = siteTheme ? pool.filter((section) => !section.theme || section.theme === siteTheme) : pool;
    // Same compatibility bar generation gates cross-template mixing on — falls back to the
    // theme-only pool rather than rejecting the swap outright when nothing clears it.
    const compatiblePool = themedPool.filter(compatibleWithAnchor);
    const scopedPool = compatiblePool.length > 0 ? compatiblePool : themedPool.length > 0 ? themedPool : pool;
    const fitted = rankByTaxonomy(scopedPool, classifyBriefTaxonomy(next.brief));
    const fromOtherTemplate = fitted.filter((section) => section.templateId !== target.templateId);
    const chosen = pickFrom(
      revision.seed ?? `${revision.target}:swap:${Object.keys(next.overrides ?? {}).length}`,
      "swap",
      fromOtherTemplate.length > 0 ? fromOtherTemplate : fitted
    );
    const replacement: PlacedSection = {
      templateId: chosen.templateId,
      sectionId: chosen.sectionId,
      role: target.role,
    };
    for (const hit of hits) {
      next.pages[hit.slug]![hit.index] = replacement;
    }
    applied.push(`swap ${revision.target} -> ${chosen.templateId}`);
  }

  const site = await composeVerbatimSite(next, store, { ...(options.editable ? { editable: true } : {}) });
  return { state: next, site, applied, rejected };
}

/** Recompose a site from its state — the same path a first generation takes, with the saved text
 *  edits, palette and logo carried through so nothing drifts between renders.
 *
 * `state.placementsFill` set (a site `PIPELINE_PLACEMENTS_CORPUS` generated), this ALSO replays that
 * fill onto the freshly composed HTML — zero new LLM calls, every value comes straight from what's
 * persisted. Without this, a placements-filled site's real business copy would revert to
 * `compose.ts`'s own generic copy-slot text on the very first edit/swap/palette change; see
 * `placements/from-corpus.ts`'s `reapplyPlacementsFill` for the mechanism and its own doc comment
 * for why a manual text edit (`state.overrides`, applied by `composeSite` above BEFORE this runs)
 * always wins over the replayed value for that same node. */
export async function composeVerbatimSite(
  state: VerbatimSiteState,
  store: TemplateStore = templateStore(),
  options: { editable?: boolean } = {}
): Promise<ComposedSite> {
  const site = await composeSite({
    brief: state.brief,
    rawBrief: state.rawBrief,
    pages: state.pages,
    store,
    ...(state.paletteId ? { paletteId: state.paletteId } : {}),
    ...(state.logoSrc ? { logoSrc: state.logoSrc } : {}),
    ...(state.anchorTemplateId ? { anchorTemplateId: state.anchorTemplateId } : {}),
    ...(state.photos && Object.keys(state.photos).length > 0 ? { photos: state.photos } : {}),
    ...(state.overrides && Object.keys(state.overrides).length > 0 ? { overrides: state.overrides } : {}),
    ...(options.editable ? { editable: true } : {}),
  });
  if (!state.placementsFill) return site;

  const replayed = await reapplyPlacementsFill(
    state.pages,
    store,
    state.placementsFill,
    site.htmlPages,
    new Set(Object.keys(state.overrides ?? {}))
  );
  return { ...site, htmlPages: replayed.htmlPages };
}
