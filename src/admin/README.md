# Ingest admin

The generator does **not** scrape Framer or vendor third-party HTML. This dashboard discovers **permissively licensed** GitHub templates (MIT, Apache-2.0, BSD, ISC, CC0, Unlicense) and stores **composition recipes** (section order, landmarks, mapped React templates). HTML/CSS is discarded.

## Run

```bash
npm run playground
# Admin → http://localhost:3847/admin
```

Put `OLLAMA_API_KEY` and `GITHUB_TOKEN` in `.env`. Localhost is open. Set `ADMIN_TOKEN` to require a bearer token.

## Agent loop

1. **Discover** — GitHub search across a query plan of `topic: × license: × star band`, then free-text terms. Star banding exists because GitHub caps any single query at 1000 results; sharding by stars reaches past that instead of re-reading the same top repos. Each page holds 100 hits; `INGEST_SEARCH_PAGES` pages are pulled per query. The walk stops on `INGEST_MAX_PER_RUN`, on `INGEST_MAX_QUERIES`, or after `INGEST_DRY_QUERIES` consecutive queries that return nothing new.
2. **Ingest** — fetch LICENSE, then `robots.txt`, then demo headings (and same-origin about/services/contact). Vercel/Netlify demos scrape only after license is verified. Blocked hosts (Framer, paid kits) never fetch.
3. **Render (only when needed)** — see below. Produces measured visual features and an internal thumbnail.
4. **Map** — the outline maps onto the React section library. When a render measured every visual attribute the mapping is fully deterministic and **no LLM call is made**; otherwise Ollama Cloud (or the configured LLM) maps it, with a heuristic fallback if the LLM is down. Measured attributes always beat model guesses.
5. **Approve** — auto-approve when license is verified and confidence ≥ `INGEST_MIN_CONFIDENCE`; weak maps and full layout clusters stay in Review. Bulk approve/reject in the queue.

Blocked: Framer, ThemeForest, Cruip, Tailwind Plus, Webflow cloneables.

## Scaling to thousands

- **Rate limits.** GitHub search allows 30 req/min with a token and 10 without; `INGEST_SEARCH_DELAY_MS` defaults to 2100 ms / 6500 ms accordingly. 403 and 429 are retried with `Retry-After` / `X-RateLimit-Reset` backoff. Demo hosts get a 400 ms per-host floor, so a run does not hammer `github.io`.
- **Storage.** Candidates live in an append-only `data/admin-ingest-candidates.ndjson`; only sources and runs stay in `data/admin-ingest.json`. A legacy single-file store migrates on first load. The log compacts once appended lines exceed twice the live candidate count. The index is written atomically (temp file + rename) and, if it is ever found unparseable on load, is quarantined to `<path>.corrupt-<timestamp>` and the load throws rather than silently reseeding the default sources over whatever was actually on disk. A single bad source/run row is dropped on its own without discarding the rest of the file.
- **Dedupe.** An exact signature repeat (same template order *and* visual family *and* chrome) is always rejected. A repeated template order is not: 34 templates over 3–8 home slots means real templates collapse onto a few hundred orders, so up to `INGEST_SIGNATURE_CAP` skins may share a layout as long as each differs in family/chrome. Ids for two drafts computed in the same concurrent batch are reserved the instant each is decided, so two forks of the same theme processed side by side never collide on one id.
- **Idempotent re-runs.** A source whose candidate already reached `approved` or `rejected` is not re-ingested on a later run — running the agent again over the same active sources is a no-op instead of re-drafting every published skin under a fresh id and demoting it back into the review queue. A blocked source updates its existing candidate row in place rather than appending a new one on every run.
- **Review queue.** `GET /api/admin/candidates` is paged (`limit`, `offset`, default 200, max 1000) and returns `total`; the dashboard's "Load more" walks `offset` forward so a filter holding more than 1000 rows stays reachable instead of dead-ending at the server's page cap.

## Screenshot + feature extraction

A browser render is the most expensive step in ingest, so `INGEST_SCREENSHOT` controls when one happens:

