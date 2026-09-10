-- Template corpus, categorization and generation history.
--
-- Everything here is currently served from local files (`data/template-cache/*/manifest.json`,
-- `data/template-store.json`, `data/generation-history.ndjson`, `data/site-state/*.json`). That is
-- fine for one operator on one machine and wrong for anything else: the index is rebuilt by reading
-- ~900 JSON files, "which templates are in the health-clinic vertical" is a full scan, and two
-- processes writing at once is a lost update.
--
-- This is the shape that replaces it when a Postgres connection is available. It is deliberately a
-- faithful projection of the existing types (`src/templates/types.ts`, `generation-store.ts`,
-- `revise.ts`) rather than a redesign, so `FileTemplateRepository` and a Postgres implementation of
-- the same interface (`src/templates/db/repository.ts`) can return identical objects and the rest of
-- the app cannot tell which one it is talking to.
--
-- Apply with:  psql "$DATABASE_URL" -f src/templates/db/schema.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- Taxonomy: the vocabularies selection ranks against. Kept as tables rather
-- than enums so a new vertical is an INSERT, not a migration + redeploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS template_categories (
  id          TEXT PRIMARY KEY,           -- 'local-service', 'hospitality', …
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS template_industries (
  id           TEXT PRIMARY KEY,          -- 'health-clinic', 'construction', …
  category_id  TEXT NOT NULL REFERENCES template_categories(id) ON DELETE RESTRICT,
  label        TEXT NOT NULL,
  -- Matching vocabulary, mirroring INDUSTRY_DEFS in src/skins/taxonomy.ts.
  strong_keywords TEXT[] NOT NULL DEFAULT '{}',
  weak_keywords   TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS template_archetypes (
  id     TEXT PRIMARY KEY,                -- 'storefront', 'portfolio', 'booking', …
  label  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- The corpus.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  template_id        TEXT PRIMARY KEY,     -- tpl_<12 hex of the source zip's sha256>
  name               TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('ingesting','ready','needs_review','failed')),
  review_reason      TEXT,

  source_zip_path    TEXT NOT NULL,
  source_root_rel    TEXT NOT NULL DEFAULT '',
  source_css_hash    TEXT,
  palette_id         TEXT,

  -- Categorization. `industry_runners_up` keeps the near-miss tier selection widens into when a
  -- vertical is thin, and `taxonomy_source` records whether the folder, the markup, or both
  -- produced the classification — a mis-fitting site stays diagnosable from the row alone.
  source_category_hint TEXT,
  category_id        TEXT REFERENCES template_categories(id) ON DELETE SET NULL,
  industry_id        TEXT REFERENCES template_industries(id) ON DELETE SET NULL,
  archetype_id       TEXT REFERENCES template_archetypes(id) ON DELETE SET NULL,
  industry_runners_up TEXT[] NOT NULL DEFAULT '{}',
  industry_confidence REAL,
  taxonomy_source    TEXT CHECK (taxonomy_source IN ('folder','content','combined','none')),
  universal_fit      BOOLEAN NOT NULL DEFAULT FALSE,

  -- The template's ORIGINAL light/dark theme, before recolor forces the target palette. Sites lock
  -- to one of these so originally-light and originally-dark sections never mix.
  theme              TEXT CHECK (theme IN ('light','dark')),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Selection filters by (role, industry/category, theme) on every pick, for every role, on every
-- page — this is the hot path and the reason the JSON index exists at all.
CREATE INDEX IF NOT EXISTS templates_industry_idx ON templates (industry_id) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS templates_category_idx ON templates (category_id) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS templates_theme_idx    ON templates (theme)       WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS templates_status_idx   ON templates (status);

CREATE TABLE IF NOT EXISTS template_sections (
  template_id     TEXT NOT NULL REFERENCES templates(template_id) ON DELETE CASCADE,
  section_id      TEXT NOT NULL,          -- sec_003_hero, unique within a template only
  role            TEXT NOT NULL,
  role_confidence REAL NOT NULL DEFAULT 0,
  role_source     TEXT NOT NULL CHECK (role_source IN ('heuristic','llm')),
  source_order    INTEGER NOT NULL DEFAULT 0,
  -- Where the cached fragment lives. Content itself stays on disk/object storage: these are whole
  -- HTML sections, and the database is for selecting them, not for serving them.
  html_cache_path TEXT NOT NULL,
  -- Copy/photo locators, as recorded at ingest (SlotLocator[] / PhotoSlot[]).
  slots           JSONB NOT NULL DEFAULT '[]',
  photo_slots     JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (template_id, section_id)
);

-- The pool query: "ready sections of this role, in this vertical, of this theme".
CREATE INDEX IF NOT EXISTS template_sections_role_idx ON template_sections (role);

CREATE TABLE IF NOT EXISTS template_assets (
  template_id      TEXT NOT NULL REFERENCES templates(template_id) ON DELETE CASCADE,
  cached_rel_path  TEXT NOT NULL,
  output_rel_path  TEXT NOT NULL,
  PRIMARY KEY (template_id, cached_rel_path)
);

-- ---------------------------------------------------------------------------
-- Generations: which template filled every section, and what changed in it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generations (
  id             TEXT PRIMARY KEY,        -- gen_<base36 ts><random>
  consumer_id    TEXT,
  business_name  TEXT NOT NULL,
  raw_brief      TEXT NOT NULL,
  theme          TEXT CHECK (theme IN ('light','dark')),
  -- The taxonomy gate this site was built under (industry/category/archetype/tier/strict/widened).
  taxonomy       JSONB,
  stats          JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generations_consumer_idx ON generations (consumer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generations_created_idx  ON generations (created_at DESC);

CREATE TABLE IF NOT EXISTS generation_sections (
  generation_id  TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  page_slug      TEXT NOT NULL,
  position       INTEGER NOT NULL,
  template_id    TEXT NOT NULL,           -- intentionally not an FK: the record must survive the
  template_name  TEXT NOT NULL,           -- template being re-ingested under a new hash or removed
  section_id     TEXT NOT NULL,
  role           TEXT NOT NULL,
  photos_applied INTEGER NOT NULL DEFAULT 0,
  photos_skipped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (generation_id, page_slug, position)
);

CREATE INDEX IF NOT EXISTS generation_sections_template_idx ON generation_sections (template_id);

-- One row per substitution, so "what did we change on this site" is answerable without diffing.
CREATE TABLE IF NOT EXISTS generation_changes (
  id             BIGSERIAL PRIMARY KEY,
  generation_id  TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  page_slug      TEXT NOT NULL,
  position       INTEGER NOT NULL,
  kind           TEXT NOT NULL,           -- slot kind, or filler:* / photo:*
  selector       TEXT NOT NULL,
  before_text    TEXT NOT NULL,
  after_text     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS generation_changes_gen_idx ON generation_changes (generation_id);

-- ---------------------------------------------------------------------------
-- Editable site state — what the preview's Edit mode reads and writes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_states (
  key           TEXT PRIMARY KEY,          -- 'playground', or a consumer/site id
  business_name TEXT NOT NULL,
  raw_brief     TEXT NOT NULL,
  brief         JSONB NOT NULL,            -- ExpandedBrief
  pages         JSONB NOT NULL,            -- Record<slug, PlacedSection[]>
  overrides     JSONB NOT NULL DEFAULT '{}',  -- '<templateId>:<sectionId>#<n>' -> text
  photos        JSONB NOT NULL DEFAULT '{}',  -- pinned resolved image URLs
  palette_id    TEXT,
  logo_src      TEXT,
  theme         TEXT CHECK (theme IN ('light','dark')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-consumer memory of placed sections, so a repeat generation for one customer varies.
CREATE TABLE IF NOT EXISTS consumer_section_history (
  consumer_id  TEXT NOT NULL,
  section_key  TEXT NOT NULL,              -- '<templateId>:<sectionId>'
  used_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_id, section_key)
);

COMMIT;
