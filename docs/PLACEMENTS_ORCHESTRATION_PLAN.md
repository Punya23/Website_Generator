# Placements Pipeline Orchestration — Research + Implementation Plan

> **Audience:** an implementing engineer or coding LLM.  
> **Goal:** wire the **placements fill engine** into production orchestration — LLM fills values only, never HTML — without collapsing the ~900-template corpus into 4 layouts.  
> **Date:** 2026-09-11 (rev 5 — Phase 3 (separate session) + Phase 4 both done; remaining scope is Phase 5 (docs) only)  
> **Baseline:** `origin/master` @ `4c674f8` (Phase 2B merged) plus this session's Phase 4 commit.  
> **Note:** branch `feat/robust-mix-match-pipeline` may still sit at `3005106` and **lack** everything through Phase 4 below. Implement / review against master tip — or rebase first.
> **Collision note (rev 3, still relevant):** a separate session landed Phase 0 + Phase 2C (curated override) directly on `master` while this plan's own Phase 0 attempt (`src/templates/placements/run-fill.ts`) was mid-flight on a review branch. Compared both implementations line-for-line — same prompt, same schema, same safety rules — and kept master's (`fill-real-estate-template.ts` / `placements-pipeline.ts`): it was already wired through `orchestrator.ts` at ~10 call sites with its own tests. The review branch's `run-fill.ts` was discarded. Phase 2B (rev 4) then split `fillRealEstateTemplate` in place to get the reusable, I/O-decoupled fill both paths needed — see §7 Phase 2B.

---

## 0. How to use this doc

1. Read §1–§4 before writing code.
2. Implement in **phase order** (§7). **Skip everything through Phase 4** — all done (see §7 for what shipped where). **Phase 5 (docs) is the only remaining work.**
3. Each open phase has: objective, files, steps, acceptance, done-when.
4. Prefer **extracting** existing script logic into libraries over rewriting it.
5. Fail closed on facts (phone/email/license/data): keep template / placeholder rather than invent.

---

## 1. Product decisions (locked)

| Decision | Choice |
|----------|--------|
| Content vs structure | **LLM fills placements only.** Never rewrite / regenerate HTML. |
| Engine | Existing `fill.ts` / `llm-view.ts` / `schema.ts` — do not fork |
| LLM contract | **Flat** `id → value` + **strict schema-complete** fills (already on master) |
| Facts vs copy | `fixed` / `brief` / `data` never invented as “real”; `llm` = marketing copy; phone/email = deterministic placeholders |
| **Production trunk** | **Corpus path:** `select.ts` → `buildPlacementsFromSelection` (`from-corpus.ts`) → placements fill → compose/assets |
| **High-fidelity override** | Hand-mapped `real-estate/*` (4 skins) when brief matches that vertical **and** product chooses the curated set — not the only path |
| Mixing | **Do not re-litigate.** Keep current `select.ts` policy (anchor-locked chrome/hero; `TEMPLATE_MIX_SECTIONS` default off; opt-in fingerprint-gated mix). Placements fill works on whatever `SelectedSite` select already produced |

### Non-goals (this milestone)

- Feeding whole HTML to an LLM
- Replacing taxonomy / select / ingest
- Building a full CRM/listings product (`resolveData` interface + fixtures only)
- Turning off corpus variety in favor of only 4 RE layouts
- Re-implementing schema-complete fill / llmQuery stock wiring (done on master)

---

## 2. Baseline — what’s true on master HEAD (`776380c`)

### Already shipped (do NOT rebuild)

| Item | Where | What |
|------|--------|------|
| Flat LLM contract | `llm-view.ts` `buildFlatPromptPayload` / `applyFlatLlmResponse` | Nested silent drops fixed |
| Schema-complete fills | `dff6cad` — `flatKeysSchema()` in `llm-view.ts` | `responseSchema` + Zod `idsShape(...).strict()` — **all ids required, non-empty**; `chatJsonWithRetry` retries on Zod failure. This **is** the coverage gate |
| llmQuery → stock | `9d9fefe` — map + `resolveImageQueries` via `stockImageUrl` | **6** `llmQuery` fields in `real-estate-map.ts`; queries resolved before `applyPlacements` |
| Locale / anti-boilerplate | `ca6dada` | Fill prompt rules |
| Corpus → placements bridge | `b18539e` — `from-corpus.ts` + `tests/placements-corpus-bridge.test.ts` | `buildPlacementsFromSelection(SelectedSite)` — **no hand selectors** |
| fillSource safety | `fill.ts` | fixed reject, phone zeroing, license never fabricated |
| **Fill extraction (Phase 0)** | `92bbe90` — `src/templates/placements/fill-real-estate-template.ts` | Same fill logic as above, lifted out of the script into `fillRealEstateTemplate(templateDir, rawBrief, opts)` — one implementation, two callers (CLI + orchestrator). Reads `placements.json` + page HTML off `templateDir` itself; **not** I/O-decoupled (see collision note at top) — that matters once Phase 2B needs an in-memory `PlacementsFile` with no `templateDir` |
| **Curated override (Phase 2C)** | `92bbe90` — `src/orchestrator/placements-pipeline.ts` | `runPlacementsPipeline(ctx, brief)`: `pickRealEstateTemplate(brief)` scores the 4 `real-estate/*` skins by sub-vertical keywords (luxury/commercial/property-management, else generalist agency), calls `fillRealEstateTemplate`, runs `runCodeQA` per page. Wired into `orchestrator.ts` as a **fourth branch**, priority over verbatim/skin-fill, gated on `usePlacementsPipeline() && classifyTaxonomy(brief).industry === "real-estate"` |
| **Env flag** | `src/llm/pipeline-speed.ts` | `usePlacementsPipeline()` reads `PIPELINE_PLACEMENTS` — **defaults `false`**, opt-in only via `=1`. This is rev‑2's "curated override, not trunk" position, already shipped as the default |
| **Tests** | `tests/placements-pipeline.test.ts` | `pickRealEstateTemplate` coverage (all 4 sub-verticals + fallback) + flag behavior |
| **Phase 2A spike (this session)** | `scripts/spike-corpus-placements.ts` | See §7 Phase 2A results below — corpus selector hit rate, constraint tightness, people-photo policy, all measured against the real 910-template cache |

