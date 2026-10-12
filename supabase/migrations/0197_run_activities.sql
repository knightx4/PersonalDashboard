-- What a Dash run did, line by line, as it happens (plan #1822, feature #1821).
--
-- A run on the plan (public.plan_runs) or on a goal (goals.runs) writes a line
-- each time it starts a step, commits, hits an error or asks something. Both
-- runs tables stay as they are; this one table points at either, named by
-- run_table, so nothing that reads runs today has to move.
--
--   run_table  'plan_runs' or 'goals.runs': which table run_id is in.
--   run_id     the run. No foreign key, since it can be in either table; the
--              policy checks the run is the writer's own.
--   kind       thought   what Dash is thinking about doing
--              action    something it did: claimed a step, committed, closed
--              question  something it needs the person to answer
--              response  the person's answer to a question
--              error     something that went wrong
--   body       the line, as the person reads it.
--   options    a question's choices, as a JSON array; null on every other kind.
--
-- The run page subscribes to new rows through Realtime, so the table is in
-- the supabase_realtime publication. Checked on 12 October 2026 against this
-- project's plan (Pro): the quota is 5 million Realtime messages and 500 peak
-- connections a month, and 500 messages a second. In the 30 days before that
-- there were 753 plan runs and 128 goal runs. At 40 lines a run and two open
-- tabs per line that is about 70,000 messages a month, near 1.5% of the quota,
-- so Realtime costs nothing extra at this volume.
--
-- Also adds 'awaiting_input' (a run waiting on the person's answer) and
-- 'stale' (a run that has gone silent) to plan_runs' statuses. goals.runs gets
-- the same in migrations-goals/0073, which runs after goals.runs exists.

set search_path = core, public, extensions;

-- Whether the run named is the caller's own. plpgsql, so goals.runs is looked
-- up when it is called rather than when this migration runs: locally the goals
-- migrations come after this one.
create or replace function core.run_is_mine(p_run_table text, p_run_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_run_table = 'plan_runs' then
    return exists (
      select 1 from public.plan_runs r
      where r.id = p_run_id and r.user_id = (select auth.uid())
    );
  elsif p_run_table = 'goals.runs' then
    return exists (
      select 1 from goals.runs r
      where r.id = p_run_id and r.user_id = (select auth.uid())
    );
  end if;
  return false;
end;
$$;

create table core.run_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  run_table text not null,
  run_id uuid not null,
  kind text not null,
  body text not null,
  options jsonb,

  created_at timestamptz not null default clock_timestamp(),

  constraint run_activities_run_table_ck check (run_table in ('plan_runs', 'goals.runs')),
  constraint run_activities_kind_ck
    check (kind in ('thought', 'action', 'question', 'response', 'error')),
  constraint run_activities_body_ck check (btrim(body) <> '' and char_length(body) <= 4000),
  constraint run_activities_options_ck check (
    options is null
    or (kind = 'question' and jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 1 and 10)
  )
);

-- A run's lines in order, for its page and for the newest line's time.
create index run_activities_run_idx on core.run_activities (run_id, created_at);
create index run_activities_user_idx on core.run_activities (user_id, created_at);

alter table core.run_activities enable row level security;

create policy run_activities_select on core.run_activities for select to authenticated
  using (user_id = (select auth.uid()));

create policy run_activities_insert on core.run_activities for insert to authenticated
  with check (user_id = (select auth.uid()) and core.run_is_mine(run_table, run_id));

create policy run_activities_delete on core.run_activities for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.run_activities from anon;
grant select, insert, delete on core.run_activities to authenticated;
grant select, insert, update, delete on core.run_activities to service_role;
grant execute on function core.run_is_mine(text, uuid) to authenticated, service_role;

comment on table core.run_activities is
  'What a Dash run did, line by line, for a plan run or a goal run (plan #1822).';

-- Realtime: the run page subscribes to inserts. The local test database has
-- no publication, so it is added only where Supabase made one.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table core.run_activities;
  end if;
end;
$$;

alter table public.plan_runs drop constraint plan_runs_status_ck;
alter table public.plan_runs add constraint plan_runs_status_ck
  check (status in ('started', 'awaiting_input', 'stale', 'finished', 'failed'));
