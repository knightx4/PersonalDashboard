-- core.dash_failures keeps mentor replies too.
--
-- A mentor's live reply on People runs through Dash's loop (lib/you/mentor-reply.ts),
-- but its failures were only written to you.advisor_chats.reply_error, which the
-- person sees and nothing else reads. The daily Dash health check and the Dash
-- quality session read core.dash_failures, so a mentor reply that failed was never
-- looked at: two replies cut off at their token budget on 5 November went unseen.
-- With 'mentor' allowed, each one is kept with its calls, the subject being
-- the chat (subject_ref 'you.advisor_chats:<id>').
--
-- Schema only: no row is written or changed.

alter table core.dash_failures drop constraint dash_failures_surface_ck;
alter table core.dash_failures
  add constraint dash_failures_surface_ck check (surface in ('ask', 'thread', 'capture', 'mentor'));