### Still true (remaining gaps — this is what Phase 2B actually is)

1. **Corpus production path still fills via `compose.ts` / copy-slots**, not `applyPlacements` — the placements engine only reaches real-estate briefs today, never a corpus-selected site
2. **No registry/picker needed for the corpus path** — `from-corpus.ts` + `buildPlacementsFromSelection` already answer "does the engine work on any template", untouched by the master merge
3. **`polishComposedCopy` (`verbatim-template-pipeline.ts`) is the stage Phase 2B replaces** — its `overrides` recompose would revert fragment-applied placements if both ran; nobody has wired this yet
4. **Doc drift** — `SYSTEM.md` documents `PIPELINE_PLACEMENTS` (the curated path) but says nothing about a corpus-trunk placements fill, because it doesn't exist yet

### What was wrong in rev‑1 of this plan

- Claimed jsonMode-only / silent partial fills / zero llmQuery — **stale vs master**
- Proposed a new `coverage.ts` + `PLACEMENTS_COVERAGE_MIN=0.95` — **forks** the existing all-or-nothing Zod-strict gate; fraction is incoherent under strict schema
- Made **4-skin registry the trunk** — collapses ~902 corpus templates to 4 layouts for all RE briefs; ignored `from-corpus.ts`
- Said “no cross-template mixing” as a new lock — **re-litigates** solved select.ts policy
- “Degrade + ship” under-fill — **contradicts** current throw-after-retry without labeling it a product change

### What rev‑2 got right that master's independent implementation confirms

- Curated 4-skin path stayed **opt-in, off by default** (`PIPELINE_PLACEMENTS` — same shape rev‑2 specified, different name)
- Fill logic extracted to one shared implementation, not duplicated between CLI and orchestrator
- No `coverage.ts` fork — same Zod-strict + `chatJsonWithRetry` gate, no fractional threshold

---

## 3. Research summary (short)

### What transfers from RE prototype → corpus (rev 3)

| Prototype gives | Corpus gives | Gap |
|---|---|---|
| `measure.ts` per-selector ceilings | `genericProseConstraints` from original length | Coarser `maxChars`; clamp safe, overflow risk up |
| Hand `data` fields (price, agent, listing) | **No `data`** — only section-level people lock | Listing/agent taxonomy does not exist on trunk |
| Hand `llmQuery` vs identity photos | All photo slots → `llmQuery` | Headshots may get stock-replaced |
| Page-scoped ids (`home.featured.0.title`) | `sectionKey(templateId:sectionId).*` | Composition-stable, different scheme |
| Engine fill/clamp/schema/retry | Same engine via `from-corpus` | **Transfers** |

4 RE templates = **testbed**, not the product. Trunk variety stays with the corpus.


**Keep:** content overlay (Lightning Jar / Genji / SyncBricks) — template owns structure; LLM returns addressed values; deterministic inject.

**Trunk insight:** `from-corpus.ts` already answers “does the engine only work on hand maps?” — it builds a `PlacementsFile` from auto-discovered corpus slots (`classify-section` / `photo-slots`). Production should **swap the copy-fill stage** of the verbatim pipeline for this engine, not invent a parallel 4-skin-only product path.

**Override insight:** hand-mapped `real-estate/*` remains valuable (pixel-accurate constraints via `measure.ts`, richer `data` roles, shared multi-page chrome). Use when you explicitly want curated RE skins — not as the only RE answer.

---

## 4. Target architecture (rev 3 — curated branch already real, corpus branch still to build)

```
business brief
    │
    ├─ expandBrief (existing)
    ├─ classifyTaxonomy / plan (existing)
    │
    ▼
orchestrator branch (orchestrator.ts — `placements` gate, already shipped)
    │
    ├─ IF usePlacementsPipeline() && industry === "real-estate"   ← DONE (PIPELINE_PLACEMENTS)
    │     runPlacementsPipeline(ctx, brief)   ← placements-pipeline.ts
    │       pickRealEstateTemplate(brief)     ← 4-skin sub-vertical picker
    │       fillRealEstateTemplate(dir, brief) ← fill-real-estate-template.ts
    │       runCodeQA per page
    │
    └─ ELSE IF verbatim corpus available (default today)   ← PHASE 2B, NOT BUILT
          selectSiteSections → SelectedSite   ← existing (mix policy unchanged)
          buildPlacementsFromSelection(...)     ← from-corpus.ts, excluding nav/footer (2A finding)
          [corpus fill helper — TBD, reuse fill-real-estate-template.ts's prompt/schema]
          applyPlacements on the COMPOSED page  ← Option B, confirmed 100% body-only (2A)
          REPLACE polishComposedCopy for this site (integration hazard, not yet designed)
          (keep select/recolor/assets/nav-rebuild exactly as today)
    │
    ▼
QA (existing code-qa / vision) + brand-leak checks
    │
    ▼
GenerationResult
```

