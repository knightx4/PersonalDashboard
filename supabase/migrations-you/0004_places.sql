-- The places the person has lived (plan #1991.5), on You's Places tab.
--
-- One row per home: what they call it, the city, region and country, when
-- they moved in and when they moved out. A home with no moved_out is where
-- they live now.
--
-- Dates are a year or a year and month, written 'YYYY' or 'YYYY-MM', since
-- few people remember the day they moved. Kept as text in that form rather
-- than as a date with a made-up day, so nothing reads a precision the person
-- never gave. The form sorts as text: '2019' comes before '2019-03', which
-- comes before '2020'.
--
-- Goals and Dash read it as a source (lib/you/sources.ts).

create table if not exists you.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  name text not null,
  city text,
  region text,
  country text,
  moved_in text not null,
  moved_out text,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint places_name_ck check (length(btrim(name)) between 1 and 200),
  constraint places_city_ck check (city is null or length(city) <= 200),
  constraint places_region_ck check (region is null or length(region) <= 200),
  constraint places_country_ck check (country is null or length(country) <= 200),
  constraint places_note_ck check (note is null or length(note) <= 4000),
  constraint places_moved_in_ck check (moved_in ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
  constraint places_moved_out_ck check (
    moved_out is null or moved_out ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'
  ),
  -- Out no earlier than in. A year on one side is compared by its year alone,
  -- so moving in '2019-06' and out '2019' is allowed.
  constraint places_order_ck check (
    moved_out is null
    or moved_out >= moved_in
    or left(moved_out, 4) = left(moved_in, 4)
  )
);

create index if not exists places_user_moved_in_idx on you.places (user_id, moved_in desc);

comment on table you.places is
  'The places the person has lived. moved_in and moved_out are YYYY or YYYY-MM; no moved_out means they live there now.';

create or replace function you.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function you.touch_updated_at() set search_path = you;
revoke all on function you.touch_updated_at() from public, anon, authenticated;

create or replace trigger places_touch_updated_at before update on you.places
  for each row execute function you.touch_updated_at();

alter table you.places enable row level security;

create policy places_all on you.places for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on you.places to authenticated, service_role;

notify pgrst, 'reload schema';
