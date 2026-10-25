-- What the person said in their chats with Claude, for the insights runs.
--
-- Two kinds of row, by origin:
--   export  one of their own messages from the claude.ai data export
--           (conversations.json), imported on the Insights tab. Only what
--           they wrote is kept, never Claude's replies. message_id is the
--           export's message uuid, so importing a newer export adds only the
--           messages not seen before.
--   saved   something they said about themselves in a chat, saved through
--           the Dash connector's save_about_me while the chat was going on,
--           with why it was saved.
--
-- Schema change only; no existing row is rewritten.

create table if not exists you.claude_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  origin text not null check (origin in ('export', 'saved')),
  message_id text check (message_id is null or char_length(message_id) <= 100),
  conversation_id text check (conversation_id is null or char_length(conversation_id) <= 100),
  conversation_title text check (conversation_title is null or char_length(conversation_title) <= 300),
  said_at timestamptz not null,
  body text not null check (btrim(body) <> '' and char_length(body) <= 20000),
  why text check (why is null or char_length(why) <= 500),
  created_at timestamptz not null default now(),
  constraint claude_chats_message_unique unique (user_id, message_id)
);

comment on table you.claude_chats is
  'Their own messages from claude.ai, imported from the data export, and things they said about themselves saved by save_about_me. Read by the insights runs.';

create index if not exists claude_chats_user_said_idx on you.claude_chats (user_id, said_at desc);

alter table you.claude_chats enable row level security;

create policy claude_chats_all on you.claude_chats for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.claude_chats from anon, authenticated;
grant select, insert, update, delete on you.claude_chats to authenticated, service_role;

notify pgrst, 'reload schema';
