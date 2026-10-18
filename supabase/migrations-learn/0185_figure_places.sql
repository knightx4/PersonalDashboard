-- The places a lesson's map shows, located once and kept (plan #2321.6).
--
--   learn.figure_places
--       One row per place a map has named, keyed by the query the geocoder
--       was asked (lib/learn/figures/places.ts: the place's name and the
--       area the case is about, lower-cased, as in 'faneuil hall, boston,
--       massachusetts'). found is false when the geocoder (OpenStreetMap's
--       Nominatim) had no such place; that row is kept too, so a place that
--       cannot be found is not asked for again. Coordinates come only from
--       here, never from the lesson writer. Shared reference data like
--       figure_series: everyone signed in reads it, and only the service
--       role (the lesson writer) writes it.

set search_path = learn, public, extensions;

create table if not exists learn.figure_places (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  found boolean not null,
  lat double precision,
  lon double precision,
  display_name text,
  osm_url text,
  fetched_at timestamptz not null default now(),
  constraint figure_places_query_key unique (query),
  constraint figure_places_found_ck check (
    not found or (lat between -90 and 90 and lon between -180 and 180)
  )
);

comment on table learn.figure_places is
  'Places located for lesson maps by a registered geocoder, kept so each is asked for once (plan #2321.6). Shared; not any one person''s.';

alter table learn.figure_places enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'learn' and tablename = 'figure_places'
       and policyname = 'figure_places_select'
  ) then
    create policy figure_places_select on learn.figure_places
      for select to authenticated using (true);
  end if;
end;
$$;

grant select on learn.figure_places to authenticated;
grant all on learn.figure_places to service_role;
revoke all on table learn.figure_places from anon;
