-- Checking back on each decision after 30 and 90 days (plan #2561.8, under
-- #2561).
--
-- A decided question is reviewed twice: 30 and 90 days after decided_at. The
-- dates need no column, since they follow from decided_at, and a decision the
-- person changes moves them with it. The Sunday meeting takes any review that
-- has fallen due, reads the person's rows for what happened since, and writes
-- the review onto the question. The person then says on the Board tab
-- whether it went well, and each advisor's final pick is graded against that.
-- The reviews sit on the question they are about, as a jsonb array:
--
--   reviews  [ { at, option, meeting_id, written_at, account, receipts,
--                ask, outcome, answered_at, grades } ]
--
-- at is 30 or 90, the review it is. option is the decided option the review
-- looked at. meeting_id is the meeting that wrote it, written_at when.
-- account is markdown: how the decision turned out, from the person's rows,
-- with receipts [ { label, link } ]. ask is the one line put to the person.
-- outcome is their answer, well, mixed or badly, and answered_at when; both
-- null until they answer. grades is written with the answer, one per advisor
-- who scored the question in round 3:
--
--   grades  [ { advisor, pick, held } ]
--
-- pick is the option the advisor scored highest (null on a tie), held
-- whether the pick held up: true when the decision went well and they picked
-- it, or went badly and they picked another; null when the outcome was mixed
-- or they had no single pick.
--
-- topic is the area the question is about, for the scorecard by topic: work,
-- money, learning, projects, place or time. The chair sets it with the
-- verdict, or the review sets it where an older question has none.
--
-- Schema change only. No existing row is touched: every question starts with
-- no reviews and no topic.

set search_path = you, public, extensions;

alter table you.board_questions
  add column reviews jsonb not null default '[]'::jsonb,
  add column topic text;

alter table you.board_questions
  add constraint board_questions_reviews_ck check (jsonb_typeof(reviews) = 'array'),
  add constraint board_questions_topic_ck check (
    topic is null or topic in ('work', 'money', 'learning', 'projects', 'place', 'time')
  );

comment on column you.board_questions.reviews is
  'The board''s check-backs on the decision at 30 and 90 days, with the person''s outcome and each advisor''s grade: [ { at, option, meeting_id, written_at, account, receipts, ask, outcome, answered_at, grades } ] (plan #2561.8).';
comment on column you.board_questions.topic is
  'The area the question is about, for the scorecard by topic: work, money, learning, projects, place or time (plan #2561.8).';

notify pgrst, 'reload schema';
