-- ---------------------------------------------------------------------------
-- 0017 -- plan steps, goal waits, raises and Dash's questions in threads can
-- be put off and dismissed on the agenda.
--
-- Four sources read these rows live by whose move they are (plan #1473):
-- lib/todo/agenda/sources/plan-steps.ts, goal-waiting.ts, raised.ts and
-- threads.ts. Answering, approving or replying happens on the row's own page,
-- so "Later" and "Not this one" are about this list only and go in the
-- dismissal overlay. The goal source files under the existing 'goal_step'.
--
-- Each key carries what makes this turn this turn (the step's state, the
-- count proposed, the turn's id), so putting off one leaves the next to show.
-- ---------------------------------------------------------------------------

alter type todo.foreign_source add value if not exists 'plan_item';
alter type todo.foreign_source add value if not exists 'raised_item';
alter type todo.foreign_source add value if not exists 'thread';
