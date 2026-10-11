-- The schedules behind the Routines pages in Dev and Goals.
--
-- Every recurring run the app makes is listed on /dev/routines or
-- /goals/routines (lib/routines/registry.ts), with when it runs and when it
-- last ran. Most of those clocks are pg_cron jobs, because Vercel's free plan
-- allows one cron a day (0099). `cron.job` and `cron.job_run_details` are not
-- reachable through the API, so this function reads them for the page: one row
-- per job, with its schedule, whether it is active, and how its last tick
-- went. It does not return the job's command, which carries the vault lookups.
--
-- The owner only. The jobs are the app's, and a schedule is nothing another
-- account needs. Anyone else gets no rows.
--
-- plpgsql rather than sql, and guarded on `cron.job` existing, so the local
-- test database, which has no pg_cron, still creates the function and gets an
-- empty answer.

create or replace function public.routine_schedules()
returns table (
  jobname text,
  schedule text,
  active boolean,
  last_started_at timestamptz,
  last_status text,
  last_message text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_owner() or to_regclass('cron.job') is null then
    return;
  end if;

  return query execute $q$
    select j.jobname::text,
           j.schedule::text,
           j.active,
           d.start_time,
           d.status::text,
           left(d.return_message, 300)::text
      from cron.job j
      left join lateral (
        select r.start_time, r.status, r.return_message
          from cron.job_run_details r
         where r.jobid = j.jobid
         order by r.start_time desc
         limit 1
      ) d on true
     order by j.jobname
  $q$;
end;
$$;

comment on function public.routine_schedules() is
  'Every pg_cron job with its schedule and last tick, for the Routines pages (lib/routines/store.ts). Owner only; empty where pg_cron is not installed.';

revoke all on function public.routine_schedules() from public, anon, authenticated;
grant execute on function public.routine_schedules() to authenticated;
