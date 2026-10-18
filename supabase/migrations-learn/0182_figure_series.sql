-- The series a lesson's chart draws, fetched once and kept (plan #2321.3).
--
--   learn.figure_series
--       One row per series a chart has named: a registered data source
--       (lib/learn/figures/sources.ts: fred, worldbank, owid), its series id
--       and, for the sources that need one, a country code ('' for none).
--       found is false when the source has no such series or no data for
--       that place; such a row is kept too, so a series that does not exist
--       is not asked for again. points is one {year, value} a year, oldest
--       first. Shared reference data like the catalogue: everyone signed in
--       reads it, and only the service role (the lesson writer) writes it.

set search_path = learn, public, extensions;

create table if not exists learn.figure_series (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  series_id text not null,
  place text not null default '',
  found boolean not null,
  title text,
  unit text,
  place_name text,
  url text,
  points jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  constraint figure_series_points_array_ck check (jsonb_typeof(points) = 'array'),
  constraint figure_series_key unique (source, series_id, place)
);

comment on table learn.figure_series is
  'Series fetched for lesson charts from a registered data source, kept so each is pulled once (plan #2321.3). Shared; not any one person''s.';

alter table learn.figure_series enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'learn' and tablename = 'figure_series'
       and policyname = 'figure_series_select'
  ) then
    create policy figure_series_select on learn.figure_series
      for select to authenticated using (true);
  end if;
end;
$$;

grant select on learn.figure_series to authenticated;
grant all on learn.figure_series to service_role;
revoke all on table learn.figure_series from anon;
