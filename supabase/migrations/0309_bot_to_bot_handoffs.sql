-- Hand-offs from one bot to another (plan #3003.1, under #3003).
--
-- The person works something out with one bot and tells it to pass it on:
-- "tell Bob to build it this way", "hand this to Maya". The sending bot
-- says "Passed to Bob." in its own thread and writes one row here; the
-- receiving bot picks it up, acts with its own tools, and says what it did
-- in its own thread. This row is the log of that: who sent what to whom,
-- from which thread, and what became of it.
--
-- core.dash_handoffs (0143, widened by bot_pages and bot_handoffs, 0306)
-- keeps requests handed to the backup routine or a Claude Code session; a
-- hand-off between two bots has a receiver, a packet and a result row of
-- its own, so it is kept apart.
--
--   from_bot / to_bot   the bots (you.board_advisors ids); null is Ask Dash.
--                       Never the same bot at both ends.
--   source_kind         where the person asked: ask (an Ask Dash
--                       conversation), direct (a one-on-one People chat) or
--                       group (a group chat).
--   source_id           that conversation's or chat's id.
--   source_link         the app path to it, for the receiver to read the
--                       whole conversation (/chat/dash/<id>,
--                       /chat/people/<key>, /chat/groups/<id>).
--   source_message_id   the person's message that asked, when known.
--   request             the person's request in their own words.
--   packet              what the receiver needs: {summary, findings,
--                       decisions, refs}, written by the sending bot.
--   status              sent       written, not picked up yet
--                       picked_up  the receiver has started on it
--                       done       the receiver acted and told the person
--                       failed     it could not be done (error says why)
--                       dropped    nobody acted on it in time
--   result              what the receiver did, in a sentence.
--   result_table / result_id   the row it made, if any.
--   dedupe_key          one per request: a repeated or retried request
--                       sends the same key, and the unique constraint keeps
--                       it to one row (ties to plan #2988).
--
-- Schema change only: no account's rows are written.

set search_path = core, public, extensions;

create table core.bot_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  from_bot uuid,
  to_bot uuid,

  source_kind text not null,
  source_id uuid not null,
  source_link text not null,
  source_message_id uuid,

  request text not null,
  packet jsonb not null default '{}'::jsonb,

  status text not null default 'sent',
  sent_at timestamptz not null default clock_timestamp(),
  picked_up_at timestamptz,
  done_at timestamptz,
  result text,
  result_table text,
  result_id text,
  error text,

  dedupe_key text not null,

  constraint bot_handoffs_bots_ck check (from_bot is distinct from to_bot),
  constraint bot_handoffs_source_kind_ck check (source_kind in ('ask', 'direct', 'group')),
  constraint bot_handoffs_source_link_ck check (source_link like '/%' and char_length(source_link) <= 500),
  constraint bot_handoffs_request_ck check (btrim(request) <> '' and char_length(request) <= 20000),
  constraint bot_handoffs_packet_ck check (jsonb_typeof(packet) = 'object' and octet_length(packet::text) <= 60000),
  constraint bot_handoffs_status_ck check (status in ('sent', 'picked_up', 'done', 'failed', 'dropped')),
  constraint bot_handoffs_done_at_ck check (status not in ('done', 'failed', 'dropped') or done_at is not null),
  constraint bot_handoffs_result_ck check (result is null or char_length(result) <= 2000),
  constraint bot_handoffs_result_row_ck check (
    (result_table is null and result_id is null)
    or (result_table ~ '^[a-z_]+\.[a-z_]+$' and btrim(result_id) <> '' and char_length(result_id) <= 100)
  ),
  constraint bot_handoffs_error_ck check (error is null or char_length(error) <= 1000),
  constraint bot_handoffs_dedupe_key_ck check (btrim(dedupe_key) <> '' and char_length(dedupe_key) <= 300),
  -- One row per request: a repeated request with the same key is refused,
  -- and the insert reads back the row already kept.
  constraint bot_handoffs_dedupe_key_key unique (user_id, dedupe_key)
);

-- What a receiving bot has waiting.
create index bot_handoffs_to_bot_idx on core.bot_handoffs (user_id, to_bot, sent_at)
  where status in ('sent', 'picked_up');
-- The hand-offs asked in one thread, for the flag in that thread.
create index bot_handoffs_source_idx on core.bot_handoffs (source_id, sent_at);

alter table core.bot_handoffs enable row level security;

create policy bot_handoffs_all on core.bot_handoffs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.bot_handoffs from anon;
grant select, insert, update, delete on core.bot_handoffs to authenticated, service_role;

comment on table core.bot_handoffs is
  'A request one bot passed to another for the person ("tell Bob ..."), with the context it sent and what the receiver did (plan #3003).';
comment on column core.bot_handoffs.from_bot is 'The bot that passed it on (you.board_advisors); null is Ask Dash.';
comment on column core.bot_handoffs.to_bot is 'The bot it was passed to (you.board_advisors); null is Ask Dash.';
comment on column core.bot_handoffs.source_kind is 'Where the person asked: ask (Ask Dash), direct (a one-on-one chat) or group (a group chat).';
comment on column core.bot_handoffs.source_link is 'The app path to the thread it was asked in, for the receiver to read the whole conversation.';
comment on column core.bot_handoffs.request is 'The person''s request in their own words.';
comment on column core.bot_handoffs.packet is 'What the sending bot passed on: {summary, findings, decisions, refs: [{ref, note}]}.';
comment on column core.bot_handoffs.status is 'sent, picked_up, done, failed (error says why) or dropped (nobody acted on it in time).';
comment on column core.bot_handoffs.result is 'What the receiving bot did, in a sentence.';
comment on column core.bot_handoffs.dedupe_key is 'One per request: the thread, the receiver and the request''s words; a repeated request gets the row already kept.';

notify pgrst, 'reload schema';
