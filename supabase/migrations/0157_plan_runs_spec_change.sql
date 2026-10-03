-- The run that writes an approved spec change into docs/ and shapes it into
-- work (plan #1509, docs/SPEC-LAYER-SPEC.md Part 3).
--
-- Approving a change on /dev/specs starts one run of the plan routine, about
-- no step, recorded in plan_runs under its own job name 'spec_change'.
--
-- The only change is the list of job names; the rest of the constraint is as
-- 0150 left it.

alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise',
          'check_back', 'vision', 'vision_reshape', 'ci_fix', 'posts', 'spec_change')
);
