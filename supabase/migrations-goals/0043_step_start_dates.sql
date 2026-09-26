-- ===========================================================================
-- A step that cannot start yet (docs/GOALS-SPEC.md, "Steps for later").
--
-- "Turn on autopay for every loan" belongs in the student debt goal, but
-- nothing is due until December, so it is a job for November. Until then it
-- should not sit among the things to do today, and a Claude step dated the
-- same way should not be worked by a run before its day.
--
-- items.starts_on is the first day a step can be done. Before it, the step
-- and everything beneath it are left out of the home's next items, the
-- morning and night runs, Todo, and the rhythms that count periods. From
-- that day it is an ordinary open step. Null, as for every step until now,
-- means it can start at once.
--
-- Only steps take one: a goal that cannot start yet is written as a goal
-- whose first step starts later. A step with both dates starts on or before
-- the day it is due.
-- ===========================================================================

alter table goals.items
  add column starts_on date,
  add constraint items_starts_on_step_ck check (starts_on is null or level = 'step'),
  add constraint items_starts_before_due_ck check (
    starts_on is null or due_on is null or starts_on <= due_on
  );

notify pgrst, 'reload schema';
