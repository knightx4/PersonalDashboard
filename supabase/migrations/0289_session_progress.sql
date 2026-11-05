-- What each session working for the person is doing now (plan #2800.1).
--
-- A session started on a plan step, on a project or from a session thread
-- said nothing until it ended. This table holds one row per session and
-- step, which the session rewrites as it works: when it starts, at each step
-- it builds, when it stops to wait on the person, and when it finishes. The
-- project pages and Dev read it to show what is running now (#2800.3), and
-- what waits on the person goes to the Inbox (#2800.4).
--
--   session_id    the Claude Code session, as its id reads (cse_…).
--   plan_item_id  the step it is on, when it is on one. A session that
--                 builds several steps in a row keeps one row per step; a
--                 session with no step has one row. Taken from the run when
--                 only the run is given.
--   plan_run_id   the plan run it was sent as, when it was sent as one.
--   thread_id     the session thread it answers in (#2789.4 makes the
--                 table; the foreign key is added there).
--   project       the Dev project it works on (public.dev_projects.id); null
--                 for this app.
--   state         working, waiting (on the person), done or stopped.
--   action        the latest thing it did, in one line.
--   needs         what it needs from the person; only while waiting.
--
-- Rows are written only through core.report_session_progress, by the service
-- role: the Dash connector's report_progress tool for the person its token
-- names, and scripts/plan.ts progress. The person reads their own rows.
-- Bookkeeping, so lib/core/sources.ts lists it as not a source.

set search_path = core, public, extensions;

create table if not exists core.session_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id text not null,
  plan_item_id uuid references public.plan_items (id) on delete set null,
  plan_run_id uuid references public.plan_runs (id) on delete set null,
  thread_id uuid,
  project text,
  state text not null,
  action text not null,
  needs text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint session_progress_session_ck
    check (session_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  constraint session_progress_project_ck
    check (project is null or project ~ '^[a-z][a-z0-9-]{0,39}$'),
  constraint session_progress_state_ck
    check (state in ('working', 'waiting', 'done', 'stopped')),
  constraint session_progress_action_ck
    check (btrim(action) <> '' and char_length(action) <= 300),
  -- What it needs is said while it waits, and only then.
  constraint session_progress_needs_ck check (
    (state = 'waiting' and needs is not null and btrim(needs) <> '' and char_length(needs) <= 2000)
    or (state <> 'waiting' and needs is null)
  ),
  constraint session_progress_session_step_key
    unique nulls not distinct (user_id, session_id, plan_item_id)
);

-- What is running for this account, newest first.
create index if not exists session_progress_user_updated_idx
  on core.session_progress (user_id, updated_at desc);
create index if not exists session_progress_run_idx
  on core.session_progress (plan_run_id) where plan_run_id is not null;

alter table core.session_progress enable row level security;

drop policy if exists session_progress_select on core.session_progress;
create policy session_progress_select on core.session_progress for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.session_progress from anon, authenticated;
grant select on core.session_progress to authenticated;
grant select, insert, update, delete on core.session_progress to service_role;

comment on table core.session_progress is
  'What each session working for the person is doing now, one row per session and step, written as it works (plan #2800.1).';

-- The one write: insert or rewrite the session's row for its step. Every id
-- passed is checked against p_user_id, since the service role passes no RLS.
create or replace function core.report_session_progress(
  p_user_id uuid,
  p_session_id text,
  p_state text,
  p_action text,
  p_needs text default null,
  p_plan_run_id uuid default null,
  p_plan_item_id uuid default null,
  p_thread_id uuid default null,
  p_project text default null
)
returns core.session_progress
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item uuid := p_plan_item_id;
  v_needs text := nullif(btrim(coalesce(p_needs, '')), '');
  v_row core.session_progress;
begin
  if p_user_id is null then
    raise exception 'Whose session this is was not given.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_action, '')), '') is null then
    raise exception 'Say what the session is doing, in one line.' using errcode = '22023';
  end if;
  if p_state = 'waiting' and v_needs is null then
    raise exception 'A session waiting on the person says what it needs.' using errcode = '22023';
  end if;
  if p_state <> 'waiting' then
    v_needs := null;
  end if;

  if p_plan_run_id is not null then
    select coalesce(v_item, r.plan_item_id) into v_item
    from public.plan_runs r
    where r.id = p_plan_run_id and r.user_id = p_user_id;
    if not found then
      raise exception 'There is no plan run % in this account.', p_plan_run_id using errcode = '22023';
    end if;
  end if;

  if v_item is not null and not exists (
    select 1 from public.plan_items i where i.id = v_item and i.user_id = p_user_id
  ) then
    raise exception 'There is no plan step % in this account.', v_item using errcode = '22023';
  end if;

  if p_project is not null and not exists (
    select 1 from public.dev_projects d where d.id = p_project and d.user_id = p_user_id
  ) then
    raise exception 'There is no project called % in this account.', p_project using errcode = '22023';
  end if;

  insert into core.session_progress as s
    (user_id, session_id, plan_item_id, plan_run_id, thread_id, project, state, action, needs)
  values
    (p_user_id, btrim(p_session_id), v_item, p_plan_run_id, p_thread_id, p_project,
     p_state, btrim(p_action), v_needs)
  on conflict on constraint session_progress_session_step_key do update set
    plan_run_id = coalesce(excluded.plan_run_id, s.plan_run_id),
    thread_id = coalesce(excluded.thread_id, s.thread_id),
    project = coalesce(excluded.project, s.project),
    state = excluded.state,
    action = excluded.action,
    needs = excluded.needs,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function core.report_session_progress(uuid, text, text, text, text, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function core.report_session_progress(uuid, text, text, text, text, uuid, uuid, uuid, text)
  to service_role;

-- Realtime: the pages that show what is running subscribe to changes. The
-- local test database has no publication, so it is added only where
-- Supabase made one.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'core' and tablename = 'session_progress'
     ) then
    alter publication supabase_realtime add table core.session_progress;
  end if;
end;
$$;
