-- ===========================================================================
-- Asking Claude to prepare one of your steps (plan #1001).
--
-- On a step of yours, such as calling the servicer or sending an
-- application, Prepare starts a run that writes what you need to do it: a
-- draft email, a call script, a checklist. It is stored on the step's result
-- and result_url, and the step stays yours and open.
--
--   items.result, items.result_url   0007 allowed them only on a `claude`
--                                    step. They may now sit on a `mine` step
--                                    too. Questions and rhythms still have
--                                    none.
--   runs.job 'prepare'               a run preparing one step of yours.
--                                    item_id names the step.
--
-- Reviewing stays with Claude's own steps: the home's unread list and its
-- index (0007) read kind = 'claude' only, and a prepared step waits on you
-- through the step itself. The rules about what may be prepared are in
-- lib/goals/handover.ts.
-- ===========================================================================

alter table goals.items drop constraint items_result_kind_ck;
alter table goals.items add constraint items_result_kind_ck check (
  (result is null and result_url is null) or kind in ('claude', 'mine')
);

alter table goals.runs drop constraint runs_job_ck;
alter table goals.runs add constraint runs_job_ck
  check (job in ('daily', 'weekly', 'goal', 'reshape', 'step', 'phase', 'prepare'));

comment on column goals.items.result is
  'What Claude produced for a claude step (the note or draft), or what it prepared for one of yours to do it (a draft email, a call script, a checklist).';

comment on column goals.runs.job is
  'What fired the run: daily (the morning run), weekly (event research), goal (Work on this, or a comment on a goal), reshape (questions on the goal were answered), step (one step sent from its row), phase (one phase sent from its row) or prepare (one step of yours Claude was asked to prepare).';
