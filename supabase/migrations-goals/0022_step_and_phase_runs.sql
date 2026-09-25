-- ===========================================================================
-- Sending one step or one phase to Claude from its row (plan #1000).
--
-- Until now a run covered a whole goal (Work on this, or a re-shape) or
-- every ready Claude step at once (the morning run). Two more jobs let a
-- single part of a goal be sent:
--
--   runs.job 'step'    a run on one Claude step. item_id names the step.
--   runs.job 'phase'   a run on one phase: a step with sub-steps, worked in
--                      order. item_id names the phase.
--
-- The rules about what may be sent are in lib/goals/handover.ts; the table
-- only has to accept the two new values.
-- ===========================================================================

alter table goals.runs drop constraint runs_job_ck;
alter table goals.runs add constraint runs_job_ck
  check (job in ('daily', 'weekly', 'goal', 'reshape', 'step', 'phase'));

comment on column goals.runs.job is
  'What fired the run: daily (the morning run), weekly (event research), goal (Work on this, or a comment on a goal), reshape (questions on the goal were answered), step (one step sent from its row) or phase (one phase sent from its row).';
