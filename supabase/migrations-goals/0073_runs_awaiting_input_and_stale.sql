-- A goal run can wait on the person or go silent (plan #1822).
--
-- 'awaiting_input' is a run that asked a question and is waiting for the
-- answer; 'stale' is one that has stopped writing lines to
-- core.run_activities. public.plan_runs gets the same in
-- migrations/0197_run_activities.sql.

alter table goals.runs drop constraint runs_status_ck;
alter table goals.runs add constraint runs_status_ck
  check (status in ('started', 'awaiting_input', 'stale', 'done', 'failed'));
