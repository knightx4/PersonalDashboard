-- What the overnight runner is doing, so closing the tab does not end it.
--
-- The runner is one button pressed before bed: from then on a cron tick fires
-- one feature at a time, waits for it, and fires the next, until nothing
-- assigned to Claude is ready, the budget is spent, the stop time passes or
-- you pause it. Every one of those facts has to outlive the browser -- the tick
-- runs in Postgres at three in the morning with nobody's session open -- so
-- none of it can live in a page's state or in a cookie.
--
-- One row per account, not one per night. The question the tick asks is "may I
-- fire another feature right now", and that has exactly one answer at a time
-- per account; a table of nights would answer it with "the newest row, if it
-- is still open", which is the same answer read the long way round and one
-- more thing to get wrong at two in the morning. The night that just ended is
-- still readable until the next one starts, which is what the morning report
-- wants, and the runs it fired are in `plan_runs` with their timestamps.
--
-- Beside `plan_runs` rather than inside it. A `plan_runs` row is one press and
-- what Anthropic answered; this is the standing intention that causes those
-- presses. Folding the two together would mean either a run row that is not a
-- run or a column on every press that only one press in twenty uses.
--
-- `ended_reason` is a written sentence rather than a code, because it is read
-- back to a person at breakfast rather than switched on: "It fired every one
-- of the 6 features you allowed." is the whole answer, and a `budget_spent`
-- enum would need a table of English somewhere else to say the same thing.
-- The set of reasons is also not closed -- the tick has reasons the row cannot
-- know, like nothing being ready to build -- so a check constraint naming them
-- would be out of date by the next step.
--
-- The rules are in `lib/plan/overnight.ts`, which is the only thing that
-- writes this row.

set search_path = public, extensions;

create table if not exists plan_overnight_runs (
  id uuid primary key default gen_random_uuid(),
  -- One row per account, which is what makes this a state rather than a log.
  user_id uuid not null unique references auth.users (id) on delete cascade,
  -- The runner is on. Off is the resting state and what a fresh account has.
  running boolean not null default false,
  -- Held, by hand, with the run still on. Pausing is not stopping: the budget
  -- and the stop time survive it, so resuming carries on where it was rather
  -- than starting a second night.
  paused boolean not null default false,
  -- How many features the night was given when it started. Kept beside what is
  -- left so that the reason a spent run ends can say how many that was, and so
  -- the page can draw "two of six left" without counting rows.
  features_budget integer not null default 0,
  -- How many features it may still fire. Counted down by one as each is fired,
  -- not as each finishes: a feature that fell over cost the budget the same as
  -- one that worked, and a counter that only moves on success is a counter
  -- that never stops.
  features_left integer not null default 0,
  -- When it should stop by, whatever is left of the budget. The second of the
  -- two brakes, and the one that catches a night where every feature is
  -- cheaper than expected.
  stop_by timestamptz,
  -- When the button was pressed. The window the morning report covers.
  started_at timestamptz,
  -- When a feature was last fired. The tick reads it to know whether the last
  -- one is still going, so it cannot start a second before the first is done.
  last_fired_at timestamptz,
  -- When it stopped, and why, in a sentence.
  ended_at timestamptz,
  ended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A budget is a number of features, and a typo of 1000 is a bill rather than
  -- a plan. Nothing here is going to get through a hundred features in a night.
  constraint plan_overnight_runs_budget_ck check (
    features_budget >= 0 and features_budget <= 100
  ),
  -- What is left is part of what was given. A run cannot owe itself features.
  constraint plan_overnight_runs_left_ck check (
    features_left >= 0 and features_left <= features_budget
  ),
  -- Paused means held mid-run. There is nothing to hold when it is not running,
  -- and a paused row left behind by a finished night would read as a night you
  -- could resume.
  constraint plan_overnight_runs_paused_while_running_ck check (
    not paused or running
  ),
  -- A run that is on was started and has a time to stop by. Both brakes are
  -- set at the press or there is no press.
  constraint plan_overnight_runs_running_has_brakes_ck check (
    not running or (started_at is not null and stop_by is not null)
  ),
  -- A run that ended carries the reason it ended, and a reason without an end
  -- is a sentence about nothing. The two are one fact and are written together.
  constraint plan_overnight_runs_ended_reason_ck check (
    (ended_at is null) = (ended_reason is null)
  ),
  -- Still going, so it has not ended. Starting again clears both.
  constraint plan_overnight_runs_running_has_not_ended_ck check (
    not running or ended_at is null
  ),
  -- A sentence, not a transcript. The morning report reads it back whole.
  constraint plan_overnight_runs_ended_reason_length_ck check (
    ended_reason is null or (length(ended_reason) between 1 and 500)
  )
);

-- The unique on `user_id` is the index for "what is this account doing". This
-- one is for the other question, asked by the tick rather than by a page:
-- which accounts are mid-run at all. Partial, because on all but a few minutes
-- of the day the answer is none.
create index if not exists plan_overnight_runs_running_idx
  on plan_overnight_runs (user_id)
  where running;

drop trigger if exists plan_overnight_runs_touch_updated_at on plan_overnight_runs;
create trigger plan_overnight_runs_touch_updated_at
  before update on plan_overnight_runs
  for each row execute function public.touch_updated_at();

alter table plan_overnight_runs enable row level security;

drop policy if exists plan_overnight_runs_select on plan_overnight_runs;
create policy plan_overnight_runs_select on plan_overnight_runs for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists plan_overnight_runs_insert on plan_overnight_runs;
create policy plan_overnight_runs_insert on plan_overnight_runs for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists plan_overnight_runs_update on plan_overnight_runs;
create policy plan_overnight_runs_update on plan_overnight_runs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists plan_overnight_runs_delete on plan_overnight_runs;
create policy plan_overnight_runs_delete on plan_overnight_runs for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud rather than left to the project's default privileges, for the
-- reasons 0050 spells out.
grant select, insert, update, delete on plan_overnight_runs to authenticated;

revoke all on table plan_overnight_runs from anon;
