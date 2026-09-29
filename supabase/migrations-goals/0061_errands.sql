-- ===========================================================================
-- Mark a goal as an errand (plan #1261).
--
-- Feature #1260 gives one-off jobs with a date, such as finding a birthday
-- gift, a home in Goals without the weight of a life goal. An errand is a goal
-- like any other: it sits under an area, has steps, and is mapped by a run.
-- What makes it one is a flag on its row, and an errand always has a date it
-- is due by:
--
--   items.errand   true on a goal that is an errand. False on every other
--                  goal and on every step.
--
-- What the database holds an errand to, for every writer:
--
--   - only a goal can be one, so the flag is refused on a step;
--   - an errand has a due date (items.due_on, 0001), so an errand row cannot
--     be saved without one, and the date cannot be cleared while it is one.
--
-- The guard (items_claude_guard, 0051) leaves a goal's other columns to
-- Claude once the goal is approved, so a run may turn a goal into an errand
-- or back; nothing new is needed there. The history trigger records every
-- column of the row, so the flag is in history and a run's undo can put it
-- back.
-- ===========================================================================

alter table goals.items
  add column errand boolean not null default false;

alter table goals.items
  add constraint items_errand_level_ck check (not errand or level = 'goal');

alter table goals.items
  add constraint items_errand_due_ck check (not errand or due_on is not null);

-- The goals home lists open errands by due date above the areas (plan #1262).
create index items_errands_idx on goals.items (user_id, due_on)
  where errand and archived_at is null;

comment on column goals.items.errand is
  'True on a goal that is an errand: a one-off job with a due date (plan #1261). Only a goal, and never without due_on.';

notify pgrst, 'reload schema';