### Corpus integrate — resolved by the 2A spike

The "Option A vs B" question this section originally posed is closed: **Option B** (apply placements on the fully composed page, after `[data-tpl]` wrapping and id namespacing) works — **100% hit rate once `nav`/`footer` placements are excluded** from `buildPlacementsFromSelection` in the first place. No fragment-timing complexity, no selector-repair work in `from-corpus.ts`. See §7 Phase 2A for the numbers.

---

## 5. Module design

### 5.1 Already shipped — do not recreate

| File | Responsibility |
|------|----------------|
| `src/templates/placements/fill-real-estate-template.ts` | Phase 0's fill extraction (see §2). Reads `templateDir` off disk directly — I/O is NOT decoupled from the fill, unlike this doc's original `run-fill.ts` proposal. Fine for the curated path (`real-estate/*` genuinely lives on disk); Phase 2B's corpus fill will need its own small module or a refactor of this one, since a corpus `PlacementsFile` has no `templateDir` |
| `src/orchestrator/placements-pipeline.ts` | Phase 2C's curated override (see §2) — `runPlacementsPipeline`, `pickRealEstateTemplate`, `REAL_ESTATE_TEMPLATE_IDS` |
| `scripts/generate-real-site.ts` | Already a thin CLI over `fillRealEstateTemplate` |
| `scripts/spike-corpus-placements.ts` | This session's Phase 2A spike (see §7) |

### 5.2 New for Phase 2B (the open work)

| File | Responsibility |
|------|----------------|
| A corpus fill helper — new module, or exported pieces of `fill-real-estate-template.ts` | `resolveBriefContext` / `pageFillValidator` / `pageFillJsonSchema` / `resolveImageQueries`, callable against a corpus `PlacementsFile` (from `buildPlacementsFromSelection`) instead of one loaded off `real-estate/*` |

### 5.3 Existing — extend, don’t fork

| File | Change |
|------|--------|
| `src/templates/placements/from-corpus.ts` | Exclude `nav`/`footer` sections from `buildPlacementsFromSelection`'s input for the compose-integrated path (2A finding) — chrome is compose-owned |
| `src/templates/placements/llm-view.ts` | Already exports `flatKeysSchema` — **reuse** |
| `src/orchestrator/verbatim-template-pipeline.ts` | Swap `polishComposedCopy` stage → placements fill via from-corpus, when the new corpus flag is on |
| `src/orchestrator/orchestrator.ts` | Corpus path uses updated verbatim pipeline; the existing `placements` (curated) branch is untouched |
| `src/llm/pipeline-speed.ts` | New `usePlacementsCorpusFill()` reading `PIPELINE_PLACEMENTS_CORPUS` — **do not reuse the already-shipped `PIPELINE_PLACEMENTS` name**, that's the curated path |
| `docs/SYSTEM.md` | Already documents `PIPELINE_PLACEMENTS` (curated); add the corpus flag once it exists |

### 5.4 Do **not** create

- `coverage.ts` with fractional `PLACEMENTS_COVERAGE_MIN` — duplicates Zod-strict + retry
- A second `run-fill.ts`-shaped I/O-decoupled module competing with `fill-real-estate-template.ts` for the curated path — that refactor, if it happens, replaces the existing file, it doesn't sit beside it
- A parallel RE-only orchestrator that bypasses corpus for every RE brief

---

## 6. LLM contract (already on master — preserve)

**Per page:**

- Input: flat `copy_fields` + `example_fields`
- Provider: `responseSchema` from `flatKeysSchema` / `buildResponseJsonSchema` (`additionalProperties: false`, every id required)
- Runtime: Zod `.strict()` on same id set; empty strings fail; `chatJsonWithRetry` retries
- Images: `llmQuery` answers are search queries → `stockImageUrl` / registry **before** `applyPlacements` (fill expects URLs)

**Under-fill policy (explicit decision — do not silently change):**

| Policy | Behavior | Status |
|--------|----------|--------|
| **Current (master)** | After retries, under-filled page **throws**; script warns and keeps template copy for that page | Shipped |
| **Optional change** | “Degrade + ship” with metrics | **Only if product asks**; document as a behavior change in the PR, not as “the plan’s default” |

Rev‑2 default: **keep throw / skip-page-with-warning** unless a later decision flips it.

---

## 7. Implementation phases

### Phase 0 — Extract shared fill — **DONE on master** (as `fill-real-estate-template.ts`)

Commit: `92bbe90`. **Implementing agents: skip.** See §2's "Already shipped" table and the collision note at the top of this doc — this landed under a different name/shape (`fillRealEstateTemplate(templateDir, rawBrief, opts)`, disk I/O included) than this doc originally specified (`run-fill.ts`, I/O-decoupled). Functionally equivalent for the curated path; revisit only if Phase 2B needs the decoupled shape.

---

### Phase 1 — Schema-complete + llmQuery — **DONE on master**

Commits: `dff6cad`, `9d9fefe`, `ca6dada`.  

