-- Set the vault map's sweep clock going again.
--
-- 0042 paused 'map-sweep-tick' and 'maya-gate-hourly' when Map and Maya left
-- Vault's tab bar (plan #1496.9). The person asked for Map back as a tab, so
-- its clock runs again on the schedule 0094_map_sweep_tick_cron.sql gave it.
-- Maya stays paused.
--
-- No rows in any account are read or changed. Guarded on pg_cron, as 0042 is,
-- so the local test database, which has no pg_cron, still resets.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice
      'pg_cron not installed here -- nothing to resume. Expected on the local test database.';
    return;
  end if;

  execute $resume$
    select cron.alter_job(jobid, active := true)
    from cron.job
    where jobname = 'map-sweep-tick'
  $resume$;
end;
$$;
