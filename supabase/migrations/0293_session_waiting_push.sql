-- A session's question reaches the person's phone (plan #2800.4).
--
-- 1. core.session_progress.notified_at
--
--   When the phone was told that this session is waiting on the person. A
--   row that becomes waiting, or that goes on waiting with a new question,
--   has it cleared; the notification job (/api/cron/session-waiting) sends
--   one push per row with it clear and then sets it, so a session that
--   reports the same wait twice is announced once.
--
-- 2. core.report_session_progress
--
--   The same function as 0289, clearing notified_at when the report starts a
--   wait or changes what it waits for. No row is changed by this migration.
--
-- 3. The one-minute clock
--
--   pg_cron calls the route every minute, by the arrangement of 0260: the
--   origin and the secret come from Supabase Vault (app_origin, cron_secret),
--   and the job is unscheduled before it is scheduled so applying this twice
--   leaves one. Guarded on the extensions so the local test database, which
--   has neither, still resets.

set search_path = core, public, extensions;

alter table core.session_progress add column if not exists notified_at timestamptz;

create index if not exists session_progress_unnotified_idx
  on core.session_progress (user_id, updated_at desc)
  where state = 'waiting' and notified_at is null;

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
    -- A new wait, or the same wait asking something else, is announced again.
    notified_at = case
      when excluded.state = 'waiting' and (s.state <> 'waiting' or s.needs is distinct from excluded.needs)
        then null
      else s.notified_at
    end,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function core.report_session_progress(uuid, text, text, text, text, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function core.report_session_progress(uuid, text, text, text, text, uuid, uuid, uuid, text)
  to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the session-waiting schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'session-waiting-every-minute'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'session-waiting-every-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/session-waiting',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 55000
        )
      $job$
    )
  $schedule$;
end;
$$;
