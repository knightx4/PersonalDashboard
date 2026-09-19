-- The press that starts a run when you answer a raise.
--
-- An answer written on a raise used to end at "Saved." Two of them carried an
-- answer for five and six days with nothing reading it, because the only
-- comment that started anything was one tagged @dash, and a raise is already
-- addressed to you -- there is nobody else to tag. So a comment you write on
-- an open or answered raise now fires the plan routine with the raise, its
-- thread and what you wrote.
--
-- `raise` rather than reusing `comment`: 0071 says the job is the press and not
-- the routine, and what somebody reading plan_runs wants to know is whether a
-- run was a question asked on a row or a raise being picked up. They are
-- started from different places and carry different briefs.

set search_path = public, extensions;

alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise')
);
