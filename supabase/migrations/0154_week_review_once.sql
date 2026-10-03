-- The week review fires once on Sunday, not every hour of it (plan #1493).
--
-- 0127 scheduled week-review-sunday as '11 * * * 0', every hour on Sundays
-- (UTC), and let the route write only from 9am New York time. That made
-- twenty-four calls a week to write one row. 14:11 UTC is 10:11 in New York
-- under daylight saving and 9:11 outside it, so a single call at that time is
-- always past the route's 9am check (lib/week-review/review.ts,
-- reviewWeekDue) and still on Sunday in New York.
--
-- Only the schedule changes; the job's command, the route and the Vault
-- secrets it reads stay as 0127 set them. Where pg_cron is missing (the local
-- test database) 0127 scheduled nothing and this does nothing either.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice
      'pg_cron not installed here -- leaving the week review schedule alone. Expected on the local test database.';
    return;
  end if;

  execute $alter$
    select cron.alter_job(jobid, schedule := '11 14 * * 0')
    from cron.job
    where jobname = 'week-review-sunday'
  $alter$;
end;
$$;
