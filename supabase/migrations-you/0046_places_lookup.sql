-- The places lookup's daily cap and its day-long cache (plan #2987.2, under
-- #2987).
--
-- The chats look places up near home with Google Places Text Search
-- (lib/you/places-lookup.ts). Each call is paid for past Google's free tier,
-- so two tables keep it small:
--
-- 1. you.places_calls, one row per Places request sent to Google. A trigger
--    refuses the 51st row of a person's UTC day, which is the hard cap: the
--    row is written before the request goes out, so a refused row means no
--    request. Rows take inserts and selects only, so the day's count cannot
--    be lowered from the app.
--
-- 2. you.places_cache, what a lookup found, keyed by the query, the point it
--    searched near, the radius and the open-now filter. The lookup reads a
--    row younger than a day (an hour for open-now) instead of asking Google,
--    and a cache hit writes no row in places_calls. A place the lookup had to
--    geocode (an address other than home) is kept here too, under a
--    'geocode|' key.
--
-- Schema only: no row is written here.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The calls, and the cap.
-- ---------------------------------------------------------------------------

create table you.places_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index places_calls_user_created_idx on you.places_calls (user_id, created_at desc);

comment on table you.places_calls is
  'One row per Google Places request the places lookup sent; at most 50 per person per UTC day (you.places_calls_cap).';

alter table you.places_calls enable row level security;

create policy places_calls_select on you.places_calls for select to authenticated
  using (user_id = (select auth.uid()));
create policy places_calls_insert on you.places_calls for insert to authenticated
  with check (user_id = (select auth.uid()));
-- No update and no delete policy: a call that was made stays counted.

revoke all on you.places_calls from anon, authenticated;
grant select, insert on you.places_calls to authenticated;
grant all on you.places_calls to service_role;

create or replace function you.places_calls_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One writer at a time per person, so two lookups at the 50th call cannot
  -- both pass the count.
  perform pg_advisory_xact_lock(hashtextextended('you.places_calls:' || new.user_id::text, 0));

  if (
    select count(*)
      from you.places_calls c
     where c.user_id = new.user_id
       and c.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  ) >= 50 then
    raise exception 'The places lookup has made its 50 calls today.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function you.places_calls_cap() from public, anon, authenticated;

create trigger places_calls_cap
  before insert on you.places_calls
  for each row execute function you.places_calls_cap();

-- ---------------------------------------------------------------------------
-- 2. The cache.
-- ---------------------------------------------------------------------------

create table you.places_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'search|<query>|<lat>|<lng>|<radius>|<open now>' or 'geocode|<address>',
  -- written by lib/you/places-lookup.ts.
  cache_key text not null,
  body jsonb not null,
  fetched_at timestamptz not null default now(),
  constraint places_cache_key_ck check (length(cache_key) between 1 and 600),
  constraint places_cache_body_ck check (
    jsonb_typeof(body) = 'object' and octet_length(body::text) <= 65536
  ),
  constraint places_cache_user_key_uq unique (user_id, cache_key)
);

comment on table you.places_cache is
  'What a places lookup found, reused for a day for the same query near the same point; and points geocoded for an address other than home.';

alter table you.places_cache enable row level security;

create policy places_cache_select on you.places_cache for select to authenticated
  using (user_id = (select auth.uid()));
create policy places_cache_insert on you.places_cache for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy places_cache_update on you.places_cache for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy places_cache_delete on you.places_cache for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on you.places_cache from anon, authenticated;
grant select, insert, update, delete on you.places_cache to authenticated;
grant all on you.places_cache to service_role;

notify pgrst, 'reload schema';