| Mode | Behaviour |
|------|-----------|
| `needed` (default) | Render only when it changes an outcome |
| `always` | Render every candidate that clears the license and robots gates |
| `never` | No browser is ever launched by ingest |

In `needed` mode a render is skipped when: there is no demo URL, the license is not verified, features were already measured for that same demo URL, the outline has no headings, or the deterministic composition is too weak (confidence < 0.45) to draft a skin at all. `screenshotDecision()` returns the reason, and it is stored on the candidate as `featuresSkipped` and shown in the review drawer.

One visit yields both artifacts. Features come from computed styles rather than pixel sampling — exact, cheap, and unaffected by a hero photograph:

| Measured | Feeds |
|----------|-------|
| body background luminance, accent hue/saturation, heading font stack | `visualFamily` |
| nav position, inset, radius, height, logo centring, link groups | `navShape` |
| footer columns, CTA buttons, text align | `footerLayout` |
| median section padding | `density` |
| background + accent hex, fonts, heading/image counts | stored for later theme mixing |

When all of family, nav, and footer were measured the record is `conclusive` and the mapping LLM call is skipped entirely — that call was the per-template cost driver at corpus scale. `candidate.mappedWith` records `llm` / `features` / `heuristic`, and a run's stats carry `captured` and `llmMapped` so the saving is visible.

Renders are capped at `INGEST_SCREENSHOT_CONCURRENCY` (default 2) and reuse the same chromium process as QA. `robots.txt` is fetched once per origin and cached for the process. At the end of a run, thumbnails no candidate or approved skin still references are pruned.

The in-page measurement script lives in `theme-features.ts` as a **source string**, not a function. `page.evaluate(fn)` serializes the function, and the TypeScript loader wraps named functions in an `__name` keep-names helper that does not exist inside the page — a passed-in function dies with `ReferenceError: __name is not defined` only after bundling, which no unit test catches. `tests/theme-features.test.ts` guards that the string stays helper-free.

### Thumbnails are internal only

`data/thumbs/<sha1(demoUrl)>.jpg` (gitignored, override with `INGEST_THUMBS_DIR`). Served only by `GET /api/admin/thumbs/:name` behind the admin guard, with `X-Robots-Tag: noindex`; the handler accepts a bare `<sha1>.jpg` and nothing else, so the path cannot be walked.

They are never bundled into a generated site and must not go into a public gallery. A rendered demo shows stock photos, logos, and sample copy that the repository's **code** license usually does not cover — MIT on the source says nothing about the photograph in its hero. Capture is refused outright until the permissive license is verified, and refused for any blocked or non-allowlisted host.

## Taxonomy

Classification is deterministic keyword scoring in [`src/skins/taxonomy.ts`](../skins/taxonomy.ts) — no LLM call. 27 industries across 4 legacy categories, times 5 archetypes (`portfolio`, `storefront`, `booking`, `long-form`, `saas`). Discovery tags each repo from its name, description, and topics; the runtime picker classifies the brief the same way and prefers skins whose `industries` / `archetype` match before falling back to the category ladder.

Matching is exact-word (plus literal phrases), never stem/prefix. Keep it that way: loose stems let boilerplate in a brief (a stale tagline, a service list) outvote the sentence that actually describes the business.

## License ledger

Approved skins carry `provenance` — `originUrl`, `demoUrl`, detected `license`, `fetchedAt`, and optionally the commit and an internal review thumbnail path. No template code is redistributed, so MIT/BSD/Apache notice obligations are not triggered; the ledger exists so any skin in the catalog can be traced back to a verified permissive source on demand.

Screenshots, when captured, are **internal review artifacts only**. A rendered demo page contains stock photos, logos, and sample copy that are frequently *not* covered by the repo's code license — never ship one in a generated site or a public gallery.

## Data

- Sources + runs: `data/admin-ingest.json`
- Candidates: `data/admin-ingest-candidates.ndjson`
- Approved skins: `data/approved-skins.json`
- Optional Supabase mirror: `supabase/migrations/002_ingest_catalog.sql`
