-- The log of the app's own cron routes run on someone's behalf (plan #3070.1,
-- under #3070).
--
-- Sessions, Dash and the People bots cannot hold CRON_SECRET, so they ask the
-- server to call a route for them: lib/dev/app-route.ts calls GET on the app's
-- own domain with the secret attached there and nowhere else. Every run is a
-- row here, so the Dev page can show who ran what and what came back, and the
-- start function below is what holds the runs to a few at once.
--
--   public.app_route_runs
--                one call to one allowlisted route: who asked, the path and
--                query, when it started and ended, how it ended (running,
--                ok, failed, refused), the HTTP status, the size of the body
--                and the body itself (JSON as returned, anything else as a
--                JSON string, cut to 100,000 characters). A refused run is
--                logged too, with why, and never reaches the route.
--   public.start_app_route_run(asked_by, path, query, limit, stale_minutes)
--                opens a run for the owner (core.dev_owner_id()) and returns
--                its id, or opens it as refused and returns null when `limit`
--                runs are already running. A run left running for longer
--                than `stale_minutes` (its function died) no longer counts.
--                A transaction lock makes two starts at once count each other.
--   public.finish_app_route_run(id, status, http_status, result, result_bytes, error)
--                closes a running run once.
--   public.refuse_app_route_run(asked_by, path, query, error)
--                logs a run refused before it started (a path or host off
--                the allowlist, no secret on the server).
--
-- The functions are the service role's alone; a signed-in owner may read
-- their own rows. New table and functions only: no existing row is read or
-- changed.

set search_path = public, extensions;

create table if not exists app_route_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asked_by text not null,
  path text not null,
  query jsonb not null default '{}'::jsonb,
  status text not null default 'running',
  http_status integer,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  result_bytes integer,
  result jsonb,
  error text,
  constraint app_route_runs_asked_by_ck check (length(btrim(asked_by)) between 1 and 200),
  constraint app_route_runs_path_ck check (length(path) between 1 and 500),
  constraint app_route_runs_query_ck check (jsonb_typeof(query) = 'object'),
  constraint app_route_runs_status_ck check (status in ('running', 'ok', 'failed', 'refused')),
  constraint app_route_runs_ended_ck check ((status = 'running') = (ended_at is null)),
  constraint app_route_runs_bytes_ck check (result_bytes is null or result_bytes >= 0),
  constraint app_route_runs_error_ck check (error is null or length(error) <= 2000)
);

create index if not exists app_route_runs_user_started_idx on app_route_runs (user_id, started_at desc);
create index if not exists app_route_runs_running_idx on app_route_runs (user_id, started_at)
  where status = 'running';

alter table app_route_runs enable row level security;

create policy app_route_runs_owner_read on app_route_runs for select to authenticated
  using (user_id = (select auth.uid()));

grant select on app_route_runs to authenticated;
revoke all on table app_route_runs from anon;

comment on table app_route_runs is
  'One call to one of the app''s own allowlisted routes, run on the server for a session, Dash or a bot so none of them holds CRON_SECRET (migration 0315).';

create or replace function public.start_app_route_run(
  p_asked_by text,
  p_path text,
  p_query jsonb,
  p_limit integer,
  p_stale_minutes integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := core.dev_owner_id();
  v_running integer;
  v_id uuid;
begin
  if v_owner is null then
    raise exception 'no owner is set in core.app_settings';
  end if;

  -- Two starts at the same moment wait for each other here, so each counts
  -- the other's row.
  perform pg_advisory_xact_lock(hashtext('app_route_runs'));

  select count(*) into v_running
    from public.app_route_runs r
   where r.user_id = v_owner
     and r.status = 'running'
     and r.started_at > now() - make_interval(mins => greatest(p_stale_minutes, 1));

  if v_running >= p_limit then
    insert into public.app_route_runs (user_id, asked_by, path, query, status, ended_at, error)
    values (v_owner, p_asked_by, p_path, coalesce(p_query, '{}'::jsonb), 'refused', now(),
            format('%s runs are already going; the limit is %s.', v_running, p_limit));
    return null;
  end if;

  insert into public.app_route_runs (user_id, asked_by, path, query)
  values (v_owner, p_asked_by, p_path, coalesce(p_query, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finish_app_route_run(
  p_id uuid,
  p_status text,
  p_http_status integer,
  p_result jsonb,
  p_result_bytes integer,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.app_route_runs r
     set status = p_status,
         http_status = p_http_status,
         result = p_result,
         result_bytes = p_result_bytes,
         error = left(p_error, 2000),
         ended_at = now()
   where r.id = p_id
     and r.user_id = core.dev_owner_id()
     and r.status = 'running';
end;
$$;

create or replace function public.refuse_app_route_run(
  p_asked_by text,
  p_path text,
  p_query jsonb,
  p_error text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := core.dev_owner_id();
  v_id uuid;
begin
  if v_owner is null then
    raise exception 'no owner is set in core.app_settings';
  end if;
  insert into public.app_route_runs (user_id, asked_by, path, query, status, ended_at, error)
  values (v_owner, left(p_asked_by, 200), left(p_path, 500), coalesce(p_query, '{}'::jsonb),
          'refused', now(), left(p_error, 2000))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.start_app_route_run(text, text, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.finish_app_route_run(uuid, text, integer, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.refuse_app_route_run(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.start_app_route_run(text, text, jsonb, integer, integer) to service_role;
grant execute on function public.finish_app_route_run(uuid, text, integer, jsonb, integer, text) to service_role;
grant execute on function public.refuse_app_route_run(text, text, jsonb, text) to service_role;
