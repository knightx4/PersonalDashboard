-- Group chats with two to eight bots (plan #2879.1.1, under #2879.1).
--
-- Messages in Chat can hold a group as well as a chat with one bot. The
-- person picks two to eight bots, may name the group, and each bot answers
-- as itself; a bot may react to a message instead of writing one. This
-- migration stores what that needs.
--
-- 1. you.advisor_chats gains
--
--   kind        direct (one bot, named by advisor_id, as every chat so far)
--               or group (advisor_id null; the bots are in
--               you.advisor_chat_members). title stays optional: a group
--               with none is called by its members' first names.
--
-- 2. you.advisor_chat_members
--
-- One row per bot in a group, keyed by chat and bot.
--
--   joined_at      when the bot was added.
--   left_at        when it was taken out, or retired from Chat; null while
--                  it is in the group. A bot deleted outright loses its row
--                  with it.
--   typing_until   while now() is before it, this bot is typing in this
--                  group. A direct chat keeps its one bot's typing on
--                  you.advisor_chats.typing_until, which a group uses as the
--                  lease on the reply run instead.
--
-- At most eight bots are in a group at once; a trigger refuses a ninth.
--
-- 3. you.advisor_messages gains
--
--   speaker_id     the bot that wrote a message in a group. Set null when
--                  that bot is deleted; null on the person's messages and on
--                  every direct chat's.
--
-- 4. you.advisor_message_reactions
--
-- A bot tapping back on a message: one reaction per bot per message, of
-- heart, thumbs_up, thumbs_down, laugh, emphasis or question.
--
-- 5. The members and reactions tables join the supabase_realtime
-- publication, so per-bot typing and reactions reach the open thread.
-- Both are owner-only through RLS, as the chat tables are.
--
-- Schema change only. Every existing chat becomes kind direct by its
-- default; no row of any account is otherwise written.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Chats: direct or group.
-- ---------------------------------------------------------------------------

alter table you.advisor_chats
  add column kind text not null default 'direct',
  alter column advisor_id drop not null;

alter table you.advisor_chats
  add constraint advisor_chats_kind_ck check (kind in ('direct', 'group')),
  add constraint advisor_chats_kind_advisor_ck check ((kind = 'direct') = (advisor_id is not null));

comment on column you.advisor_chats.kind is
  'direct (one bot, advisor_id) or group (advisor_id null, bots in you.advisor_chat_members) (plan #2879.1.1).';
comment on column you.advisor_chats.advisor_id is
  'The one bot of a direct chat; null for a group, whose bots are in you.advisor_chat_members (plan #2879.1.1).';

create index advisor_chats_kind_idx
  on you.advisor_chats (user_id, kind, last_message_at desc nulls last);

-- ---------------------------------------------------------------------------
-- 2. Members of a group.
-- ---------------------------------------------------------------------------

create table you.advisor_chat_members (
  chat_id uuid not null,
  advisor_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  typing_until timestamptz,

  primary key (chat_id, advisor_id),
  constraint advisor_chat_members_span_ck check (left_at is null or left_at >= joined_at),
  foreign key (chat_id, user_id)
    references you.advisor_chats (id, user_id) on delete cascade,
  foreign key (advisor_id, user_id)
    references you.board_advisors (id, user_id) on delete cascade
);

comment on table you.advisor_chat_members is
  'Each bot in a group chat: when it joined, when it left (null while in), and when its typing ends (plan #2879.1.1).';
comment on column you.advisor_chat_members.typing_until is
  'This bot is typing in the group while now() is before this (plan #2879.1.1).';

create index advisor_chat_members_advisor_idx on you.advisor_chat_members (user_id, advisor_id);

-- A group holds at most eight bots at once, and only a group holds any.
create or replace function you.advisor_chat_members_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  chat_kind text;
  active integer;
begin
  select c.kind into chat_kind from you.advisor_chats c where c.id = new.chat_id;
  if chat_kind is distinct from 'group' then
    raise exception 'Only a group chat has members.' using errcode = '23514';
  end if;
  if new.left_at is null then
    select count(*) into active
      from you.advisor_chat_members m
     where m.chat_id = new.chat_id and m.left_at is null and m.advisor_id <> new.advisor_id;
    if active >= 8 then
      raise exception 'A group holds at most eight bots.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger advisor_chat_members_check
  before insert or update of left_at, chat_id on you.advisor_chat_members
  for each row execute function you.advisor_chat_members_check();

-- ---------------------------------------------------------------------------
-- 3. Messages: who in a group wrote it.
-- ---------------------------------------------------------------------------

alter table you.advisor_messages
  add column speaker_id uuid,
  add constraint advisor_messages_speaker_role_ck check (speaker_id is null or role = 'advisor'),
  add constraint advisor_messages_speaker_fk foreign key (speaker_id, user_id)
    references you.board_advisors (id, user_id) on delete set null (speaker_id);

comment on column you.advisor_messages.speaker_id is
  'The bot that wrote this message in a group chat; null for the person, for a direct chat, and once that bot is deleted (plan #2879.1.1).';

create index advisor_messages_speaker_idx on you.advisor_messages (speaker_id) where speaker_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Reactions.
-- ---------------------------------------------------------------------------

create table you.advisor_message_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null,
  advisor_id uuid not null,
  reaction text not null,
  created_at timestamptz not null default now(),

  constraint advisor_message_reactions_reaction_ck
    check (reaction in ('heart', 'thumbs_up', 'thumbs_down', 'laugh', 'emphasis', 'question')),
  constraint advisor_message_reactions_one_key unique (message_id, advisor_id),
  foreign key (message_id, user_id)
    references you.advisor_messages (id, user_id) on delete cascade,
  foreign key (advisor_id, user_id)
    references you.board_advisors (id, user_id) on delete cascade
);

comment on table you.advisor_message_reactions is
  'A bot tapping back on a message in a group, one per bot per message: heart, thumbs_up, thumbs_down, laugh, emphasis or question (plan #2879.1.1).';

create index advisor_message_reactions_user_idx on you.advisor_message_reactions (user_id, created_at desc);
create index advisor_message_reactions_advisor_idx on you.advisor_message_reactions (advisor_id);

-- ---------------------------------------------------------------------------
-- 5. Row level security and grants.
-- ---------------------------------------------------------------------------

alter table you.advisor_chat_members enable row level security;
alter table you.advisor_message_reactions enable row level security;

create policy advisor_chat_members_all on you.advisor_chat_members for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy advisor_message_reactions_all on you.advisor_message_reactions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.advisor_chat_members, you.advisor_message_reactions from anon, authenticated;
grant select, insert, update, delete
  on you.advisor_chat_members, you.advisor_message_reactions
  to authenticated, service_role;

revoke all on function you.advisor_chat_members_check() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Realtime: typing per bot and reactions reach the open thread.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'you' and tablename = 'advisor_chat_members'
    ) then
      alter publication supabase_realtime add table you.advisor_chat_members;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'you' and tablename = 'advisor_message_reactions'
    ) then
      alter publication supabase_realtime add table you.advisor_message_reactions;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
