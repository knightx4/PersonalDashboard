-- Remove the board meeting held on 26 October 2026 in the old minutes form,
-- at the person's request on 27 October 2026, so the first meeting on the
-- Board tab is one held as a debate over questions (plan #2561).
--
-- Its four marks go with it through the cascade on you.board_marks. It
-- wrote no questions or turns. Scoped to the owner's account and to the one
-- row by id, so it does nothing if the row is already gone.

delete from you.board_meetings
where user_id = core.dev_owner_id()
  and id = '50058f3e-6919-4b92-9994-23cd4d7b1286';
