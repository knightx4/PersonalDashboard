-- An Ask Dash reply that keeps going when the page goes (plan #2854.4).
--
-- The answer to a question used to live and die with the browser's request:
-- leaving the page ended it, and on 4 November 2026 a question was kept with
-- no answer, no hand-off and nothing to say so. The answer now runs on the
-- server whether or not the page is open, and the chat says where it stands:
--
--   reply_state       'answering' while Dash is writing the reply to the
--                     chat's last question, 'failed' when that reply could
--                     not be written; null when the last question has its
--                     answer, or the chat is not an Ask Dash one.
--   reply_started_at  when the reply being written, or the one that failed,
--                     was started. A reply still 'answering' long past the
--                     route's time budget died with its function and is read
--                     as failed (lib/talk/reply-state.ts).
--   reply_stop_at     when Stop was pressed on the reply being written. The
--                     run reads it and ends the answer, keeping what it had
--                     written; leaving the page no longer stops anything.
--   reply_error       why the reply failed, in a sentence for the person.
--
-- Schema only: no row is written or changed here.

set search_path = core, public, extensions;

alter table core.conversations
  add column if not exists reply_state text,
  add column if not exists reply_started_at timestamptz,
  add column if not exists reply_stop_at timestamptz,
  add column if not exists reply_error text;

alter table core.conversations
  add constraint conversations_reply_state_ck check (reply_state in ('answering', 'failed'));

alter table core.conversations
  add constraint conversations_reply_error_ck check (reply_error is null or length(reply_error) <= 2000);

comment on column core.conversations.reply_state is
  'Ask Dash chats: answering while the reply to the last question is being written, failed when it could not be; null otherwise (plan #2854.4).';
comment on column core.conversations.reply_started_at is
  'When the reply in reply_state was started (plan #2854.4).';
comment on column core.conversations.reply_stop_at is
  'When Stop was pressed on the reply being written; the run reads it and ends the answer (plan #2854.4).';
comment on column core.conversations.reply_error is
  'Why the last reply failed, in a sentence for the person (plan #2854.4).';
