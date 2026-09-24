-- ---------------------------------------------------------------------------
-- 0010 -- goal steps can be put off and dismissed on the agenda.
--
-- A step you press "Show on Todo" on is read from goals.items at query time
-- (lib/todo/agenda/sources/goal-steps.ts) and never copied here. Ticking it
-- closes the step in Goals, because that is the same row. "Later" and "Not
-- this one" are different: they are about this list only, and the goals side
-- has nothing that means "not on my to-do list this week" without also
-- changing the step. So they go in the dismissal overlay, as a return
-- deadline's do (docs/GOALS-SPEC.md, "Todo").
--
-- The key is `goal_steps:<item id>`, text like every other source key.
-- ---------------------------------------------------------------------------

alter type todo.foreign_source add value if not exists 'goal_step';
