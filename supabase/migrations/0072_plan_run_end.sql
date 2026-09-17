-- A run gets an end, so `started` stops meaning "at some point, ever".
--
-- 0071 wrote one row per press and nothing after it. Every row was inserted
-- `started` and no code path wrote another status, so all 22 rows on the
-- account still read started days later and the table answered "is anything
-- working on this step" with the same word whether the session was a minute
-- old or four days dead.
--
-- `finished` is the third status. Nothing calls back from a session -- it does
-- not know its own run -- so the end of a run is read off the step it was sent
-- at: that step closing after the run was fired is the session having done
-- what it was for, and it is the same evidence a person reading the plan would
-- use.
--
-- A run nothing has been heard from past the cutoff stays `failed`, which is
-- also what a press that never started gets, and `error` is what tells the two
-- apart: 401 from Anthropic on one, "Nothing was heard from this run for 5h"
-- on the other. A separate status for silence would be a fourth word for the
-- same fact, that the run produced nothing.
--
-- The rules are in lib/plan/run-end.ts and the sweep that applies them is
-- `endQuietRuns`, which the plan page runs on the way in.

set search_path = public, extensions;

alter table plan_runs drop constraint if exists plan_runs_status_ck;
alter table plan_runs add constraint plan_runs_status_ck
  check (status in ('started', 'finished', 'failed'));

-- `plan_runs_error_matches_status_ck` is left as it stands: a failure says why
-- and everything else has nothing to explain, which is true of `finished` too.
