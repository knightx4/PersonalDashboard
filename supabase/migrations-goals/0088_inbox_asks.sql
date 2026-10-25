-- ===========================================================================
-- Keeping Dash's questions from piling up on the Goals Inbox.
--
-- On 24 October 2026 the owner's Inbox held 63 rows, 41 of them questions
-- Dash had asked ("Do you still want to…?"), 31 on one goal, and nothing
-- ever took one away but an answer. Three rules here, read with
-- lib/goals/inbox.ts and lib/goals/stale-steps.ts:
--
-- 1. No answer is an answer. A question Dash asked that has gone five days
--    without one is closed with the default: things stay as they were. The
--    step that waited on it is freed and goes back to its goal's list. The
--    close sets `defaulted_at`, so the Inbox, the morning run and the
--    re-shape tick can tell it from a real answer. An hourly pg_cron job runs
--    goals.default_unanswered_questions() for the owner only, as the other
--    goals ticks are: Dash asks questions in no other account.
--
-- 2. At most five open questions. A new open question written by Dash
--    (goals.actor = 'claude', which every run sets) is refused while five are
--    already waiting. The run decides that one itself instead.
--
-- 3. The person's "Leave them as they are" on a goal's questions writes the
--    same close from the app, with `defaulted_at` set, so it starts no
--    re-shape run either.
--
-- No existing rows are changed by this file. The first hourly job closes the
-- owner's questions already past five days.
-- ===========================================================================

alter table goals.items add column if not exists defaulted_at timestamptz;

comment on column goals.items.defaulted_at is
  'On a question: when it was closed with the default (things stay as they were) rather than answered, by going five days unanswered or by the person''s Leave them as they are. Null on a real answer. The re-shape tick skips these (inngest/goals/reshape.ts).';

-- How long a question of Dash's waits for an answer before the default.
create or replace function goals.question_wait()
returns interval
language sql
immutable
as $$ select interval '5 days' $$;

create or replace function goals.default_unanswered_questions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := (public.app_owner() ->> 'userId')::uuid;
  closed integer;
begin
  if owner is null then
    return 0;
  end if;
  perform set_config('goals.actor', 'claude', true);
  update goals.items i
     set status = 'done',
         resolution = 'No answer in 5 days, so it stays as it was.',
         defaulted_at = now(),
         dismissed_at = null
   where i.user_id = owner
     and i.level = 'step'
     and i.kind = 'decision'
     and i.status = 'open'
     and i.resolution is null
     and i.archived_at is null
     and i.created_at < now() - goals.question_wait()
     and exists (
       select 1 from goals.history h
        where h.user_id = owner
          and h.table_name = 'items'
          and h.row_id = i.id
          and h.action = 'insert'
          and h.actor = 'claude'
     );
  get diagnostics closed = row_count;
  return closed;
end;
$$;

revoke all on function goals.default_unanswered_questions() from public, anon, authenticated;
grant execute on function goals.default_unanswered_questions() to service_role;

comment on function goals.default_unanswered_questions() is
  'Closes each question Dash asked the owner that has had no answer for goals.question_wait(), with defaulted_at set and the step left as it was. Run hourly by pg_cron (goals-default-questions-hourly). Returns how many it closed.';

-- The most open questions the Inbox holds before Dash has to decide for itself.
create or replace function goals.open_question_cap()
returns integer
language sql
immutable
as $$ select 5 $$;

create or replace function goals.cap_open_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  waiting integer;
begin
  if new.kind <> 'decision' or new.status <> 'open' or new.resolution is not null then
    return new;
  end if;
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;
  select count(*) into waiting
    from goals.items q
   where q.user_id = new.user_id
     and q.kind = 'decision'
     and q.status = 'open'
     and q.resolution is null
     and q.dismissed_at is null
     and q.archived_at is null;
  if waiting >= goals.open_question_cap() then
    raise exception using
      errcode = 'P0001',
      message = format(
        '%s questions are already waiting on the person, the most the Inbox holds. Decide this one yourself and say what you decided and why in the step''s detail, or leave it.',
        waiting
      );
  end if;
  return new;
end;
$$;

revoke all on function goals.cap_open_questions() from public, anon, authenticated;

drop trigger if exists items_cap_open_questions on goals.items;
create trigger items_cap_open_questions
  before insert on goals.items
  for each row execute function goals.cap_open_questions();

-- The hourly job. Guarded like 0084, so the local test database, which has no
-- pg_cron, still resets; unschedule-then-schedule so applying twice leaves one.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available here -- skipping the question schedule. Expected on the local test database.';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'goals-default-questions-hourly'
  $unschedule$;
  execute $schedule$
    select cron.schedule(
      'goals-default-questions-hourly',
      '17 * * * *',
      'select goals.default_unanswered_questions()'
    )
  $schedule$;
end;
$$;

notify pgrst, 'reload schema';
