-- Dash's chats can be pinned, renamed and archived, and searched by what was
-- said in them (plan #1899.6).
--
--   pinned_at    when the chat was pinned to the top of the list on /ask;
--                null when it is not pinned.
--   archived_at  when the chat was archived out of the list; null while it is
--                in the list. An archived chat is kept whole and opens from
--                the Archived view at the foot of the list.
--
-- Renaming writes the title the chat already has. The search looks for a
-- word anywhere in a turn's text, the person's or Dash's, so the turns get a
-- trigram index that an ilike '%word%' can use.

set search_path = core, public, extensions;

alter table core.conversations
  add column if not exists pinned_at timestamptz,
  add column if not exists archived_at timestamptz;

create index if not exists conversation_turns_body_trgm_idx
  on core.conversation_turns using gin (body extensions.gin_trgm_ops);
