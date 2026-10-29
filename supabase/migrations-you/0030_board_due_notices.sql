-- A phone notification when a decision's check-back or tripwire falls due
-- (plan #2581.10, under #2581).
--
-- A decided question is checked back on 30 and 90 days after decided_at, and a
-- one-way door's tripwire has a check_on date. Once a day,
-- /api/cron/board-due (inngest/you/board-due.ts) finds each person's
-- check-backs and tripwires whose day has come and that nobody has told them
-- about, sends one notification naming them, and records what it announced in
-- the new column, so the next day does not send it again:
--
--   notified  { <key>: timestamptz }, key review:30, review:90, or
--             tripwire:<check_on>, so a tripwire set again with a new date
--             is announced again.
--
-- The schedule lives in the database for the reason 0099 gives: Vercel's free
-- plan allows one cron a day. The origin and the secret come from Supabase
-- Vault at fire time, under the names 0078 already requires: app_origin and
-- cron_secret. Unschedule-then-schedule by name, so applying this twice leaves
-- one job, and guarded on the extensions so the local test database, which has
-- neither, still resets.
--
-- Schema change only. Every question starts with nothing announced; no row of
-- any account is written.

set search_path = you, public, extensions;

alter table you.board_questions
  add column notified jsonb not null default '{}'::jsonb;

alter table you.board_questions
  add constraint board_questions_notified_ck check (jsonb_typeof(notified) = 'object');

comment on column you.board_questions.notified is
  'Which check-backs and tripwires the daily notification has announced: { <review:30|review:90|tripwire:<check_on>>: timestamptz } (plan #2581.10).';

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the board-due schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'board-due-daily'
  $unschedule$;

  -- 08:13 UTC: morning in Europe, early in the Americas, never at night for
  -- either.
  execute $schedule$
    select cron.schedule(
      'board-due-daily',
      '13 8 * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/board-due',
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

notify pgrst, 'reload schema';
