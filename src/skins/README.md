# Skin fill pipeline

Builds sites from **originally authored** multi-page layouts, rendered through this repo's own
React section library — the opposite of [`src/templates/`](../templates/README.md), which vendors
real third-party HTML as-is. A skin names which section template fills each slot on each page and
how (layout variant, density, media position); nothing here is copied from a third-party site —
see [`_references/README.md`](_references/README.md) for what "inspired by" is allowed to mean and
what it is not.

This is the default generation path when no template corpus has been ingested (`npm run
templates:ingest`), and the fallback whenever `templates:ingest` selection has nothing that clears
its taxonomy gate — see `src/templates/README.md`'s own "default" note for the other side of that
handoff. `PIPELINE_SKIN_FILL=0` falls back further, to the older per-page LLM composer
(`src/agents/page-codegen-agent.ts`, orchestrated by `src/orchestrator/react-pipeline.ts` —
`PIPELINE_PAGE_CODEGEN=1` opts into it directly; see `docs/SYSTEM.md` §7 for that pipeline).

## Files

| File | Owns |
|------|------|
| `schema.ts` | `SiteSkin`/`SkinSection` zod schemas — a skin is a page→section list, each section a `{templateId, intent, layoutVariant?, density?, mediaPosition?}` |
| `catalog.ts` | `SITE_SKINS` — 16 hand-authored skins, each built with the local `s(templateId, intent, layout)` helper. `allSkins()` merges these with whatever `src/admin/` has separately ingested and approved (`loadApprovedSkins()`, deduped by id) — the real catalog size at runtime is larger than 16 and grows as admin approves more |
| `taxonomy.ts` | The two-axis classification EVERY skin (and every brief) is scored against — see below |
| `picker.ts` | `pickSkinFromCatalog` — deterministic selection, no LLM call (see "Selection" below) |
| `theme.ts` | Turns a picked skin's own token pack into a `SiteTheme` — look comes from the skin, never a brief-regex or Design Council overlay |
| `tokens.ts` | `SkinTokenPack` — the subset of `SiteTheme` (mood, fonts, page tone, nav treatment, gradient mood, accent role, section gap mode, colors) an authored skin owns outright |
| `render-html-site.ts` | A frozen skin → real HTML files (`index.html`, `about.html`, …) — each section template renders as itself, styled by the token pack |
| `index.ts` | Re-exports `schema.ts`'s public types/constants |

## Taxonomy

`taxonomy.ts` is shared, not skins-only: `src/templates/`'s own corpus classification
(`classify-taxonomy.ts`) and runtime selection both import `classifyTaxonomy`/`taxonomyAffinity`
from here — one taxonomy, two consumers.

| Axis | Values |
|------|--------|
| Industry | 37 slugs (`health-clinic`, `cafe-bakery`, `legal`, `architecture`, …) |
| Archetype | `portfolio`, `storefront`, `booking`, `long-form`, `saas` |
| Legacy `SkinCategory` (derived, not scored directly) | `local-service`, `hospitality`, `professional`, `creative` |

`classifyTaxonomy(text)` scores exact-word keyword hits (strong 3 / medium 2 / weak 1) — deliberately
never stem/prefix, so boilerplate in a brief can't outvote the sentence naming the actual business —
takes the top industry with declared order as tie-break, and derives the legacy category + archetype
from the winner. Every authored skin's own `categories`/`industries`/`archetype` fields are scored
the same way, so a brief and a skin land in the same coordinate system without either needing to know
about the other's shape.

## Selection

`pickSkinFromCatalog` (`picker.ts`) is deterministic and seeded — no LLM call:

1. Classify the brief, narrow the whole catalog to its best `taxonomyAffinity` tier (industry hit >
   runner-up > category-only), then apply the vertical profile's `visualFamily` preference within
   that tier if one is set.
2. Within that pool: prefer a skin this `consumerId` has neither used nor seen an identical layout
   signature of (`skinLayoutSignature` — catches two skins that differ only in which template fills
   an interchangeable slot). Falls back to "used but not seen" before widening the pool at all.
3. If nothing in-tier and unused survives: retry against each adjacent category (`ADJACENT[category]`,
   near-neighbor legacy buckets), then the ENTIRE catalog regardless of tier, then finally repeat
   within the original tier if truly nothing unused is left anywhere.

Usage is recorded per `consumerId` in `data/consumer-skins.json` (`defaultSkinHistoryPath()`), the
same file `src/templates/select.ts`'s own history store is modeled after.

## Rendering

`render-html-site.ts` walks a picked, filled `SiteSkin` page by page and renders each `SkinSection`
through the section template its `templateId` names — the same component library
`src/section-templates/` already provides for every other pipeline, just driven by a skin's own
layout choices instead of an LLM's per-page composition hints. `pageFileName("home") ===
"index.html"`, matching every other HTML-output pipeline's own convention (`compose.ts`,
`placements-pipeline.ts`).
