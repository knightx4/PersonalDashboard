-- A Dash quality case can be put to a People bot as a text to it.
--
-- core.dash_eval_cases.advisor names an advisor, and the case is asked as a
-- one-on-one talk with them (plan #2581.6, lib/you/advisor-talk-run.ts).
-- People bots answer a text through a different path: their reply voice
-- (lib/you/mentor-reply.ts peopleVoice), with Ask's tools loaded by area
-- (lib/dash/tool-areas.ts). With `bot` set, the case is asked through that
-- voice, writes rehearsed and never made, so a case can check that a bot
-- opened the right area and called the right tool.
--
-- Schema only: every existing case keeps bot = false.

set search_path = core, public, extensions;

alter table core.dash_eval_cases
  add column bot boolean not null default false;

alter table core.dash_eval_cases
  add constraint dash_eval_cases_bot_ck check (not bot or advisor is not null);

comment on column core.dash_eval_cases.bot is
  'Asked as a text to the People bot `advisor` names, through its reply voice with writes rehearsed (lib/dash/quality/rehearse-write.ts), rather than as a one-on-one advisor talk.';

notify pgrst, 'reload schema';
