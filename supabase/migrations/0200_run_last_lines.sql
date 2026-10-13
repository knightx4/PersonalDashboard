-- When each run last wrote a line (plan #1825, feature #1821).
--
-- Whether a run is alive is read from its newest line in core.run_activities:
-- the sweeps that end quiet runs, the claim release and the plan page all ask
-- for it, for a handful of runs at once. One grouped read per call, through
-- run_activities_run_idx, rather than every line of every run sent back to
-- be reduced in the app.
--
-- Security invoker, so a signed-in caller sees only their own runs' lines
-- (run_activities_select) and the service role used by the ticks sees all.
-- A run with no lines is left out of the result, which is how a caller tells
-- a run that never wrote one from one that went quiet.

create or replace function core.run_last_lines(p_run_table text, p_run_ids uuid[])
returns table (run_id uuid, last_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.run_id, max(a.created_at) as last_at
  from core.run_activities a
  where a.run_table = p_run_table
    and a.run_id = any (p_run_ids)
  group by a.run_id;
$$;

revoke all on function core.run_last_lines(text, uuid[]) from public, anon;
grant execute on function core.run_last_lines(text, uuid[]) to authenticated, service_role;

comment on function core.run_last_lines(text, uuid[]) is
  'The newest line time for each of the runs named that has written one (plan #1825).';
