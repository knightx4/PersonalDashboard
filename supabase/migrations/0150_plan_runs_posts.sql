-- The Suggest posts run (plan #1417, under #1414).
--
-- The Posts tab in Dev has a button that starts one run of the plan routine to
-- draft X posts about what shipped. It is recorded in plan_runs like every
-- other press, under its own job name 'posts', with no step. The drafts it
-- writes into social_posts carry this row's id in run_id.
--
-- The only change is the list of job names; the rest of the constraint is as
-- 0132 left it.

alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise',
          'check_back', 'vision', 'vision_reshape', 'ci_fix', 'posts')
);
