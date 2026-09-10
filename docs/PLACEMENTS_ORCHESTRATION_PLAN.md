# Placements Pipeline Orchestration — Research + Implementation Plan

> **Audience:** an implementing engineer or coding LLM.  
> **Goal:** wire the **placements fill engine** into production orchestration — LLM fills values only, never HTML — without collapsing the ~900-template corpus into 4 layouts.  
> **Date:** 2026-09-11 (rev 3 — Phase 0 + curated override landed on master, under different names than rev‑2 planned)  
> **Baseline:** `origin/master` @ `776380c` (merge of `92bbe90` "Wire real-estate placements into the orchestrator as a fourth pipeline branch").  
> **Note:** branch `feat/robust-mix-match-pipeline` may still sit at `3005106` and **lack** everything through Phase 2C below. Implement / review against master tip (or rebase first).
> **Collision note:** a separate session landed Phase 0 + Phase 2C (curated override) directly on `master` while this plan's own Phase 0 attempt (`src/templates/placements/run-fill.ts`) was mid-flight on a review branch. Compared both implementations line-for-line — same prompt, same schema, same safety rules — and kept master's (`fill-real-estate-template.ts` / `placements-pipeline.ts`): it was already wired through `orchestrator.ts` at ~10 call sites with its own tests, and rebuilding that wiring on the review branch's API today would have been pure risk for a payoff (I/O-decoupled fill, useful for Phase 2B's in-memory `PlacementsFile`) that isn't needed until Phase 2B actually lands. The review branch's `run-fill.ts` was discarded. Refactor `fill-real-estate-template.ts` to take a `PlacementsFile` + HTML in/out (instead of reading a `templateDir` off disk) **when Phase 2B needs it**, not before.

---

## 0. How to use this doc

1. Read §1–§4 before writing code.
2. Implement in **phase order** (§7). **Skip Phase 1** (schema-complete fills) **and Phase 0 + 2C** (fill extraction + curated override) — all already shipped on master. **Phase 2B (corpus trunk) is the actual open work.**
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

#### 2B — Wire fill stage into verbatim pipeline (the actual open work)

1. After `selectSiteSections`, call `buildPlacementsFromSelection(selected, store, meta)` — **excluding `nav`/`footer` placed sections** (2A's finding: chrome is compose-owned; passing them through just re-introduces the 14% miss rate for no reason, since compose rebuilds both regardless of what placements would have written).
2. Build a small fill helper for the corpus path — reuse `resolveBriefContext` / `pageFillValidator` / `pageFillJsonSchema` / `resolveImageQueries`'s logic (currently private to `fill-real-estate-template.ts`; either export them or, if this diverges enough, a second small module — do not re-derive the prompt or schema from scratch) to get `llmValues` (+ illustrative) for the corpus `PlacementsFile`.
3. Apply placements onto the **composed page** (2A confirmed Option B works at 100% once chrome is excluded — no fragment-timing complexity needed).
4. **Replace `polishComposedCopy` + its `overrides` recompose** when placements fill is on for this site — do not run polish after placements apply; it recomposes and would revert them. This is the integration hazard 2A flagged and did not itself measure (that would need a second spike through `verbatim-template-pipeline.ts`'s actual polish step) — treat as a required design step for 2B, verify with a real end-to-end run before shipping.
5. **Do not ship before `task_effb69a4` (people-section photo guard) lands** — 2A found `from-corpus.ts` has no photo-side equivalent of its text-side people lock; running this on real corpus templates today would let a headshot in a testimonials section get replaced by a stock search result.
6. Keep: taxonomy gates, anchor policy, recolor, asset copy, nav rebuild (now explicitly the ONLY thing that touches chrome copy).
7. Flag: `PIPELINE_PLACEMENTS_CORPUS` (distinct from the already-shipped `PIPELINE_PLACEMENTS`, which is the curated 4-skin path — do not reuse or overload that name) — default `0` until this phase's acceptance criteria are green.

**Acceptance:**

- RE or non-RE brief with ingested corpus → log `[pipeline] placements fill (corpus)`
- Variety: two RE briefs can still land different corpus anchors (not forced into 4 folders)
- `tests/placements-corpus-bridge.test.ts` extended, or a new pipeline test, with mocks
- Brand-leak: demo template author contact still neutralized
- `task_effb69a4`'s photo guard landed and covered by its own test

#### 2C — Curated override — **DONE on master, different shape than planned**

Shipped as `src/orchestrator/placements-pipeline.ts` (`runPlacementsPipeline`) + `pickRealEstateTemplate` (keyword-scored sub-vertical picker, not a `curated-registry.ts` file), gated by `PIPELINE_PLACEMENTS` (default `0`, not `PIPELINE_CURATED_PLACEMENTS`). Functionally identical to what this section originally asked for: opt-in, `real-estate-agency` as the untagged fallback, never the only RE path. See §2's "Already shipped" table for the commit and file names — **use those, not the names below**, if referencing this from other docs.

**Done when:** ✅ already true on master.

---

### Phase 3 — Media hardening + resolveData fixtures

**Objective:** Corpus + curated paths share media resolution; demos can inject listing fixtures.

**Steps:**

1. Ensure corpus `llm`/`photo` slots that should be queries use the same `resolveImageQueries` path (from-corpus photo policy).
2. `fixtures/demo-listings.json` + `resolveData` for curated RE demos.
3. Brand-leak QA helper: fail if output contains other curated demo brands when brief name differs (`Prestige Realty`, etc.).

**Done when:** one mocked integration test covers query→URL on corpus placements.

---

### Phase 4 — Post-fill QA

**Objective:** Reuse verbatim QA (`stageSite`, `runCodeQA`, `[data-tpl]` checks). Add brand-leak + “placements skipped selectors” metrics to pipeline log.

**Done when:** hard QA on missing CSS assets; skipped-selector count surfaced.

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
| `PIPELINE_PLACEMENTS_CORPUS` | `0` (**not yet built** — Phase 2B) | When verbatim runs, use placements engine for copy on the corpus path. **Distinct flag from `PIPELINE_PLACEMENTS` above — do not conflate.** Stay off until 2B's acceptance criteria are green |
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
| Corpus fill helper unit with mock LLM | Schema-complete path invoked once | ⬜ Phase 2B |
| Verbatim+placements integration (mock) | select → from-corpus (chrome excluded) → apply on composed page; ≥95% hit | ⬜ Phase 2B — 2A's 100% body-only result is the target, not yet wired end-to-end |
| polishComposedCopy replaced, not stacked | Corpus placements fill + polish don't both run on the same site | ⬜ Phase 2B |
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
5. **PR5 — Phase 2B:** corpus-path placements fill behind `PIPELINE_PLACEMENTS_CORPUS`, chrome excluded, `polishComposedCopy` replaced
6. **PR6 — Phase 3–5:** media fixtures, QA metrics, docs

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
