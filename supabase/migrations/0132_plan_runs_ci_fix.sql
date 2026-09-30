-- The "Fix with Dash" button on the CI panel (note 06016ffa).
--
-- When main is red, the panel behind the status line's dot now carries a
-- button that starts one run of the plan routine to get main green again. It
-- is recorded in plan_runs like every other press, under its own job name,
-- with no step: it is about main, not a feature.
--
-- The only change is the list of job names; the rest of the constraint is as
-- 0114 left it.

alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise',
          'check_back', 'vision', 'vision_reshape', 'ci_fix')
);
