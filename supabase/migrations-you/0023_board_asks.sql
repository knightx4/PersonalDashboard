-- Questions the board asks the person (plan #2561.11, under #2561).
--
-- The chair never holds a meeting for missing facts. When a question lacks
-- something that would change the verdict (a budget, a deadline, what success
-- looks like), the board debates it on stated assumptions, which the verdict
-- names, and writes one to three short questions for the person. They sit on
-- the question they are about, as a jsonb array:
--
--   asks  [ { id, text, asked_in, answer, answered_at, read_in } ]
--
-- id is a short key unique within the question (a1, a2). asked_in is the
-- meeting ids that put it, at most three, so one the person leaves
-- unanswered is asked again at most twice. answer and answered_at are the
-- person's reply. read_in is the meeting that has read the answer, so the
-- Board tab keeps showing an answer the next meeting has not yet read.
--
-- The assumptions need no column: they go in the verdict object as
-- verdict.assumptions, an array of text.
--
-- Schema change only. No existing row is touched; each question starts with
-- no asks.

set search_path = you, public, extensions;

alter table you.board_questions
  add column asks jsonb not null default '[]'::jsonb;

alter table you.board_questions
  add constraint board_questions_asks_ck check (jsonb_typeof(asks) = 'array');

comment on column you.board_questions.asks is
  'What the board asked the person on this question, with their answers: [ { id, text, asked_in, answer, answered_at, read_in } ] (plan #2561.11).';

notify pgrst, 'reload schema';
