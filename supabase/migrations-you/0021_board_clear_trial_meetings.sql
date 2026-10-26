-- Remove the board's two trial meetings, at the person's request on
-- 26 October 2026, so the next meeting starts as the first.
--
-- Both were held while the board was being set up: 25 October before the
-- Dash connector was attached (its minutes were written in by hand
-- afterwards) and 26 October as a test run the day after. Their marks go
-- with them through the cascade on you.board_marks; there were none.
--
-- Scoped to the owner's account and to the two rows by id, so it touches
-- nothing else and does nothing if they are already gone.

delete from you.board_meetings
where user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
  and id in (
    'b1e88ad1-6745-4c2b-8124-d30b9661b346',
    '4d7c9c90-4513-4446-abd4-66b2cf40c8dc'
  );
