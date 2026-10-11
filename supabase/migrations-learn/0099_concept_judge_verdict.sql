-- What the second check said about a concept read out of a note (plan #1718,
-- under #1717).
--
-- A note's concepts now go through a second, cheaper model call before you
-- see them. It applies the two-part node test: could you write a question
-- that somebody who holds the concept answers differently from somebody who
-- does not, and would being wrong about it cost anything? It answers keep,
-- weak or drop for each concept. Dropped ones are never shown, so they never
-- reach this table. The other two are shown for you to approve, and what the
-- check wrote is kept on the concept once you do:
--
-- learn.concepts.separating_question
--   The question a holder answers differently. Kept because it can later
--   serve as the probe for the concept.
-- learn.concepts.cost_if_wrong
--   What being wrong about it would cost, in a sentence.
-- learn.concepts.judge_verdict
--   'keep'  passes both tests.
--   'weak'  passes them thinly. You can still approve it, and it sits in the
--           graph like any other concept, but no lesson slot is spent on it
--           alone (plan #1720 reads this).
--   null    never judged: every concept written before this, and every
--           concept from a path other than a note.
--
-- All three are null for those older concepts. Nothing is backfilled: a
-- verdict nobody reached would assert something nobody checked.

set search_path = learn, public, extensions;

alter table learn.concepts
  add column if not exists separating_question text
    constraint concepts_separating_question_len_ck
    check (separating_question is null or char_length(separating_question) between 1 and 500);

alter table learn.concepts
  add column if not exists cost_if_wrong text
    constraint concepts_cost_if_wrong_len_ck
    check (cost_if_wrong is null or char_length(cost_if_wrong) between 1 and 500);

alter table learn.concepts
  add column if not exists judge_verdict text
    constraint concepts_judge_verdict_ck
    check (judge_verdict is null or judge_verdict in ('keep', 'weak'));

comment on column learn.concepts.separating_question is
  'The question somebody who holds this concept answers differently, from the note judge (plan #1718). Null when never judged.';
comment on column learn.concepts.cost_if_wrong is
  'What being wrong about this concept would cost, from the note judge (plan #1718). Null when never judged.';
comment on column learn.concepts.judge_verdict is
  'keep or weak, from the note judge (plan #1718); a weak concept gets no lesson slot of its own. Null when never judged.';
