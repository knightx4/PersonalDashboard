-- An eighth preparation step, first_lesson (plan #2292.1).
--
-- When a subject's preparation finishes, its first unit should already be a
-- set of pieces with the first piece's lessons written, so the page has
-- something to read at once. first_lesson runs after finish: it lays out unit
-- 1, splits it into pieces, matches the pieces to the territory's cells and
-- writes the lessons of the first piece's ideas
-- (lib/learn/prepare/first-lesson-step.ts).
--
-- The key joins the check constraint on learn.subject_preparation_steps and
-- the list the trigger opens a subject's own run with, at ordinal 8. A branch
-- run (0171) writes no units and does not get it. Runs opened before this
-- keep their seven rows; ensurePreparation (lib/learn/prepare/store.ts) adds
-- the missing row to a run it is given. No existing row is rewritten.

set search_path = learn, public, extensions;

alter table learn.subject_preparation_steps
  drop constraint if exists subject_preparation_steps_key_ck;

alter table learn.subject_preparation_steps
  add constraint subject_preparation_steps_key_ck check (key in (
    'classify', 'pull_documents', 'match_weeks', 'compile_territory',
    'draft_topics', 'write_units', 'finish', 'first_lesson'));

comment on table learn.subject_preparation_steps is
  'Bookkeeping: the eight steps of a subject''s preparation run, with what each produced (plan #2276.1, #2292.1).';

create or replace function learn.open_subject_preparation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prep uuid;
begin
  if new.survey then
    return new;
  end if;
  if tg_op = 'UPDATE' and not old.survey then
    return new;
  end if;

  insert into learn.subject_preparations (user_id, subject_id)
  values (new.user_id, new.id)
  on conflict (subject_id) where branch_key is null do nothing
  returning id into prep;
  if prep is null then
    return new;
  end if;

  -- The same eight keys, in the same order, as PREPARATION_STEPS in
  -- lib/learn/prepare/steps.ts; lib/learn/prepare/steps.test.ts holds them equal.
  insert into learn.subject_preparation_steps (preparation_id, user_id, key, ordinal)
  select prep, new.user_id, s.key, s.ordinal
  from unnest(array[
    'classify', 'pull_documents', 'match_weeks', 'compile_territory',
    'draft_topics', 'write_units', 'finish', 'first_lesson'
  ]::text[]) with ordinality as s(key, ordinal);
  return new;
end;
$$;

revoke all on function learn.open_subject_preparation() from public, anon, authenticated;
