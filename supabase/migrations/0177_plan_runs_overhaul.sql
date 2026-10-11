-- The run that works one overhaul (plan #1514, docs/SPEC-LAYER-SPEC.md Part 4).
--
-- The Work this overhaul button on an overhaul's row fires the overhaul
-- routine at that feature, recorded in plan_runs under its own job name
-- 'overhaul' so the row can say a run is going.
--
-- The only change is the list of job names; the rest is as 0158 left it.

alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise',
          'check_back', 'vision', 'vision_reshape', 'ci_fix', 'posts', 'spec_change', 'overhaul')
);
