-- Pause the vault map's sweep and Maya's hourly thoughts (plan #1496.9).
--
-- Neither page was opened from 3 October to 2 November 2026, and the person
-- chose to freeze both (#1496.5): Map and Maya leave Vault's tab bar, their
-- pages and rows stay, and the two background jobs stop.
--
-- The jobs are paused rather than unscheduled, so each keeps the schedule its
-- own migration gave it: 'map-sweep-tick' (0094_map_sweep_tick_cron.sql,
-- every five minutes) and 'maya-gate-hourly' (0131_maya_gate_cron.sql, at 47
-- minutes past each hour). To resume one, set it active again:
--
--   select cron.alter_job(jobid, active := true)
--   from cron.job where jobname = 'maya-gate-hourly';
--
-- No rows in any account are read or changed. Guarded on pg_cron, as the
-- migrations that scheduled them are, so the local test database, which has
-- no pg_cron, still resets.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice
      'pg_cron not installed here -- nothing to pause. Expected on the local test database.';
    return;
  end if;

  execute $pause$
    select cron.alter_job(jobid, active := false)
    from cron.job
    where jobname in ('map-sweep-tick', 'maya-gate-hourly')
  $pause$;
end;
$$;
