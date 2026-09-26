-- ===========================================================================
-- A status on every open goal each day, with two ways of waiting
-- (plan #1074).
--
-- goals.reviews (0025) held a weekly verdict of three values. The daily run
-- now writes one row per open goal every day, and "waiting" splits in two
-- more ways, so the Goals home can say why a quiet goal is quiet:
--
--   waiting_on_date  nothing can move until a date: a step that starts
--                    later, a reply due, an event. next_on is that date.
--   waiting_on_goal  the next step waits on a step under another goal.
--                    waits_on_id is that goal.
--
-- Two new columns:
--
--   reviews.next_on      the date of the next move, where it has one: a
--                        due date, a start date, an event. Required for
--                        waiting_on_date.
--   reviews.waits_on_id  the other goal a waiting_on_goal verdict waits on.
--                        Only that verdict carries it. Not required, so
--                        deleting the other goal sets it null rather than
--                        failing.
--
-- Rows are still never updated: each day adds one, and the newest per goal
-- is the status.
-- ===========================================================================

alter table goals.reviews drop constraint reviews_verdict_ck;
alter table goals.reviews add constraint reviews_verdict_ck check (
  verdict in ('on_track', 'stalled', 'waiting_on_you', 'waiting_on_date', 'waiting_on_goal')
);

alter table goals.reviews add column next_on date;
alter table goals.reviews add column waits_on_id uuid;

alter table goals.reviews add constraint reviews_waits_on_fk foreign key (waits_on_id, user_id)
  references goals.items (id, user_id) on delete set null (waits_on_id);

alter table goals.reviews add constraint reviews_date_ck
  check (verdict <> 'waiting_on_date' or next_on is not null);
alter table goals.reviews add constraint reviews_waits_on_ck
  check (waits_on_id is null or verdict = 'waiting_on_goal');

create index reviews_waits_on_idx on goals.reviews (waits_on_id) where waits_on_id is not null;

comment on table goals.reviews is
  'The daily run''s status on each open goal (plans #1018, #1074): on track, stalled, waiting on you, waiting on a date or waiting on another goal, with why, the next move and its date. The newest per goal is the goal''s status.';

notify pgrst, 'reload schema';
