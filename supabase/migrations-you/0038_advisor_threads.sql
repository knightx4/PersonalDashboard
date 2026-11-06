-- Mentor threads that can grow for years (plan #2748.2, under #2748).
--
-- Chat is becoming a workspace where the person texts their mentors the way
-- they text people. A thread with one mentor is one you.advisor_chats row and
-- never ends, so a reply has to read a fixed amount however long it grows,
-- and a new message or the mentor's typing has to reach the page the moment
-- it is written. This migration stores what that needs.
--
-- 1. you.advisor_episodes
--
-- One row per conversation in a thread. A conversation ends after three
-- quiet hours: the next message starts a new episode. A trigger on
-- you.advisor_messages keeps them, so every message belongs to exactly one
-- episode, the one whose started_at..ended_at covers its created_at.
--
--   started_at, ended_at   the first and newest message's created_at. An
--                          episode is over once ended_at is three hours old.
--   first_message_id,      the messages that open and close it.
--   last_message_id
--   message_count          how many messages it holds.
--   summary                what was said, written by the overnight memory
--                          run (#2748.8) once the episode is over; null until
--                          then. A reply reads the summaries of older
--                          episodes and the messages of the open one.
--
-- 2. you.advisor_messages gains
--
--   kind          reply (an ordinary message, the person's or the mentor's),
--                 ack (a mentor's short first bubble before the reply), or
--                 text_first (a mentor writing unasked, such as a daily
--                 note). ack and text_first are a mentor's only.
--   delivered_at  when the message reached the other side: the page for a
--                 mentor's message, the reply run for the person's.
--   read_at       when it was read: by the person, or by the mentor's reply.
--   search        a generated tsvector of text, with a GIN index, so a reply
--                 can recall an old message by its words.
--
-- 3. you.advisor_chats gains
--
--   typing_until  while now() is before it, the mentor is typing.
--   last_read_at  when the person last had the thread open; messages after
--                 it are unread.
--
-- 4. you.board_advisors gains
--
--   persona       the mentor's character in their own terms: how they talk,
--                 what they care about. Read before every reply.
--   colour        their bubble and avatar colour, as #rrggbb.
--   made_by_you   true for a mentor the person invented, rather than one
--                 drawn from a real person's public work.
--
-- 5. you.advisor_messages and you.advisor_chats join the supabase_realtime
-- publication. Realtime reads each event through the subscriber's own RLS,
-- and both tables are owner-only already, so only the owner hears them.
--
-- Schema change, plus episodes backfilled for the owner's messages only. No
-- other account's rows are written; their messages get episodes as they
-- write new ones.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Mentors: persona, colour, made by you.
-- ---------------------------------------------------------------------------

alter table you.board_advisors
  add column persona text check (persona is null or (btrim(persona) <> '' and char_length(persona) <= 8000)),
  add column colour text check (colour is null or colour ~ '^#[0-9a-f]{6}$'),
  add column made_by_you boolean not null default false;

comment on column you.board_advisors.persona is
  'The mentor''s character in their own terms, how they talk and what they care about, read before every reply (plan #2748.2).';
comment on column you.board_advisors.colour is
  'The mentor''s bubble and avatar colour as #rrggbb, lower case; null picks one from the key (plan #2748.2).';
comment on column you.board_advisors.made_by_you is
  'True for a mentor the person invented, false for one drawn from a real person''s public work (plan #2748.2).';

-- ---------------------------------------------------------------------------
-- 2. Threads: typing and read.
-- ---------------------------------------------------------------------------

alter table you.advisor_chats
  add column typing_until timestamptz,
  add column last_read_at timestamptz;

comment on column you.advisor_chats.typing_until is
  'The mentor is typing while now() is before this; the reply run pushes it forward as it writes (plan #2748.2).';
comment on column you.advisor_chats.last_read_at is
  'When the person last had the thread open; the mentor''s messages after it are unread (plan #2748.2).';

-- ---------------------------------------------------------------------------
-- 3. Messages: kind, receipts of delivery and reading, words for recall.
-- ---------------------------------------------------------------------------

alter table you.advisor_messages
  add column kind text not null default 'reply',
  add column delivered_at timestamptz,
  add column read_at timestamptz,
  add column search tsvector generated always as (to_tsvector('english'::regconfig, text)) stored;

alter table you.advisor_messages
  add constraint advisor_messages_kind_ck check (kind in ('reply', 'ack', 'text_first')),
  add constraint advisor_messages_kind_role_ck check (kind = 'reply' or role = 'advisor');

create index advisor_messages_search_idx on you.advisor_messages using gin (search);

comment on column you.advisor_messages.kind is
  'reply (an ordinary message), ack (a mentor''s short first bubble before the reply) or text_first (a mentor writing unasked); ack and text_first are the mentor''s only (plan #2748.2).';
comment on column you.advisor_messages.delivered_at is
  'When the message reached the other side: the page for a mentor''s message, the reply run for the person''s (plan #2748.2).';
comment on column you.advisor_messages.read_at is
  'When the message was read: by the person, or by the mentor''s reply (plan #2748.2).';
comment on column you.advisor_messages.search is
  'The text as an English tsvector, for recalling an old message by its words (plan #2748.2).';

-- ---------------------------------------------------------------------------
-- 4. Episodes: one row per conversation, ending after three quiet hours.
-- ---------------------------------------------------------------------------

create table you.advisor_episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  first_message_id uuid,
  last_message_id uuid,
  message_count integer not null default 1 check (message_count >= 0),
  summary text check (summary is null or (btrim(summary) <> '' and char_length(summary) <= 4000)),
  summarised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint advisor_episodes_span_ck check (ended_at >= started_at),
  constraint advisor_episodes_id_user_id_key unique (id, user_id),
  foreign key (chat_id, user_id)
    references you.advisor_chats (id, user_id) on delete cascade,
  foreign key (first_message_id, user_id)
    references you.advisor_messages (id, user_id) on delete set null (first_message_id),
  foreign key (last_message_id, user_id)
    references you.advisor_messages (id, user_id) on delete set null (last_message_id)
);

comment on table you.advisor_episodes is
  'One conversation in a mentor thread: its span, first and last message, and the summary the overnight run writes once three quiet hours have closed it (plan #2748.2).';
comment on column you.advisor_episodes.summary is
  'What was said, written once the episode is over (ended_at three hours old); null until then (plan #2748.2).';
comment on column you.advisor_episodes.summarised_at is
  'When summary was written; an episode that grew after it is due again (plan #2748.2).';

create index advisor_episodes_chat_idx on you.advisor_episodes (chat_id, started_at desc);
create index advisor_episodes_user_idx on you.advisor_episodes (user_id, ended_at desc);
create index advisor_episodes_first_idx on you.advisor_episodes (first_message_id) where first_message_id is not null;
create index advisor_episodes_last_idx on you.advisor_episodes (last_message_id) where last_message_id is not null;

create trigger advisor_episodes_touch_updated_at
  before update on you.advisor_episodes
  for each row execute function you.touch_updated_at();

-- Each new message joins its thread's newest episode when that one's last
-- message is under three hours older, and starts a new episode otherwise.
-- Runs as the writer, so the person's own RLS covers it.
create or replace function you.advisor_messages_episode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ep record;
begin
  select e.id, e.started_at, e.ended_at
    into ep
    from you.advisor_episodes e
   where e.chat_id = new.chat_id
   order by e.started_at desc
   limit 1
   for update;

  if ep.id is not null and new.created_at < ep.ended_at + interval '3 hours'
     and new.created_at >= ep.started_at then
    update you.advisor_episodes
       set ended_at = greatest(ended_at, new.created_at),
           last_message_id = case when new.created_at >= ended_at then new.id else last_message_id end,
           message_count = message_count + 1
     where id = ep.id;
  else
    insert into you.advisor_episodes
      (user_id, chat_id, started_at, ended_at, first_message_id, last_message_id, message_count)
    values
      (new.user_id, new.chat_id, new.created_at, new.created_at, new.id, new.id, 1);
  end if;
  return new;
end;
$$;

create trigger advisor_messages_episode
  after insert on you.advisor_messages
  for each row execute function you.advisor_messages_episode();

-- The owner's messages written before this migration, grouped the same way.
with ordered as (
  select m.id, m.user_id, m.chat_id, m.created_at,
         case
           when lag(m.created_at) over w is null
             or m.created_at >= lag(m.created_at) over w + interval '3 hours' then 1
           else 0
         end as starts
    from you.advisor_messages m
   where m.user_id = core.dev_owner_id()
  window w as (partition by m.chat_id order by m.created_at, m.id)
),
numbered as (
  select o.*, sum(o.starts) over (partition by o.chat_id order by o.created_at, o.id) as n
    from ordered o
),
spans as (
  select n.user_id, n.chat_id, n.n,
         min(n.created_at) as started_at,
         max(n.created_at) as ended_at,
         (array_agg(n.id order by n.created_at, n.id))[1] as first_message_id,
         (array_agg(n.id order by n.created_at desc, n.id desc))[1] as last_message_id,
         count(*)::integer as message_count
    from numbered n
   group by n.user_id, n.chat_id, n.n
)
insert into you.advisor_episodes
  (user_id, chat_id, started_at, ended_at, first_message_id, last_message_id, message_count)
select s.user_id, s.chat_id, s.started_at, s.ended_at, s.first_message_id, s.last_message_id, s.message_count
  from spans s
 where s.user_id = core.dev_owner_id()
   and not exists (select 1 from you.advisor_episodes e where e.chat_id = s.chat_id);

-- ---------------------------------------------------------------------------
-- 5. Row level security and grants.
-- ---------------------------------------------------------------------------

alter table you.advisor_episodes enable row level security;

create policy advisor_episodes_all on you.advisor_episodes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.advisor_episodes from anon, authenticated;
grant select, insert, update, delete on you.advisor_episodes to authenticated, service_role;

revoke all on function you.advisor_messages_episode() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Realtime: the thread hears new messages, receipts and typing.
-- The local test database has no publication, so each table is added only
-- where Supabase made one.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'you' and tablename = 'advisor_messages'
    ) then
      alter publication supabase_realtime add table you.advisor_messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'you' and tablename = 'advisor_chats'
    ) then
      alter publication supabase_realtime add table you.advisor_chats;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
