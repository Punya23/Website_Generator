-- Ingest catalog: sources, candidates, agent runs (jsonb documents)

create table if not exists public.ingest_sources (
  id text primary key,
  doc jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ingest_candidates (
  id text primary key,
  source_id text,
  status text,
  doc jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists ingest_candidates_status_idx on public.ingest_candidates (status);
create index if not exists ingest_candidates_source_idx on public.ingest_candidates (source_id);

create table if not exists public.ingest_runs (
  id text primary key,
  status text,
  doc jsonb not null,
  started_at timestamptz not null default now()
);
