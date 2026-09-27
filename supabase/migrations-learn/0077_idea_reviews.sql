-- Spaced review of the ideas in passed pieces (plan #1145).
--
-- Once a piece of a learning goal's plan is passed, each of its ideas comes
-- back as a short question on the day it falls due. A right answer moves the
-- next one further out (1, 3, 7, 16, 35 days, then doubling up to 180); a
-- miss brings it back the next day. The schedule is part of what is believed
-- about the idea, so it sits on learn.concept_state beside tested_at:
--
--   review_interval_days   the gap the idea is on now. Null until one of its
--                          pieces is passed.
--   review_due_on          the day its next question is due, as a UTC date.
--                          Null with the interval.
--
-- The questions asked are kept in learn.review_questions, one row a question,
-- in the shape of learn.piece_checks: Haiku writes the question from the
-- idea's claim when it is asked for and marks what is written against the
-- answer it expected. A question's row goes with its idea.

set search_path = learn, public, extensions;

alter table learn.concept_state
  add column if not exists review_interval_days integer,
  add column if not exists review_due_on date;

alter table learn.concept_state drop constraint if exists concept_state_review_ck;
alter table learn.concept_state add constraint concept_state_review_ck check (
  (review_interval_days is null and review_due_on is null)
  or (review_interval_days between 1 and 366 and review_due_on is not null)
);

-- What Learn now and a piece's page read: the person's ideas due by today.
create index if not exists concept_state_review_due_idx
  on learn.concept_state (user_id, review_due_on)
  where review_due_on is not null;

create table if not exists learn.review_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  concept_id uuid not null,

  question text not null,
  expected text not null,
  response text,
  correct boolean,
  marked_why text,
  answered_at timestamptz,

  -- The model that wrote the question, for the day one turns out wrong.
  write_model text,
  created_at timestamptz not null default now(),

  constraint review_questions_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete cascade,
  constraint review_questions_question_ck check (btrim(question) <> '' and btrim(expected) <> ''),
  -- Answered means marked: all four together, or none of them.
  constraint review_questions_answered_ck check (
    (response is null and correct is null and answered_at is null)
    or (response is not null and correct is not null and answered_at is not null)
  )
);

create index if not exists review_questions_user_idx on learn.review_questions (user_id);
create index if not exists review_questions_concept_idx
  on learn.review_questions (concept_id, created_at desc);

alter table learn.review_questions enable row level security;

drop policy if exists review_questions_all on learn.review_questions;
create policy review_questions_all on learn.review_questions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on learn.review_questions from anon;
-- Insert for a new question and update for the answer, from Learn now and a
-- piece's page.
grant select, insert, update on learn.review_questions to authenticated;
grant select, insert, update, delete on learn.review_questions to service_role;

comment on table learn.review_questions is
  'Review questions on the ideas of passed pieces, asked when each falls due, with what was answered and the mark (plan #1145).';

-- Pieces passed before this migration put their ideas on the schedule as if
-- passed then: first question the day after.
update learn.concept_state s
set review_interval_days = 1,
    review_due_on = (p.passed_at at time zone 'utc')::date + 1
from (
  select distinct on (c.concept_id) c.concept_id, pp.user_id, pp.passed_at
  from learn.plan_pieces pp
  cross join lateral unnest(pp.concept_ids) as c(concept_id)
  where pp.passed_at is not null
  order by c.concept_id, pp.passed_at
) p
where s.concept_id = p.concept_id
  and s.user_id = p.user_id
  and s.review_due_on is null;