**Implementing agents: skip.** If your checkout is behind, rebase onto `origin/master` first.

Checklist if verifying a branch:

- [ ] `responseSchema: buildResponseJsonSchema(...)` present
- [ ] Zod `idsShape` + `.strict()` on copy/example values
- [ ] `grep llmQuery real-estate-map.ts` → 6
- [ ] `resolveImageQueries` + `stockImageUrl` in fill path

---

### Phase 2 — Placements fill inside corpus pipeline (trunk) + curated override

**Objective:** Production verbatim path uses placements engine for copy; curated RE hand maps remain an optional high-fidelity override.

#### 2A — Spike — **DONE this session**

**Script:** `scripts/spike-corpus-placements.ts` (committed) — run with `ALLOW_MOCKS=1 TEMPLATE_CACHE_DIR=<repo>/data/template-cache TEMPLATE_STORE_PATH=<repo>/data/template-store.json npx tsx scripts/spike-corpus-placements.ts`. No LLM calls — every editable placement gets a dummy value sized to its own `minChars`, so a skip can only mean "selector did not resolve", never "value rejected by the clamp".

**Results, against the real 910-template cache:**

1. **Selector hit rate.** `select → buildPlacementsFromSelection → composeSite → applyPlacements` (Option B, the composed page): **86.2%** (100/116). Control — same placements applied to the **raw cached fragment** (pre-compose): **100.0%** (116/116). So the selectors themselves are never wrong. Every one of the 16 misses is `nav`/`footer` — root cause confirmed in `compose.ts`: `rewriteNavLinks` (`compose.ts:396`) rebuilds the primary `<ul>` from the site's own pages, deleting every original `<li>`; `copy-slots.ts:228` replaces a logo `<img>` with a `<span class="tpl-wordmark">` text node when no logo is uploaded. Both are deliberate compose behavior, not markup drift. **With chrome (`nav`/`footer`) excluded: 100.0% (56/56).**
   → **Conclusion: exclude `nav`/`footer` sections from `buildPlacementsFromSelection` on the corpus path. Chrome is compose-owned, not template-owned; Option B works as-is on body sections, no selector-repair work needed.**
2. **Constraint tightness.** Corpus `genericProseConstraints`: n=80, median `maxChars`=48, mean(`maxChars`/original length)=**5.25**. Hand-mapped RE `measure.ts`: n=151, median=66, mean ratio=**2.17**. Corpus budgets run **~2.4× looser** relative to the text they replace than the hand map's measured ones — this is the overflow exposure the 4-template prototype cannot validate, because it never uses `genericProseConstraints` at all. **Promotes Phase 4's overflow QA from optional to load-bearing.**
3. **People-section photo policy — found a real gap, not just measured one.** The selection this spike landed on had zero team/testimonials sections, so a forced second pass used the same people-rich template `tests/placements-corpus-bridge.test.ts` pins (`tpl_0050107a0d3b`): text placements locked **19/19 `fixed`** ✓ (the existing `PEOPLE_SECTION_ROLES` guard in `from-corpus.ts` works), but that template happens to have **zero** photo slots in its people sections, so the photo side was never exercised. A corpus-wide scan (`data/template-cache/`, all 910 manifests) found **2,574 team/testimonials sections, 806 of them carrying photo slots, 4,230 people photo slots total** — and `imagePlacementFromPhotoSlot` (`from-corpus.ts`) sets every one of them `fillSource: "llmQuery"` unconditionally, with no equivalent to the text-side people lock. A headshot or customer photo in exactly the sections where fabricating people is banned would get replaced by a stock-photo search result. **Spawned as a separate fix (`task_effb69a4`) — not blocking this doc, but Phase 2B must not ship before it lands.**

**Done when:** ✅ selector hit rate measured and root-caused (100% body-only); constraint delta quantified (5.25× vs 2.17×); people-photo gap found, quantified, and a fix spawned.

#### 2B — Wire fill stage into verbatim pipeline — **DONE this session**

Built as designed, with one correction made mid-implementation (see below). Files:

| File | What |
|------|------|
| `src/templates/placements/fill-real-estate-template.ts` | Split `fillRealEstateTemplate` into a new exported `fillPlacementsFile(file, rawBrief, opts)` — the vertical-agnostic brief-resolve + per-page LLM fill, no file I/O — and `fillRealEstateTemplate` itself, now a thin disk-reading wrapper around it. One prompt/schema/locale implementation, two callers. |
| `src/orchestrator/placements-corpus-fill.ts` (new) | `runCorpusPlacementsFill(selected, store, meta, htmlPages, rawBrief, onProgress)` — excludes `nav`/`footer` sections before calling `buildPlacementsFromSelection` (2A's finding), calls `fillPlacementsFile`, then `applyPlacements` per page against `composed.htmlPages`. Returns the filled `htmlPages` plus applied/skipped/clamped counts. |
| `src/llm/pipeline-speed.ts` | `usePlacementsCorpusFill()` reads `PIPELINE_PLACEMENTS_CORPUS` — default `0`, distinct from `PIPELINE_PLACEMENTS` |
| `src/orchestrator/verbatim-template-pipeline.ts` | Branches on `usePlacementsCorpusFill()` in place of the unconditional `polishComposedCopy` call. When on: run `runCorpusPlacementsFill`, write its `htmlPages` straight into `finalComposed` — no recompose. **Also skips section repair for this generation** (see correction below), not just polish. |
| `tests/placements-corpus-fill.test.ts` (new) | 3 tests against the real pinned corpus template (mocked LLM): nav/footer never appear in `skipped`, a real per-business value lands in composed HTML, a page with no body sections ships byte-identical |
| `tests/placements-pipeline.test.ts` | Added `usePlacementsCorpusFill` flag tests, including "opting into `PIPELINE_PLACEMENTS` does not opt into this" |

**Correction found while implementing (not caught by the 2A spike):** the plan above only named `polishComposedCopy`'s recompose as the hazard. `verbatim-template-pipeline.ts` has a SECOND recompose path — section repair (`repairFlaggedSections`, triggered by QA issues or by `slotsSkipped > 0` in `composed`'s own provenance) — that goes through the exact same `composeSite({ overrides })` mechanism and would just as silently discard a placements fill. Worse, its `slotsSkipped` trigger reads `composed`'s provenance from BEFORE placements ran, so it would misfire on sections placements had already filled. Fixed by gating both polish AND section repair behind one `placementsFillActive` flag read once — QA still runs and still reports issues either way; only the auto-rewrite-and-recompose reaction to them is out of scope for this phase, matching the curated path's own documented "no vision-QA redo loop yet" gap.

