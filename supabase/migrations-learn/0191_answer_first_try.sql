-- The first try at a written answer, held while a hint is on screen (plan #2522.7).
--
-- A wrong written answer gets a hint and a retry before the expected answer is
-- shown. Until the retry or Show the answer, the question stays unanswered and
-- this column holds what the first try was: the answer, the marker's sentence,
-- the hint, the kind of miss, and for a cell question the grader's verdicts.
-- Show the answer records the first try from it without a second grade, and a
-- page opened again shows the hint where it was left.
--
-- Columns only: no existing row is changed, and the sources catalogue is
-- unchanged, since the column belongs to tables already listed.

alter table learn.probes add column if not exists first_try jsonb;
alter table learn.cell_questions add column if not exists first_try jsonb;
alter table learn.piece_checks add column if not exists first_try jsonb;
alter table learn.review_questions add column if not exists first_try jsonb;

do $$
declare t text;
begin
  foreach t in array array['probes', 'cell_questions', 'piece_checks', 'review_questions'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_first_try_object'
                   and conrelid = ('learn.' || t)::regclass) then
      execute format('alter table learn.%I add constraint %I check (first_try is null or jsonb_typeof(first_try) = ''object'')',
                     t, t || '_first_try_object');
    end if;
  end loop;
end $$;

comment on column learn.probes.first_try is
  'The first try at a written answer while its hint is on screen: response, why, hint, kind. Null when no hint was given.';
comment on column learn.cell_questions.first_try is
  'The first try at a written answer while its hint is on screen: response, why, hint, kind and the grade. Null when no hint was given.';
comment on column learn.piece_checks.first_try is
  'The first try at a written answer while its hint is on screen: response, why, hint, kind. Null when no hint was given.';
comment on column learn.review_questions.first_try is
  'The first try at a written answer while its hint is on screen: response, why, hint, kind. Null when no hint was given.';
