-- A run that puts a feature's built steps on main (plan #2815.2,
-- lib/plan/land.ts).
--
-- A batch marks each step built on the feature's branch and lands them all in
-- one merge at the end. When the batch stopped short, nothing sent anyone back
-- to land what it had built: on 4 November 2026, 12 open features held about
-- 45 built steps that never reached main. The overnight tick now sends a
-- 'land' run at a feature with built steps and no session going, ahead of
-- features with steps ready to build. The job list is 0198's with 'land' added.

alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise',
          'check_back', 'vision', 'vision_reshape', 'ci_fix', 'posts', 'spec_change', 'overhaul',
          'audit', 'unstick', 'land')
);
