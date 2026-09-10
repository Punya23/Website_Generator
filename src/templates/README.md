# Verbatim template pipeline

Builds sites out of **real HTML templates kept as they are**. Markup and CSS come from the source
template; the only visual transform is a colour remap onto a target palette. Sections for one page
are drawn from **different** templates — hero from one, footer from another — so a generated site
is a composition, not a copy of a single template.

This is deliberately the opposite of [`src/skins/`](../skins/README.md) and
[`src/admin/`](../admin/README.md), which never vendor third-party HTML and re-render everything
through the app's own section library. Both paths still exist; verbatim is the default when a
corpus has been ingested.

## Run it

```bash
npm run templates:ingest          # ingest every zip in templates_bundle/
npm run templates:ingest -- --force   # re-ingest, ignoring the content-hash cache
npm run templates:backfill-taxonomy   # re-categorize an already-ingested corpus in place
npm run templates:backfill-theme      # fill in light/dark origin for pre-existing templates
npm run dev -- "Your business in a line or two"
```

`templates_bundle/` and `data/template-cache/` are gitignored — the corpus is expected to reach
tens of GB and never belongs in the repo.

## Pipeline

1. **Normalize** (`ingest/normalize-archive.ts`) — extract the zip, recursively extract nested
   archives, then score directories to find the real template root and discard documentation
   folders. Extraction is hand-rolled on `yauzl` rather than `extract-zip`, whose published
   versions carry an unpatched symlink path-traversal advisory (GHSA-jmr9-qjv8-65gv); entries that
   escape the destination, symlinks, oversized archives and entry-count bombs are all refused.
   An ambiguous root is parked as `needs_review` instead of guessed at.
2. **Split** (`ingest/extract-sections.ts`) — outermost `section|header|footer|nav` elements, with
   a div-block fallback for templates that use no semantic tags. Template `<script>` tags are
   dropped: third-party JS from several templates on one page cannot be validated at corpus scale.
3. **Namespace** (`ingest/id-rewrite.ts`, `ingest/asset-manifest.ts`) — element ids are prefixed
   (and every in-document reference follows), and assets move to `_tpl-assets/<templateId>/…` so
   two templates' `assets/img/logo.png` cannot collide.
4. **Scope** (`ingest/scope-css.ts`) — every selector is nested under `[data-tpl="<id>"]` via a
   selector AST, keyframes are namespaced, and `html`/`body`/`:root` rules are re-pointed at the
   scope root. This is what lets two Bootstrap-based templates share a page without their resets
   fighting. Malformed CSS is expected: `//` line comments are stripped, a tolerant parser backs
   up the strict one, and an unparseable selector costs that rule, not the stylesheet.
5. **Recolor** (`ingest/recolor-css.ts`) — every colour literal, not just custom properties (real
   templates scatter raw hex outside `var()`). Background-role colours rank-map onto the palette's
   ramp so layering survives; accents keep their hue with lightness clamped; shadows collapse to
   black keeping alpha.
6. **Classify** (`ingest/classify-section.ts`) — role from tag/id/class/heading first, Ollama only
   when that is inconclusive. Copy slots (brand, CTA, contact details, service cards, headings) are
   located deterministically — a model is never asked to write markup or a selector.
7. **Categorize** (`ingest/classify-taxonomy.ts`) — what vertical the template is *for*, read from
   the template itself: hero headline (heaviest), page `<title>`s, nav labels, section headings and
   body copy, weighted against the bundle folder name and the zip filename, all scored through the
   same `classifyTaxonomy` a business brief goes through. Weighting is the point — one hero saying
   "Fine Dining Restaurant" beats a whole footer's worth of boilerplate, and beats a folder name
   that says otherwise. Structural vocabulary is suppressed where it is not a claim about the
   business: nav labels like *Home / Blog / Shop* are dropped, and *Latest News / Recent Posts*
   chrome words are stripped from the low-weight heading and body evidence (they were tagging
   factory and makeup-artist templates as magazines). Nothing recognisable anywhere leaves the
   template untagged rather than guessing.
8. **Select** (`select.ts`, `taxonomy-scope.ts`) — the brief's own classification is a **hard gate**
   before any ranking: the site is scoped to one taxonomy tier (exact industry → near-miss industry
   → same coarse category), descending only as far as nav/hero/footer require, with optional roles
   widening individually. Strict mode (default; `TEMPLATE_STRICT_TAXONOMY=0` disables) refuses an
   unrelated template outright and yields only when the corpus cannot build a page at all — logged
   as a warning and recorded on the generation. On top of that the site locks to one original
   light/dark origin, choosing only a theme that leaves every required role fillable. Within what
   survives both gates, selection is deterministic and seeded, prefers templates this site has not
   used yet, and remembers what a `consumerId` has already been given.
9. **Compose** (`compose.ts`) — substitutes brief copy through the recorded slots, rebuilds the nav
   for the site's real pages, wraps each section in `[data-tpl]`, and emits the file copy list.

## What is deliberately not kept as-is

Everything here exists because shipping the template author's content on a customer's site would be
wrong, not because the markup needed improving:

- **Contact details** are always replaced — with details found in the brief, otherwise a visible
  placeholder. A template's own email/phone must never reach a generated site.
- **Image logos** are swapped for the business's name as text; rewriting `alt` alone would leave
  another company's wordmark rendered in pixels.
- **Lorem ipsum, the author's postal address and "Copyrights 2019 <template>" credits** are
  rewritten from the brief (`copy-slots.ts: neutralizeTemplateFiller`).
- **Testimonial and team sections are skipped by default.** The brief has no real customer quotes
  or staff, so placing them means shipping invented people. `TEMPLATE_ALLOW_FABRICATED_PEOPLE=1`
  overrides this.
- **Nav dropdowns** advertising the template's demo pages are replaced with this site's pages,
  reusing the template's own list markup so the styling carries over.

## Editing a generated site

`revise.ts` is the verbatim counterpart to `src/editor/apply-revision.ts` (which patches internal
component props and cannot touch vendored markup): text edits resolve through the same slot
locators, and "use a different hero" re-picks that one role and recomposes.

## Admin

`GET /api/admin/local-templates` (corpus summary), `GET /api/admin/local-templates/:id`,
`POST /api/admin/local-templates/ingest`, `.../ingest-one`, `.../reindex`.
