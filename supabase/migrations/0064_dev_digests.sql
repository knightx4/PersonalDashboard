-- The morning summary shown at the top of /dev/raised.
--
-- Everything on it could be computed when the page loads: the closed steps are
-- in plan_items, the fixed notes are in feedback_items, and what is ready to
-- pick up falls out of lib/plan/tree.ts. The part that cannot is the short
-- list of things worth looking at, which is a reading rather than a query --
-- an idea nobody has shaped in a week, two open questions holding up the same
-- feature. That needs a model call, and a model call on every page load is
-- both a bill and a summary that says something different each time you
-- refresh.
--
-- So it is written once a day by the daily cron and read as a row. The day it
-- covers is the date the run started, in UTC, which is the same date the cron
-- ticks on: the schedule is 12:00 UTC, far enough from midnight either way
-- that no plausible timezone disagrees about which day it is.
--
-- `happened` and `attention` are jsonb arrays rather than two child tables.
-- Nothing queries inside them, nothing links to an entry, and a digest is
-- written whole and read whole -- the row is a rendering, not a record other
-- rows point at. lib/digest/load.ts reads each entry defensively for the same
-- reason every other loader here does: a shape written by an older deploy
-- must not take the page down.
--
-- No update policy and no insert policy. The cron writes these with the
-- service role and nobody else writes them at all; a digest you could edit
-- would be a summary that no longer summarises anything.

set search_path = public, extensions;

create table if not exists dev_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The day it covers, as a UTC date. One per day, which is what makes the
  -- summary the same all day however many times the cron is retried.
  day date not null,
  -- The start of the window it read. 24 hours before the run, so the page can
  -- say what "since" means rather than implying a calendar day.
  since timestamptz not null,
  -- What landed in the window: closed plan steps and their commits, fixed
  -- notes, answered decisions.
  happened jsonb not null default '[]'::jsonb,
  -- The short list worth a look: what is ready to be picked up, what is
  -- waiting on an answer, and what the model noticed.
  attention jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint dev_digests_user_day_uq unique (user_id, day),
  constraint dev_digests_happened_array_ck check (jsonb_typeof(happened) = 'array'),
  constraint dev_digests_attention_array_ck check (jsonb_typeof(attention) = 'array')
);

-- The one query the page runs: the newest digest for the account. The unique
-- constraint above is (user_id, day) ascending, which cannot serve a
-- descending read of the newest without a sort.
create index if not exists dev_digests_user_day_idx on dev_digests (user_id, day desc);

alter table dev_digests enable row level security;

drop policy if exists dev_digests_select on dev_digests;
create policy dev_digests_select on dev_digests for select to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud rather than left to the project's default privileges, for the
-- reasons 0050 spells out: the grant is what makes this migration true on a
-- database rebuilt from the migrations alone, and the revoke is because those
-- same defaults hand every new table to `anon`.
grant select on dev_digests to authenticated;

revoke all on table dev_digests from anon;