**Known gap, matches the curated path's own documented one:** the result is written straight into `composed.htmlPages`, never through `overrides` — so `VerbatimSiteState.overrides` stays empty for a placements-filled site, and a later edit/recompose session would rebuild from `compose.ts`'s own deterministic copy-slots pass with no placements copy. Not in this phase's scope.

**`templateBusinessName` deliberately NOT passed** to `applyPlacements` on the corpus path — that option exists to swap ONE known fictional demo brand (a curated skin's own "Prestige Realty") out of fallback text; a multi-template corpus composition has no single brand to name. Real per-section brand-leak detection stays Phase 3's job.

**Verified:**

- `tsc --noEmit` clean
- `tests/placements.test.ts`, `-corpus-bridge`, `-pipeline`, `-corpus-fill`, `orchestration-revamp`, `verbatim-compose`, `copy-polish-agent`, `section-repair-agent`, `pipeline-speed` — 115/115 green
- **Real end-to-end run** (`PIPELINE_PLACEMENTS_CORPUS=1`, real OpenRouter call, real 910-template corpus, no mocks): brief "Harbor Homes is a boutique residential brokerage in Alameda, CA…" → log line `[pipeline] Placements fill (corpus): 25 text + 12 image placement(s) applied` (0 skipped on the shipped attempt) → real, specific, non-boilerplate copy in the output ("Boutique residential guidance for first-time home buyers and downsizers in Alameda, CA. We limit our client roster to provide undivided personal attention and local island expertise.") — not a template's generic prose, not a dummy value. Cost: $0.0068. The pipeline's own pre-existing final-vision-gate redo loop ran on top of this without incident, proving the new branch composes cleanly with existing machinery it doesn't otherwise touch.

**Done when:** ✅ all of the above.
- `task_effb69a4`'s photo guard landed and covered by its own test

#### 2C — Curated override — **DONE on master, different shape than planned**

Shipped as `src/orchestrator/placements-pipeline.ts` (`runPlacementsPipeline`) + `pickRealEstateTemplate` (keyword-scored sub-vertical picker, not a `curated-registry.ts` file), gated by `PIPELINE_PLACEMENTS` (default `0`, not `PIPELINE_CURATED_PLACEMENTS`). Functionally identical to what this section originally asked for: opt-in, `real-estate-agency` as the untagged fallback, never the only RE path. See §2's "Already shipped" table for the commit and file names — **use those, not the names below**, if referencing this from other docs.

**Done when:** ✅ already true on master.

---

### Phase 3 — Media hardening + resolveData fixtures — **DONE** (`a896dbb`/`8c9717a`, separate session)

Built while Phase 2B was in flight elsewhere; nothing here touched `from-corpus.ts`/`compose.ts`/`verbatim-template-pipeline.ts`, so no conflict.

| Step | Where |
|------|-------|
| `resolveData` hook threaded into `fillRealEstateTemplate` | `fill-real-estate-template.ts` |
| `demoListingsResolver(locale)` — 6 US + 6 India fixture listings, cycled via modulo | `demo-data.ts` + `fixtures/demo-listings.json` |
| `DEMO_LISTINGS=1` opt-in on the CLI | `scripts/generate-real-site.ts` |
| `checkBrandLeak(html, ownBrandName)` — the 4 curated templates' own demo brand names | `brand-leak.ts` |
| `resolveImageQueries` exported (was private) | `fill-real-estate-template.ts`, reused transitively by Phase 2B's `fillPlacementsFile` |

**Not done, correctly out of scope:** corpus-side brand-leak detection — `checkBrandLeak`'s fixed 4-name list doesn't fit a composition drawing from hundreds of possible source templates, each with its own demo brand. Needs a different, generic mechanism; still open (see Phase 4 below).

**Done when:** ✅ 15 tests (`tests/placements-phase3.test.ts`), `tsc` clean.

---

### Phase 4 — Post-fill QA — **DONE this session**

**Objective (as stated):** Reuse verbatim QA (`stageSite`, `runCodeQA`, `[data-tpl]` checks). Add brand-leak + "placements skipped selectors" metrics to pipeline log.

Turned out to be less "add metrics to a working pipeline" and more "the curated pipeline's QA was never really checking anything" — the objective's own premise (reuse verbatim QA) was false until this session: `placements-pipeline.ts` called `runCodeQA(page.html, slug)` with **no `pageUrl`**, so it ran against `page.setContent()`'s `about:blank` — the exact case `CodeQAOptions.pageUrl`'s own doc comment warns produces meaningless asset checks. Worse, `PlacementsPipelineResult` never returned a `files` list at all, so `orchestrator.ts`'s `placements` branch left `verbatimFiles` (the generic "extra files to copy" list every output writer reads) at its default `[]`. **Every curated real-estate generation shipped to `output/` with zero CSS/JS copied — a completely unstyled site — invisible because nothing ever staged real files to catch it.** Confirmed live: before this session's fix, a real end-to-end `PIPELINE_PLACEMENTS=1` generation's `output/<slug>/` had no `assets/` directory at all; after, `assets/css/style.css` and `assets/js/main.js` are there with fresh timestamps and the page's own `<link>` correctly resolves.

| Change | File |
|---|---|
| New `MISSING_ASSET` check — a stylesheet or CSS `background-image` that fails to load, listened for via BOTH `response` (real 4xx) and `requestfailed` (a missing **local** `file://` path never produces an HTTP response at all — the whole reason `stageSite`'s pages need this over `setContent`) | `qa/code-qa.ts` |
| `collectTemplateAssets(templateDir)` — recursive walk, excludes `.html`/`.json`; staged via the same `stageSite` verbatim already exports; `runCodeQA` now gets a real `pageUrl` | `orchestrator/placements-pipeline.ts` |
| `files` returned from `runPlacementsPipeline`, wired into `orchestrator.ts`'s `verbatimFiles` (reused — it's a generic "extra files" list, not verbatim-specific) — **the actual fix** | `orchestrator/orchestrator.ts` |
| `checkBrandLeak` now called per page in the curated pipeline (Phase 3 built it; nothing had ever invoked it in production, only the CLI) — pushed as a `BRAND_LEAK` hard `QAIssue`, `passed` recomputed | `orchestrator/placements-pipeline.ts` |
| `FilledPage.skipped` — `applyPlacements`'s own `skipped` was silently discarded before; now returned and surfaced as a soft `PLACEMENTS_SELECTOR_SKIPPED` issue | `fill-real-estate-template.ts` |
| Corpus path: `CorpusPlacementsFillResult.byPage` — per-page skipped/clamped breakdown, attached to that page's own `QAResult` as soft `PLACEMENTS_SELECTOR_SKIPPED`/`PLACEMENTS_VALUE_CLAMPED` issues (previously only a flat, site-wide log line) | `placements-corpus-fill.ts`, `verbatim-template-pipeline.ts` |

**A second real bug found via the first new check, not hypothetical:** turning on brand-leak checking for real found "Prestige Realty" leaking through `about.html`'s hero image `alt="Prestige Realty office"` on every single curated generation. Root cause: an image's `alt` attribute is never itself a placement — `fill.ts` only ever writes `src`/`background-image` for an image, so a hand-authored `alt` mentioning the template's own demo brand shipped untouched regardless of `fillSource`, even on a `fixed` image whose photo never changes. Fixed by extracting `swapTemplateBrandName`'s swap logic into `substituteBrandName` and running it over every image's `alt` in the fill loop, independent of `fillSource` — 3 new tests in `placements.test.ts` cover it directly (including the `fixed`-image case).

**Deliberately not done — a real, separate, pre-existing bug found but out of scope:** a live end-to-end run surfaced `TEMPLATE_FILLER_LEAK`/`streetAddress` false-positives on a REAL, correctly-supplied street address (e.g. "1419 Park Street, Suite B, Alameda, CA 94501" flagged as leaked filler). This is `validateSectionsStructurally`'s existing street-address heuristic in `code-qa.ts`, runs unconditionally before any Playwright staging, entirely unrelated to this phase's `pageUrl`/asset/brand-leak work — not introduced or touched here. Flagged, not fixed: touching a shared, widely-tested QA subsystem's address heuristic is its own scoped piece of work.

**Verified:** `tsc --noEmit` clean; 160 tests green across every placements/QA-adjacent suite (`code-qa-missing-asset.test.ts` new, 5 tests; `placements-pipeline-phase4.test.ts` new, 6 tests; `placements-corpus-fill.test.ts` +2; `placements.test.ts` +3); two real end-to-end generations with real LLM calls — curated (`PIPELINE_PLACEMENTS=1`) confirming `assets/css/style.css` now ships, and the corpus path (unaffected by this phase's changes, still green from Phase 2B).

**Done when:** ✅ all of the above.

---

### Phase 5 — Docs

1. `SYSTEM.md`: placements fill stage on verbatim path; link `PLACEMENTS_SCHEMA.md` + this plan; remove contradictory “defaults.”
2. `templates/README.md`: state mix is opt-in (`TEMPLATE_MIX_SECTIONS`); copy stage can be placements.
3. Add `src/skins/README.md` stub or fix broken link.
4. `generate-real-site.ts` is already documented as the CLI over `fillRealEstateTemplate` — no change needed here.

---

## 8. Env flags

| Flag | Default | Meaning |
|------|---------|---------|
| `PIPELINE_PLACEMENTS` | `0` (**shipped**, `92bbe90`) | Curated 4-skin override — `usePlacementsPipeline()` in `pipeline-speed.ts`. Already the trunk decision this doc argued for: opt-in, not default |
| `PIPELINE_PLACEMENTS_CORPUS` | `0` (**shipped, this session**) | When verbatim runs, use placements engine for copy on the corpus path — `usePlacementsCorpusFill()` in `pipeline-speed.ts`. **Distinct flag from `PIPELINE_PLACEMENTS` above — do not conflate.** Verified end to end with a real run; stays off by default because vision-QA redo / editor-recompose parity with the curated path are still open, same reasoning `PIPELINE_PLACEMENTS` itself shipped with |
| `TEMPLATE_MIX_SECTIONS` | `0` | Unchanged — select.ts policy |
| `PIPELINE_VERBATIM_TEMPLATES` | existing | Unchanged |

**Removed vs rev‑1:** `PLACEMENTS_COVERAGE_MIN` — incoherent under strict all-or-nothing schema.

---

## 9. Read-first list (for implementing LLM)

```
REQUIRED READING
- docs/PLACEMENTS_ORCHESTRATION_PLAN.md (this file, rev 3)
- real-estate/PLACEMENTS_SCHEMA.md
- src/templates/placements/from-corpus.ts              ← trunk bridge — do not skip
- src/templates/placements/{fill,llm-view,schema,measure}.ts
- src/templates/placements/real-estate-map.ts          ← curated override producer
- src/templates/placements/fill-real-estate-template.ts ← Phase 0/2C's shipped fill — reuse its prompt/schema for 2B, don't re-derive
- src/orchestrator/placements-pipeline.ts               ← Phase 2C's shipped curated wiring — do NOT duplicate this branch for corpus
- scripts/spike-corpus-placements.ts                    ← Phase 2A's findings — read before touching from-corpus.ts
- scripts/generate-real-site.ts
- tests/placements.test.ts
- tests/placements-corpus-bridge.test.ts
- tests/placements-pipeline.test.ts
- src/orchestrator/verbatim-template-pipeline.ts        ← polishComposedCopy lives here — the stage 2B replaces
- src/templates/compose.ts / select.ts / copy-slots.ts
- src/llm/client.ts (json_schema) + json-agent.ts
- src/llm/pipeline-speed.ts                             ← usePlacementsPipeline() already exists; do not reuse its flag name for the new corpus flag

Rules:
- Do NOT give HTML to the LLM
- Do NOT rebuild schema-complete fill, llmQuery stock wiring, or the curated 4-skin override — all shipped
- Do NOT make the 4 RE skins the only RE path
- Do NOT add a second coverage mechanism — reuse Zod-strict + chatJsonWithRetry
- Do NOT change TEMPLATE_MIX default as part of this work
- Do NOT let corpus placements fill run before task_effb69a4 (people-photo guard) lands
- Keep fillSource safety in fill.ts
- Rebase onto origin/master if missing 92bbe90 (curated override) or later
```

---

## 10. Test plan

| Test | Asserts | Status |
|------|---------|--------|
| Existing placements + corpus-bridge | Still green | ✅ green |
| Curated override flag off | RE brief does **not** force `real-estate-agency` folder | ✅ `tests/placements-pipeline.test.ts` |
| Curated override flag on | Loads hand placements.json | ✅ `tests/placements-pipeline.test.ts` |
| **People-section photo guard** | Photo in team/testimonials never `llmQuery` | 🔧 `task_effb69a4`, in progress |
| Corpus fill helper unit with mock LLM | Schema-complete path invoked once | ✅ `tests/placements-corpus-fill.test.ts` |
| Verbatim+placements integration (mock) | select → from-corpus (chrome excluded) → apply on composed page; ≥95% hit | ✅ `tests/placements-corpus-fill.test.ts` (mocked) + a real end-to-end run (0 selectors skipped on the shipped attempt) |
| polishComposedCopy AND section repair replaced, not stacked | Corpus placements fill is the only copy/recompose pass on a placements-filled site | ✅ both gated behind one `placementsFillActive` read in `verbatim-template-pipeline.ts` — section repair was a second hazard found while implementing, not named in the original plan |
| Brand leak | Curated demo brand stripped when brief name set | ✅ exists for curated path (`fill.ts`'s `templateBusinessName` swap); needs a corpus-path equivalent in 2B |

---

## 11. Open questions (with defaults)

| Question | Default |
|----------|---------|
| Every RE brief → 4 hand skins? | **No.** Corpus+from-corpus trunk; curated opt-in |
| Under-fill after retry? | **Keep current** throw / skip page with warning — changing to degrade+ship needs an explicit product call |
| Compose integration option A vs B? | **A** after spike |
| Where to move `buildResponseJsonSchema`? | Into `llm-view.ts` next to `flatKeysSchema` |

---

## 12. PR sequence

1. ~~PR1 — Phase 0: extract fill; script thin wrapper~~ — **done** (`92bbe90`, as `fill-real-estate-template.ts`)
2. ~~PR2 — Phase 2A: corpus selector spike~~ — **done this session** (`scripts/spike-corpus-placements.ts`)
3. ~~PR3 — Phase 2C: curated override opt-in~~ — **done** (`92bbe90`, as `placements-pipeline.ts` + `PIPELINE_PLACEMENTS`)
4. **PR4 — people-photo guard:** `task_effb69a4` — blocks PR5
5. ~~PR5 — Phase 2B: corpus-path placements fill~~ — **done this session** (`PIPELINE_PLACEMENTS_CORPUS`, chrome excluded, polish + section repair both replaced, verified end to end)
6. ~~PR6 — Phase 3–4~~ — **done** (Phase 3: media fixtures, curated brand-leak helper; Phase 4: real asset-copy fix, MISSING_ASSET QA, corpus skipped-selector surfacing, image alt brand-leak fix). Corpus-side brand-leak detection still open (see Phase 3/4 sections above)
7. **PR7 — Phase 5:** docs only — `SYSTEM.md`, `templates/README.md`, `src/skins/README.md`

---

## 13. Success definition

```bash
npm run generate -- "Harbor Homes boutique residential brokerage in Alameda, CA"
```

1. Uses **corpus select** (unless curated flag on) — not forced to one of 4 folders  
2. Copy filled via **placements engine** (`from-corpus` → the Phase 2B corpus fill helper)  
3. LLM never saw HTML  
4. Mix policy unchanged from `select.ts`  
5. Curated `real-estate/*` path still available via flag/CLI for high-fidelity demos  
6. Schema-complete fills preserved (no regression to best-effort jsonMode)

---

## 14. References (project)

- `real-estate/PLACEMENTS_SCHEMA.md`
- `src/templates/placements/from-corpus.ts`
- `src/templates/placements/llm-view.ts` (`flatKeysSchema`)
- `src/templates/placements/fill-real-estate-template.ts` (master tip — Phase 0/2C)
- `src/orchestrator/placements-pipeline.ts` (Phase 2C)
- `scripts/spike-corpus-placements.ts` (Phase 2A)
- `scripts/generate-real-site.ts`
- `tests/placements-corpus-bridge.test.ts`
- `tests/placements-pipeline.test.ts`
- `src/templates/README.md`
- `docs/SYSTEM.md` (already documents `PIPELINE_PLACEMENTS`; media/QA sections — reuse)

## 15. References (external)

- https://www.lightningjar.com/blog/content-overlay  
- https://developers.openai.com/api/docs/guides/structured-outputs  
- https://syncbricks.com/why-piping-raw-llms-into-your-cms-is-engineering-malpractice/  
- https://webforger.ai/blog/how-ai-website-builders-actually-work/  

---

## 16. Changelog (this doc)

| Rev | Change |
|-----|--------|
| 1 | Initial plan — 4-skin trunk, rebuild Phase 1, fractional coverage |
| 2 | Re-baseline on master; Phase 1 = done; **from-corpus = trunk**; curated RE = override; drop coverage fork; don’t re-litigate mix; under-fill policy explicit |
| 3 | **Collision resolved:** a separate session shipped Phase 0 (`fill-real-estate-template.ts`) + Phase 2C (`placements-pipeline.ts`, `PIPELINE_PLACEMENTS`) directly to master — compared against this doc's own `run-fill.ts` attempt and kept master's (already wired through orchestrator.ts, own tests); `run-fill.ts` discarded. **Phase 2A spike run for real** against the 910-template cache: 100% selector hit rate once nav/footer excluded, 5.25× vs 2.17× constraint-tightness gap quantified, people-photo guard gap found and spawned as `task_effb69a4`. Phase 2B (corpus trunk) is now the entire remaining scope of this plan; renamed its flag to `PIPELINE_PLACEMENTS_CORPUS` to avoid colliding with the already-shipped `PIPELINE_PLACEMENTS` |
| 4 | **Phase 2B built and verified end to end** (`task_effb69a4` landed first, unblocking it). Split `fillRealEstateTemplate` into a reusable `fillPlacementsFile` + a disk-reading wrapper; new `placements-corpus-fill.ts` excludes chrome, fills, and applies onto `composeSite`'s output; `PIPELINE_PLACEMENTS_CORPUS` (default `0`) gates it in `verbatim-template-pipeline.ts`. **Found and fixed a second integration hazard the original plan missed:** section repair, not just `polishComposedCopy`, recomposes via `overrides` and would have silently discarded a placements fill the same way — both are now gated behind one flag read. Verified with 115 passing tests plus one real, no-mock, real-LLM end-to-end generation (real per-business copy shipped, 0 selectors skipped, $0.0068). Remaining scope is Phase 3 (media/brand-leak) onward |
| 5 | **Phase 3 (separate session) confirmed done; Phase 4 built.** Phase 4's stated objective ("reuse verbatim QA") turned out to be false as written — the curated pipeline never staged real files at all, so `runCodeQA` ran with no `pageUrl` and `files` was never returned, meaning **every curated real-estate generation shipped with zero CSS/JS copied**, invisible until now. Fixed at the source (`collectTemplateAssets` + `stageSite` + `verbatimFiles` wiring), not papered over. New generic `MISSING_ASSET` QA check needed BOTH `response` and `requestfailed` listeners — a missing local `file://` asset never produces an HTTP response, `response`-only missed every case live. Turning on brand-leak checking for real (Phase 3 built it, nothing had ever called it in production) found a second real leak — an image `alt` attribute, which no placement type ever writes to — fixed in `fill.ts`. One pre-existing, unrelated bug found and deliberately left alone (street-address false-positive in `validateSectionsStructurally`, out of this phase's scope). 160 tests green, two real end-to-end generations (curated + corpus). Only Phase 5 (docs) remains |
