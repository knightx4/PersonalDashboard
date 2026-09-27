-- The re-shape that follows an accepted vision edit (plan #1137).
--
-- Accepting an edit on the specs page now starts one run of the plan routine
-- for that workspace, which re-reads every open feature there against the new
-- vision and writes back only proposals and drop questions. It is recorded in
-- plan_runs like every other press, under its own job name, with no step: it
-- is about a workspace, not a feature.
--
-- The only change is the list of job names; the rest of the constraint is as
-- 0110 left it.

alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise',
          'check_back', 'vision', 'vision_reshape')
);
