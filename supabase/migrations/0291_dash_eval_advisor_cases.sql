-- A Dash check case can be put to one advisor instead of Ask Dash (plan
-- #2581.6).
--
-- The person can now talk to any advisor alone, on Ask Dash's loop with its
-- lookups, in that advisor's voice (lib/you/advisor-talk-run.ts). A case for
-- it asks the question as a first message to that advisor and grades the
-- reply as Ask's are graded (lib/dash/quality/grade.ts): that it stayed in
-- character and cited the person's rows.
--
--   advisor   the key of the advisor in you.board_advisors to ask, or null
--             to ask Ask Dash as before. The run reads that advisor's brain,
--             memory and decisions and writes nothing back: no talk, no
--             message and no memory is kept.
--
-- Schema only: every case already written stays null and is asked as before.

set search_path = core, public, extensions;

alter table core.dash_eval_cases
  add column advisor text
    constraint dash_eval_cases_advisor_ck check (advisor is null or advisor ~ '^[a-z0-9_]{1,40}$');

comment on column core.dash_eval_cases.advisor is
  'The advisor (you.board_advisors.key) the question is put to in a one-on-one talk; null asks Ask Dash (plan #2581.6).';

notify pgrst, 'reload schema';
