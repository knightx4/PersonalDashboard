-- Watches Dash writes itself for someone on People (plan #3030.1.1, under #3030.1).
--
-- When the person asks someone on People to text them about something no
-- fixed watch reads ("tell me when a vault note mentions my sister"), Dash
-- writes a query of its own instead of refusing. It is kept here as proposed
-- and nothing runs it until the person approves it (#3030.1.2). The daily
-- round then runs it on its cadence (#3030.1.3), and the mentor's page lists
-- it with a Stop (#3030.1.4).
--
-- The query is the input query_rows takes (lib/ask/query.ts): one table of
-- the tables list_rows reads, conditions on its own columns, optional linked
-- conditions, an order and a limit. It is run through query_rows for the
-- owner, so it can only read and only the owner's rows; no SQL text is kept.
--
--   advisor_id   the person on People who will text about it
--   key          the name advisor_reach_outs.watch_key records it under
--   brief        what the person asked for, in their words
--   about        what it checks, in plain words, for the card
--   sends_when   what would make a text go out
--   sample       what a text would look like
--   query        the query_rows input, with at least its table
--   tables       the tables it reads, for the card
--   every_days   how often it is checked, 1 to 90 days
--   mode         each (a text per new match) or roundup (one about all new)
--   status       proposed, active, declined, paused or stopped
--   matched      how many rows the query matched when Dash wrote it
--   failures     runs in a row that errored; three pause it (#3030.1.3)
--   last_error   the last run's error, in words
--   last_run_at  when the round last ran it
--   seen         what the last run matched, ref to fingerprint, so only new
--                or changed rows lead to a text
--   decided_at   when it was approved, declined or stopped
--
-- The person's own client writes proposals (Ask Dash runs set_reach_out as
-- them) and may delete one only while it is proposed, which is how Undo takes
-- it back. Schema change only. No row of any account is written.

set search_path = you, public, extensions;

create table you.advisor_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  advisor_id uuid not null,
  key text not null,
  brief text not null,
  about text not null,
  sends_when text not null,
  sample text not null,
  query jsonb not null,
  tables text[] not null,
  every_days integer not null default 1,
  mode text not null default 'each',
  status text not null default 'proposed',
  matched integer,
  failures integer not null default 0,
  last_error text,
  last_run_at timestamptz,
  seen jsonb not null default '{}'::jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint advisor_watches_key_ck check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint advisor_watches_brief_ck check (char_length(btrim(brief)) between 1 and 2000),
  constraint advisor_watches_about_ck check (char_length(btrim(about)) between 1 and 200),
  constraint advisor_watches_sends_when_ck check (char_length(btrim(sends_when)) between 1 and 300),
  constraint advisor_watches_sample_ck check (char_length(btrim(sample)) between 1 and 400),
  constraint advisor_watches_query_ck
    check (jsonb_typeof(query) = 'object' and jsonb_typeof(query -> 'table') = 'string'),
  constraint advisor_watches_tables_ck check (cardinality(tables) between 1 and 6),
  constraint advisor_watches_every_days_ck check (every_days between 1 and 90),
  constraint advisor_watches_mode_ck check (mode in ('each', 'roundup')),
  constraint advisor_watches_status_ck
    check (status in ('proposed', 'active', 'declined', 'paused', 'stopped')),
  constraint advisor_watches_matched_ck check (matched is null or matched >= 0),
  constraint advisor_watches_failures_ck check (failures >= 0),
  constraint advisor_watches_last_error_ck check (last_error is null or char_length(last_error) <= 600),
  constraint advisor_watches_seen_ck check (jsonb_typeof(seen) = 'object'),
  constraint advisor_watches_key_unique unique (user_id, advisor_id, key),
  foreign key (advisor_id, user_id)
    references you.board_advisors (id, user_id) on delete cascade
);

comment on table you.advisor_watches is
  'Watches Dash wrote itself for someone on People when no fixed watch covered what the person asked them to text about: a query_rows query, proposed until the person approves it (plan #3030.1).';
comment on column you.advisor_watches.query is
  'The query_rows input (lib/ask/query.ts) the watch runs for the owner: table, where, linked, order and limit (plan #3030.1.1).';
comment on column you.advisor_watches.status is
  'proposed until the person decides; active runs on its cadence; declined, paused (three failed runs) or stopped run nothing (plan #3030.1).';
comment on column you.advisor_watches.seen is
  'What the last run matched, each row''s ref to a fingerprint of it, so only new or changed rows lead to a text (plan #3030.1.3).';

create index advisor_watches_advisor_idx on you.advisor_watches (user_id, advisor_id, created_at desc);
create index advisor_watches_active_idx on you.advisor_watches (user_id) where status = 'active';

create trigger advisor_watches_touch_updated_at
  before update on you.advisor_watches
  for each row execute function you.touch_updated_at();

alter table you.advisor_watches enable row level security;

create policy advisor_watches_select on you.advisor_watches for select to authenticated
  using (user_id = (select auth.uid()));
create policy advisor_watches_insert on you.advisor_watches for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'proposed');
create policy advisor_watches_update on you.advisor_watches for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy advisor_watches_delete on you.advisor_watches for delete to authenticated
  using (user_id = (select auth.uid()) and status = 'proposed');

revoke all on you.advisor_watches from anon, authenticated;
grant select, insert, update, delete on you.advisor_watches to authenticated;
grant select, insert, update, delete on you.advisor_watches to service_role;

notify pgrst, 'reload schema';
