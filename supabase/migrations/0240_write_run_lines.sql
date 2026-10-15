-- Write a run's automatic lines over HTTPS (scripts/run-line-hook.ts).
--
-- The run-line hook connected to Postgres with DATABASE_URL, and a cloud
-- session cannot: its outbound traffic goes through a proxy that carries
-- HTTPS on port 443 and nothing else, so the direct host does not resolve and
-- the pooler times out. Tested on 15 October 2026. The hook now calls this
-- function through the REST API with the service-role key instead.
--
-- One call does what the hook did in three statements: looks the run up,
-- writes its lines, and takes a stale mark off. It answers
--   'written'  the lines went in
--   'over'     the run is finished or failed, so it takes no more lines
--   'missing'  there is no such run
-- and the hook stops writing to a run on either of the last two.
--
-- p_lines is a JSON array of {kind, body}. The table's own checks still hold
-- each line to a known kind and 4000 characters.
--
-- Security invoker and granted to the service role alone: the service role
-- already writes core.run_activities, and nobody signed in calls this.

create or replace function public.write_run_lines(p_run_id uuid, p_lines jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.plan_runs%rowtype;
begin
  select * into v_run from public.plan_runs where id = p_run_id;
  if not found then
    return 'missing';
  end if;
  if v_run.status in ('finished', 'failed') then
    return 'over';
  end if;

  insert into core.run_activities (user_id, run_table, run_id, kind, body)
  select v_run.user_id, 'plan_runs', v_run.id, line ->> 'kind', line ->> 'body'
  from jsonb_array_elements(p_lines) with ordinality as l (line, n)
  order by n;

  -- A line means the run is alive again. A wait on the person's answer stays.
  if v_run.status = 'stale' then
    update public.plan_runs set status = 'started' where id = v_run.id and status = 'stale';
  end if;

  return 'written';
end;
$$;

revoke all on function public.write_run_lines(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.write_run_lines(uuid, jsonb) to service_role;

comment on function public.write_run_lines(uuid, jsonb) is
  'Write a plan run''s automatic lines in one call, for the run-line hook over HTTPS.';
