-- A preparation run for every subject, which resumes where it stopped
-- (plan #2276.1).
--
-- Adding a subject starts a fixed list of steps: classify it, pull its
-- structure documents, match their weeks, compile the territory, draft the
-- topics, write the opening units, finish. A run on Vercel stops after five
-- minutes and a subject with forty topics takes several, so each step records
-- where it got to and the next call carries on from there
-- (lib/learn/prepare/run.ts).
--
-- learn.subject_preparations, one row per subject:
--   status         pending (not started), running, done or failed
--   current_step   the step running or about to run; null once done
--   started_at, finished_at
--   error          why the run stopped on a failed step, shown with Continue
--   failures       how many times a step has failed, so the daily cron stops
--                  retrying a subject that keeps failing
--   lease_until    held by the call working the run, so the page's Continue
--                  and the cron cannot work the same run at once
--
-- learn.subject_preparation_steps, one row per step of a run:
--   key, ordinal   the seven keys in lib/learn/prepare/steps.ts, in order
--   status         pending, running, done, skipped or failed
--   summary        a short line of what it produced, or why it was skipped
--   counts         numbers the page shows, such as documents stored
--   calls          how many calls have worked the step
--   error          why it failed
--
-- The rows are opened by a trigger on learn.subjects, so a subject made any
-- way has its run: by a press, by Dash, by a chat, or by a survey subject
-- becoming a real one. Survey subjects are hidden and are not prepared.
-- Subjects made before this migration get their run from the script in
-- #2276.8; nothing here backfills them.
--
-- learn.subjects also gains the kind columns learn.aims has (0160), so a
-- subject is classified without a goal.

set search_path = learn, public, extensions;

-- The subject's kind ---------------------------------------------------------

alter table learn.subjects
  add column if not exists kind text,
  add column if not exists kind_reason text,
  add column if not exists kind_by text,
  add column if not exists kind_model text,
  add column if not exists kind_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subjects_kind_ck') then
    alter table learn.subjects
      add constraint subjects_kind_ck
        check (kind is null or kind in (
          'academic_course', 'research_subfield', 'narrow_question',
          'institution', 'practical_skill', 'broad_field'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subjects_kind_by_ck') then
    alter table learn.subjects
      add constraint subjects_kind_by_ck check (kind_by is null or kind_by in ('model', 'person'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subjects_kind_complete_ck') then
    alter table learn.subjects
      add constraint subjects_kind_complete_ck
        check ((kind is null) = (kind_by is null) and (kind is null) = (kind_at is null));
  end if;
end;
$$;

comment on column learn.subjects.kind is
  'The subject''s kind, which decides where its structure documents are looked for (lib/learn/goal-kind.ts). Null until the preparation classifies it.';
comment on column learn.subjects.kind_by is
  'model or person. A kind the person set is never replaced by the classifying call.';

-- The runs -------------------------------------------------------------------

create table if not exists learn.subject_preparations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null unique references learn.subjects (id) on delete cascade,
  status text not null default 'pending',
  current_step text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  failures integer not null default 0,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subject_preparations_status_ck check (status in ('pending', 'running', 'done', 'failed'))
);

create index if not exists subject_preparations_open_idx
  on learn.subject_preparations (user_id, status)
  where status <> 'done';

create table if not exists learn.subject_preparation_steps (
  preparation_id uuid not null references learn.subject_preparations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  ordinal smallint not null,
  status text not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  summary text,
  counts jsonb not null default '{}'::jsonb,
  calls integer not null default 0,
  error text,
  updated_at timestamptz not null default now(),
  primary key (preparation_id, key),
  constraint subject_preparation_steps_ordinal_uq unique (preparation_id, ordinal),
  constraint subject_preparation_steps_key_ck check (key in (
    'classify', 'pull_documents', 'match_weeks', 'compile_territory',
    'draft_topics', 'write_units', 'finish')),
  constraint subject_preparation_steps_status_ck check (status in ('pending', 'running', 'done', 'skipped', 'failed'))
);

create index if not exists subject_preparation_steps_user_idx
  on learn.subject_preparation_steps (user_id);

alter table learn.subject_preparations enable row level security;
alter table learn.subject_preparation_steps enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'subject_preparations' and policyname = 'subject_preparations_read'
  ) then
    create policy subject_preparations_read on learn.subject_preparations for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'subject_preparation_steps' and policyname = 'subject_preparation_steps_read'
  ) then
    create policy subject_preparation_steps_read on learn.subject_preparation_steps for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

-- The runner writes them with the service role; the person may read them.
revoke all on learn.subject_preparations from anon, authenticated;
revoke all on learn.subject_preparation_steps from anon, authenticated;
grant select on learn.subject_preparations to authenticated;
grant select on learn.subject_preparation_steps to authenticated;
grant select, insert, update, delete on learn.subject_preparations to service_role;
grant select, insert, update, delete on learn.subject_preparation_steps to service_role;

comment on table learn.subject_preparations is
  'Bookkeeping: one preparation run per subject, worked by lib/learn/prepare/run.ts in budgeted calls until done (plan #2276.1).';
comment on table learn.subject_preparation_steps is
  'Bookkeeping: the seven steps of a subject''s preparation run, with what each produced (plan #2276.1).';

-- Every subject gets its run -------------------------------------------------

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
  on conflict (subject_id) do nothing
  returning id into prep;
  if prep is null then
    return new;
  end if;

  -- The same seven keys, in the same order, as PREPARATION_STEPS in
  -- lib/learn/prepare/steps.ts; lib/learn/prepare/steps.test.ts holds them equal.
  insert into learn.subject_preparation_steps (preparation_id, user_id, key, ordinal)
  select prep, new.user_id, s.key, s.ordinal
  from unnest(array[
    'classify', 'pull_documents', 'match_weeks', 'compile_territory',
    'draft_topics', 'write_units', 'finish'
  ]::text[]) with ordinality as s(key, ordinal);
  return new;
end;
$$;

revoke all on function learn.open_subject_preparation() from public, anon, authenticated;

create or replace trigger subjects_open_preparation
  after insert or update of survey on learn.subjects
  for each row execute function learn.open_subject_preparation();
