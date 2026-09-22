-- Why main is red, beside the fact that it is.
--
-- The panel behind the status line's dot said "main 7caa585 failed its
-- checks" and nothing else, and on 22 September that was the least useful
-- thing it could say: GitHub had never started any of the three jobs, so there
-- were no logs to go and read and no code to fix. `reason` holds the sentence
-- `lib/plan/main-check.ts` `failureReason` writes from the failing runs' jobs
-- (which job and step broke, or that no runner was ever given), and `run_url`
-- is the run it came from, for the panel to link to.
--
-- Both are null unless the reading is `failed`, and `reason` is also null on a
-- failure whose jobs could not be read: "failed" is still worth storing
-- without the why. Held to the same shapes as `error` beside them.
--
-- `lib/plan/ci.ts` `refreshMainCheck` is still the only thing that writes this
-- row; the grants in 0083 cover the new columns unchanged.

set search_path = public, extensions;

alter table plan_main_checks add column if not exists reason text;
alter table plan_main_checks add column if not exists run_url text;

alter table plan_main_checks drop constraint if exists plan_main_checks_reason_length_ck;
alter table plan_main_checks add constraint plan_main_checks_reason_length_ck
  check (reason is null or length(reason) <= 500);

alter table plan_main_checks drop constraint if exists plan_main_checks_run_url_length_ck;
alter table plan_main_checks add constraint plan_main_checks_run_url_length_ck
  check (run_url is null or length(run_url) <= 300);

comment on column plan_main_checks.reason is
  'Why main failed, in the sentence lib/plan/main-check.ts failureReason writes. Null unless failed, or when the jobs could not be read.';
comment on column plan_main_checks.run_url is
  'The failing workflow run on GitHub, for the panel to link to. Null unless failed.';
