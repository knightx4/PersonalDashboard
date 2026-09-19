-- A night that runs until you stop it.
--
-- The runner has always been given two brakes at the press: how many features
-- it may fire, and when it must stop whatever is left. A check constraint
-- insisted on both, because a night with only one of them was the night nobody
-- wanted to have had -- a budget with no clock runs until it has spent
-- everything, and a clock with no budget spends whatever it can reach before
-- morning.
--
-- That reasoning holds for a night. It does not hold for the thing actually
-- wanted here, which is the runner simply left on: no bedtime, no budget, and
-- stopping when the person stops it or when the work runs out. The brakes were
-- protecting against a night that overshoots its owner's intent, and "keep
-- going" is the intent.
--
-- Null is the absence, on both columns, rather than a sentinel. A budget of
-- zero already means something else -- it is what a spent night holds, and
-- `features_left <= 0` is what ends one -- so nothing that reads a number can
-- be reused to mean no number. The two budget columns move together: a row
-- with a cap but no remainder, or the reverse, is a row no reader has a rule
-- for, so the pairing is a constraint rather than a convention.
--
-- `started_at` stays required while running. It is not a brake: it is the
-- window the morning report covers, and a running night without one has no
-- period to report on.

set search_path = public, extensions;

alter table plan_overnight_runs alter column features_budget drop not null;
alter table plan_overnight_runs alter column features_left drop not null;

-- The default stays 0 rather than null. A row that has never run is a resting
-- row, and resting at zero is what every reader already expects; null is
-- reserved for a night that was deliberately started without a cap.

alter table plan_overnight_runs drop constraint if exists plan_overnight_runs_budget_ck;
alter table plan_overnight_runs add constraint plan_overnight_runs_budget_ck
  check (features_budget is null or (features_budget >= 0 and features_budget <= 100));

alter table plan_overnight_runs drop constraint if exists plan_overnight_runs_left_ck;
alter table plan_overnight_runs add constraint plan_overnight_runs_left_ck
  check (features_left is null or (features_left >= 0 and features_left <= features_budget));

-- Both or neither, so no reader meets half a budget.
alter table plan_overnight_runs drop constraint if exists plan_overnight_runs_budget_pair_ck;
alter table plan_overnight_runs add constraint plan_overnight_runs_budget_pair_ck
  check ((features_budget is null) = (features_left is null));

-- The brakes are optional now; the window the report covers is not.
alter table plan_overnight_runs drop constraint if exists plan_overnight_runs_running_has_brakes_ck;
alter table plan_overnight_runs add constraint plan_overnight_runs_running_has_brakes_ck
  check ((not running) or (started_at is not null));

comment on column plan_overnight_runs.features_budget is
  'How many features the run was given. Null means it was started with no cap and fires until stopped.';
comment on column plan_overnight_runs.features_left is
  'How many it may still fire. Null exactly when features_budget is.';
comment on column plan_overnight_runs.stop_by is
  'When it must stop whatever is left. Null means it was started with no bedtime.';
