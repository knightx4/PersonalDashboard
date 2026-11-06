-- Pages a bot on People has a Claude Code session make (plan #2997).
--
-- The person asks a bot ("Gert, prepare me something to practise my
-- accounting for tomorrow's interview"). The bot says it is on it, and hands
-- the request to the Dash backup routine on the same row Ask Dash's
-- hand-offs use, core.dash_handoffs. The routine builds one self-contained
-- HTML page, keeps it in core.files, and posts the link into the thread as
-- the bot (.claude/skills/bot-pages).
--
-- core.dash_handoffs
--   kind             request  Ask Dash's hand-off, as before (every row so far)
--                    page     a bot's page; conversation_id is null, since a
--                             People thread is not an Ask conversation
--   advisor_id       the bot that was asked (you.board_advisors). No foreign
--                    key: core is built before you.
--   advisor_chat_id  the one-on-one or group thread it was asked in
--                    (you.advisor_chats), where the link and any failure go.
--   message_id       the person's message being answered (you.advisor_messages).
--                    One page per message, so a retried reply starts nothing new.
--   asked            the person's own words in that message.
--   persona          the bot's persona as it replied, so the page is in its voice.
--   context          what the bot knew that bears on it: the role, the round
--                    and date, the job description, with refs.
--   title            the short name the bot gave the page.
--   file_id          the page, once the routine has kept it.
--   nudged_at        when the bot said it was still working on it.
--   told_at          when the thread was told the page failed.
--
-- core.files
--   format           markdown  a piece of writing, as before (every row so far)
--                    html      a self-contained page, opened in a sandbox at
--                              /goals/files/<id>/view and framed on its page
--
-- Schema only: existing rows take the defaults and keep their meaning.

set search_path = core, public, extensions;

alter table core.dash_handoffs
  alter column conversation_id drop not null,
  add column kind text not null default 'request',
  add column advisor_id uuid,
  add column advisor_chat_id uuid,
  add column message_id uuid,
  add column asked text,
  add column persona text,
  add column context text,
  add column title text,
  add column file_id uuid,
  add column nudged_at timestamptz,
  add column told_at timestamptz;

alter table core.dash_handoffs
  add constraint dash_handoffs_kind_ck check (kind in ('request', 'page')),
  add constraint dash_handoffs_kind_where_ck check (
    (kind = 'request' and conversation_id is not null)
    or (kind = 'page' and conversation_id is null and advisor_id is not null and advisor_chat_id is not null and title is not null)
  ),
  add constraint dash_handoffs_asked_ck check (asked is null or char_length(asked) <= 20000),
  add constraint dash_handoffs_persona_ck check (persona is null or char_length(persona) <= 40000),
  add constraint dash_handoffs_context_ck check (context is null or char_length(context) <= 12000),
  add constraint dash_handoffs_title_ck check (title is null or (btrim(title) <> '' and char_length(title) <= 200)),
  add constraint dash_handoffs_file_fk foreign key (file_id, user_id)
    references core.files (id, user_id) on delete set null (file_id);

-- One page per message of the person's, whichever bot took it.
create unique index dash_handoffs_page_message_uq on core.dash_handoffs (advisor_chat_id, message_id)
  where kind = 'page' and message_id is not null;

-- What the watch reads: pages still going, and failed ones the thread has not been told of.
create index dash_handoffs_page_open_idx on core.dash_handoffs (created_at)
  where kind = 'page' and (status in ('pending', 'fired') or (status = 'failed' and told_at is null));

comment on column core.dash_handoffs.kind is
  'request: Ask Dash handed it on (plan #1402). page: a bot on People asked a session to make a page (plan #2997).';
comment on column core.dash_handoffs.advisor_chat_id is
  'For a page: the People thread (you.advisor_chats) it was asked in, where the link goes (plan #2997).';
comment on column core.dash_handoffs.file_id is
  'For a page: the core.files row the routine made (plan #2997).';

alter table core.files add column format text not null default 'markdown';

alter table core.files
  add constraint files_format_ck check (format in ('markdown', 'html')),
  add constraint files_format_stored_ck check (format = 'markdown' or storage_path is null);

comment on column core.files.format is
  'markdown: a piece of writing. html: a self-contained page a bot had made (plan #2997), opened in a sandbox.';

notify pgrst, 'reload schema';
