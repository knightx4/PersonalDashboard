-- A run that finds out why a feature stalled, and fixes it or writes the
-- blocker (lib/plan/unstick-run.ts).
--
-- A feature whose last two build runs closed nothing used to be raised to the
-- person as "send it again?", and a yes sent it again unchanged. #1073 went out
-- that way while its one open step waited on a check-back for two weeks of
-- data, and each session found nothing to do. The overnight tick now sends one
-- 'unstick' run at such a feature before it raises anything. The job list is
-- 0178's with 'unstick' added.

alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise',
          'check_back', 'vision', 'vision_reshape', 'ci_fix', 'posts', 'spec_change', 'overhaul',
          'audit', 'unstick')
);
