-- The guided essay (LEARN-ESSAYS-SPEC, "The stages"): what the person works
-- out between the interview and the draft, and a research run that reads as
-- a map of the question.
--
-- learn.essays.plan, one object per essay, in the person's words apart from
-- the questions Dash put to them:
--   thesis    the answer in one sentence.
--   readback  Dash's read of the brief after the interview: up to three notes,
--             each with the person's reply, and sharper versions of the
--             question they can take or leave.
--   takes     what the person made of each part of the research, keyed by
--             the run and the part.
--   points    the essay's points in order: the point as they wrote it, its
--             role (opening, point, objection, closing), what that part of
--             the essay does, and the questions Dash asked about it with
--             their answers.
--   shape     the shape they chose for the essay, by name.
--   review    Dash's notes on the plan, each open or closed.
-- Part of the essay row, which is already a source.
--
-- learn.essay_research gains the run's short version and the questions it
-- ends on, for the writer to answer:
--   summary   about a hundred words answering the question from the pages read.
--   asks      up to three questions asking the writer where they stand.

set search_path = learn, public, extensions;

alter table learn.essays
  add column if not exists plan jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'essays_plan_object' and conrelid = 'learn.essays'::regclass
  ) then
    alter table learn.essays add constraint essays_plan_object check (jsonb_typeof(plan) = 'object');
  end if;
end;
$$;

comment on column learn.essays.plan is
  'The guided essay: thesis, Dash''s read of the brief, takes on the research, the points in order with what was worked out under each, the chosen shape and Dash''s notes on the plan.';

alter table learn.essay_research
  add column if not exists summary text not null default '',
  add column if not exists asks text[] not null default '{}';

comment on column learn.essay_research.summary is
  'The short version: about a hundred words answering the question from the pages read.';
comment on column learn.essay_research.asks is
  'Up to three questions asking the writer where they stand on what the pages said.';
