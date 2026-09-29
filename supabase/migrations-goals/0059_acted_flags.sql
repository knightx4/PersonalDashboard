-- ===========================================================================
-- Flag a run that acted outside the plan (plan #1184).
--
-- 0058 holds a Claude step that would act outside the plan before a run works
-- it. This is the check afterwards: once a goals run has finished, the app
-- reads each Claude step it closed with no approved `acts` sentence, asks Jev
-- whether what the run wrote on it says it sent, submitted, booked, bought or
-- changed a record elsewhere, and flags the goal when it did
-- (lib/goals/acted-flags-store.ts). Nothing is undone.
--
--   goals.runs.acts_checked_at   when that check was made on the run. The
--                                overnight tick, every four minutes, reads
--                                finished runs where this is null, so Jev is
--                                asked about a run's closes once. Left null
--                                while Jev has not answered for every step.
--
--   raised_items_acted_step_uq   one flag per step. A flag from this check
--                                carries the source 'goals acts check <step
--                                id>', and a second insert for the same step
--                                fails on this index, however many runs or
--                                ticks read the close again.
-- ===========================================================================

alter table goals.runs add column if not exists acts_checked_at timestamptz;

comment on column goals.runs.acts_checked_at is
  'Plan #1184: when the app checked the steps this run closed for an action outside the plan. Null until checked.';

create index if not exists runs_acts_unchecked_idx
  on goals.runs (ended_at)
  where acts_checked_at is null and status <> 'started';

create unique index if not exists raised_items_acted_step_uq
  on public.raised_items (user_id, source)
  where source like 'goals acts check %';
