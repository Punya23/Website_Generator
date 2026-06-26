-- Run in Supabase SQL editor or via supabase db push

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  business_name text not null,
  site_context jsonb not null,
  status text not null default 'draft'
    check (status in ('draft', 'building', 'published', 'failed')),
  variation_seed bigint,
  published_at timestamptz,
  storage_prefix text not null,
  out_bytes bigint,
  published_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sites_slug_idx on public.sites (slug);
create index if not exists sites_status_idx on public.sites (status);

create table if not exists public.builds (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  error text,
  out_bytes bigint
);

create index if not exists builds_site_id_idx on public.builds (site_id);

-- Storage: create bucket "sites" in Supabase dashboard (public read for published assets)
-- Policy example (public read):
-- create policy "Public read published sites"
-- on storage.objects for select
-- using ( bucket_id = 'sites' );
