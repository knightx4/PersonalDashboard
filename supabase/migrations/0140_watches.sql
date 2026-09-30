-- Watches, and the readings each one takes (plan #1291).
--
-- A watch is something the person asked Dash to keep an eye on outside the
-- app: the cheapest resale ticket on a page, for now. Each hour a run takes a
-- reading of every running watch (#1293), pushes to their phone when the
-- condition is met at a new low, sends a trend report at the times set on the
-- watch (#1294), and ends the watch at ends_at. The home page lists the
-- running ones with their latest reading (#1295), and Ask Dash starts one from
-- plain words (#1296).
--
-- core.watches, one row per watch:
--   title          what is being watched, as the home page names it
--   url            the page read each hour; https only
--   reading        what is read from the page. 'lowest_price' is the cheapest
--                  listing (lib/watch/read-price.ts, #1292). A new kind is a
--                  new value in the check below.
--   condition      what fires it, as a jsonb object. {"below": 200} fires
--                  when the value read is under 200; {} never fires, and the
--                  watch only reports. currency, when set, is the one the
--                  value is in ("USD").
--   report_times   the times of day, in the person's own zone
--                  (core.account_settings.timezone), when a report is sent
--                  whether or not the watch fired. Empty for none.
--   ends_at        when the watch stops by itself
--   goal_item_id   the goals.items step it serves, when it was started from
--                  one. No foreign key: goals is migrated after core
--                  (scripts/db-reset.sh), so the run checks it exists.
--   status         'running' until it ends: 'ended' when ends_at passed,
--                  'stopped' when the person stopped it
--   fired_value    the value it last fired at, and fired_at when, so the run
--                  pushes again only at a new low
--   reported_at    when the last report went, so each report time sends once
--
-- core.watch_readings, one row per reading:
--   taken_at   when it was read
--   value      the number read; null when the read failed
--   detail     whatever else the read found, such as {currency, count,
--              listings, top_offer}, and a report's text when one was sent
--   error      why the read failed; null when it worked. A read that finds
--              nothing is an error, never a zero, so exactly one of value and
--              error is set.
--
-- core.watches holds what the person wants, so it is a source for Goals
-- (lib/core/sources.ts); the readings are bookkeeping. The person reads,
-- starts, edits and stops their own watches; readings are written by the run
-- with the service role and are theirs to read.

set search_path = core, public, extensions;

create table core.watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  title text not null,
  url text not null,
  reading text not null default 'lowest_price',
  condition jsonb not null default '{}'::jsonb,
  report_times time[] not null default '{}',
  ends_at timestamptz not null,
  goal_item_id uuid,
  status text not null default 'running',

  fired_value numeric,
  fired_at timestamptz,
  reported_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint watches_title_ck check (btrim(title) <> '' and length(title) <= 200),
  constraint watches_url_ck check (url ~ '^https://' and length(url) <= 2000),
  constraint watches_reading_ck check (reading in ('lowest_price')),
  constraint watches_condition_ck check (jsonb_typeof(condition) = 'object'),
  constraint watches_report_times_ck check (cardinality(report_times) <= 6),
  constraint watches_status_ck check (status in ('running', 'ended', 'stopped')),
  constraint watches_fired_ck check ((fired_value is null) = (fired_at is null)),
  -- Lets a reading carry its owner and be checked against the watch's.
  constraint watches_id_user_uq unique (id, user_id)
);

-- The hourly run's list, and the home page's.
create index watches_running_idx on core.watches (user_id, ends_at) where status = 'running';

create table core.watch_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  watch_id uuid not null,

  taken_at timestamptz not null default now(),
  value numeric,
  detail jsonb not null default '{}'::jsonb,
  error text,

  constraint watch_readings_watch_fk foreign key (watch_id, user_id)
    references core.watches (id, user_id) on delete cascade,
  constraint watch_readings_detail_ck check (jsonb_typeof(detail) = 'object'),
  constraint watch_readings_outcome_ck check (
    (value is null) = (error is not null)
    and (error is null or (btrim(error) <> '' and length(error) <= 1000))
  )
);

-- The latest reading of a watch, and its history for the trend.
create index watch_readings_watch_taken_idx on core.watch_readings (watch_id, taken_at desc);

-- core.touch_updated_at is 0040's, shared by the core tables.
create trigger watches_touch_updated_at
  before update on core.watches
  for each row execute function core.touch_updated_at();

alter table core.watches enable row level security;
alter table core.watch_readings enable row level security;

create policy watches_select on core.watches for select to authenticated
  using (user_id = (select auth.uid()));
create policy watches_insert on core.watches for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy watches_update on core.watches for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy watches_delete on core.watches for delete to authenticated
  using (user_id = (select auth.uid()));

create policy watch_readings_select on core.watch_readings for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.watches from public, anon, authenticated;
revoke all on core.watch_readings from public, anon, authenticated;
grant select, insert, delete on core.watches to authenticated;
grant update (title, url, condition, report_times, ends_at, goal_item_id, status)
  on core.watches to authenticated;
grant select on core.watch_readings to authenticated;
grant all on core.watches to service_role;
grant all on core.watch_readings to service_role;

comment on table core.watches is
  'Things Dash watches outside the app, such as a resale price, with what fires each and when it ends (plan #1291).';
comment on column core.watches.condition is
  'What fires it: {"below": 200} fires under 200; {} only reports. currency names the unit when set.';
comment on column core.watches.report_times is
  'Times of day in the person''s zone when a report is sent whether or not it fired.';
comment on table core.watch_readings is
  'Each reading a watch took: the value, or the error when the page could not be read (plan #1291).';
