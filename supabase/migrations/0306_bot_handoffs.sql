-- Hand-offs from any bot to a Claude Code session (plan #3005.1, under #3005).
--
-- core.dash_handoffs (0143, #1402) keeps the requests Ask Dash passes to the
-- backup routine, and plan #2997 (migration bot_pages) widened it for pages a
-- bot on People asks a session to make: kind, advisor_id, advisor_chat_id,
-- message_id, asked, context, title, file_id, nudged_at, told_at. Every bot
-- now hands any heavy work to a session the same way, so this widens the one
-- table again rather than adding a second: the routine, the "Dash is on it"
-- marks and the sources catalogue keep reading one place.
--
-- A third kind, session: any bot (Ask Dash, or a person on People such as
-- Gert, Zena, Jerwyn, Maya or the builder, in a one-on-one or a group chat)
-- handing any request to a Claude Code session.
--
--   sender          advisor_id names the bot; null is Ask Dash.
--   thread          conversation_id for Ask Dash, advisor_chat_id for a
--                   People chat. A session hand-off has exactly one.
--   asked           the person's request in their own words. request stays
--                   the bot's version, complete on its own for the session.
--
-- New columns:
--
--   summary         a short summary of the thread up to the request.
--   refs            the rows and findings the session should read:
--                   [{ "ref": "schema.table:id", "note": "..." }].
--   request_key     one per request, from the thread and the message that
--                   asked. A retried turn sends the same key, and the unique
--                   constraint keeps it to one row.
--   cost_micros     what the session cost, in millionths of a dollar, as
--                   core.model_spend counts it.
--   last_seen_at    when the session last reported, so one gone quiet can
--                   be flagged.
--   state           queued, running, done or failed, read from status
--                   (pending is queued, fired is running). Generated, so the
--                   stored status values and their readers stay as they are.
--
-- The columns from bot_pages are added here too when missing, so this file
-- also stands on a database built without that one.
--
-- Schema change only: no account's rows are written.

set search_path = core, public, extensions;

alter table core.dash_handoffs
  alter column conversation_id drop not null,
  add column if not exists kind text not null default 'request',
  add column if not exists advisor_id uuid,
  add column if not exists advisor_chat_id uuid,
  add column if not exists message_id uuid,
  add column if not exists asked text,
  add column if not exists title text,
  add column summary text,
  add column refs jsonb not null default '[]'::jsonb,
  add column request_key text,
  add column cost_micros bigint,
  add column last_seen_at timestamptz,
  add column state text generated always as (
    case status when 'pending' then 'queued' when 'fired' then 'running' else status end
  ) stored;

alter table core.dash_handoffs
  drop constraint if exists dash_handoffs_kind_ck,
  drop constraint if exists dash_handoffs_kind_where_ck;

alter table core.dash_handoffs
  add constraint dash_handoffs_kind_ck check (kind in ('request', 'page', 'session')),
  add constraint dash_handoffs_kind_where_ck check (
    (kind = 'request' and conversation_id is not null)
    or (kind = 'page' and conversation_id is null and advisor_id is not null and advisor_chat_id is not null and title is not null)
    or (
      kind = 'session' and request_key is not null and asked is not null
      and (
        (conversation_id is not null and advisor_chat_id is null and advisor_id is null)
        or (conversation_id is null and advisor_chat_id is not null and advisor_id is not null)
      )
    )
  ),
  add constraint dash_handoffs_session_asked_ck check (kind <> 'session' or btrim(asked) <> ''),
  add constraint dash_handoffs_summary_ck check (summary is null or char_length(summary) <= 4000),
  add constraint dash_handoffs_refs_ck check (jsonb_typeof(refs) = 'array' and jsonb_array_length(refs) <= 50),
  add constraint dash_handoffs_request_key_ck check (
    request_key is null or (btrim(request_key) <> '' and char_length(request_key) <= 300)
  ),
  add constraint dash_handoffs_cost_ck check (cost_micros is null or cost_micros >= 0),
  -- One row per request: a retried turn with the same key is refused, and
  -- the insert reads back the row already kept. Rows with no key stay
  -- distinct, as every row before this was.
  add constraint dash_handoffs_request_key_key unique (user_id, request_key);

-- A People chat's hand-offs, for "how's it going?" in that chat.
create index if not exists dash_handoffs_advisor_chat_idx on core.dash_handoffs (advisor_chat_id, created_at)
  where advisor_chat_id is not null;
-- The sessions still going, for the silence watch and the count on Dev home.
create index dash_handoffs_session_open_idx on core.dash_handoffs (user_id, created_at)
  where kind = 'session' and status in ('pending', 'fired');

comment on table core.dash_handoffs is
  'A request a bot handed on: to the backup routine (request, plan #1402), for a page (page, plan #2997), or to a Claude Code session (session, plan #3005), and what became of it.';
comment on column core.dash_handoffs.kind is
  'request: Ask Dash handed it to the backup routine (plan #1402). page: a bot on People asked a session to make a page (plan #2997). session: any bot handed any request to a Claude Code session (plan #3005).';
comment on column core.dash_handoffs.advisor_id is
  'The bot that handed it on (you.board_advisors); null is Ask Dash (plans #2997, #3005.1).';
comment on column core.dash_handoffs.asked is
  'The person''s request in their own words; request is the bot''s version for the session (plans #2997, #3005.1).';
comment on column core.dash_handoffs.summary is
  'A short summary of the thread up to the request (plan #3005.1).';
comment on column core.dash_handoffs.refs is
  'The rows and findings the session should read: [{ref, note}] (plan #3005.1).';
comment on column core.dash_handoffs.request_key is
  'One per request, from the thread and the asking message; a retried turn reuses it and gets the same row (plan #3005.1).';
comment on column core.dash_handoffs.cost_micros is
  'What the session cost, in millionths of a dollar (plan #3005.1).';
comment on column core.dash_handoffs.last_seen_at is
  'When the session last reported, for flagging one gone quiet (plan #3005.1).';
comment on column core.dash_handoffs.state is
  'queued, running, done or failed, read from status: pending is queued, fired is running (plan #3005.1).';

notify pgrst, 'reload schema';
