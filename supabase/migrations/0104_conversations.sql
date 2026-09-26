-- A conversation with Dash about something you are reading (plan #1053).
--
-- Feature #1051 lets you ask about a Learn now card and explain an idea back;
-- the News feature after it does the same on a newsletter story. Each exchange
-- is kept as you go, so closing the tab mid-way loses nothing and the thread
-- can be read again later. One shape for both modules, so it lives in core.
--
-- What a conversation is about is `subject_kind` and `subject_ref`:
--
--   feed_card    subject_ref is the learn.feed_cards id.
--   news_story   reserved for the News feature. A story is a position in the
--                stories array on news.issues, and re-summarising a
--                newsletter rewrites that array (news 0009, 0015), so the ref
--                format is that feature's to choose. Its kind is allowed here
--                so choosing it needs no change to this table.
--
-- There is no foreign key from subject_ref to the thing it names: core is
-- built before the module schemas and cannot point into them, and the kinds
-- name different tables. A conversation therefore outlives its card, as a
-- note does (learn 0061). `title` is what the subject was called when the
-- conversation began, so a thread whose card or story is gone can still say
-- what it was about.
--
-- One conversation per subject: asking a second question on the same card
-- adds to the thread already there.
--
-- Turns carry user_id and join their conversation by the composite key
-- (conversation_id, user_id), so a turn cannot be added to another account's
-- conversation: a plain foreign key is checked without RLS.
--
-- created_at on a turn defaults to clock_timestamp() rather than now(), so
-- a question and its reply written in one statement still sort in the order
-- they were given.

set search_path = core, public, extensions;

create table core.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  subject_kind text not null,
  subject_ref text not null,
  -- What the subject was called when the conversation began.
  title text,

  created_at timestamptz not null default now(),

  constraint conversations_kind_ck check (subject_kind in ('feed_card', 'news_story')),
  constraint conversations_ref_ck check (btrim(subject_ref) <> ''),
  constraint conversations_title_ck check (title is null or btrim(title) <> '')
);

-- One per subject, and what the upsert in lib/talk/store.ts targets.
create unique index conversations_subject_uq
  on core.conversations (user_id, subject_kind, subject_ref);

-- What the turns' composite foreign key points at.
create unique index conversations_id_user_uq on core.conversations (id, user_id);

create table core.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,

  -- 'user' is the person, 'assistant' is Dash: the roles the model is sent.
  role text not null,
  body text not null,

  created_at timestamptz not null default clock_timestamp(),

  constraint conversation_turns_conversation_fk foreign key (conversation_id, user_id)
    references core.conversations (id, user_id) on delete cascade,
  constraint conversation_turns_role_ck check (role in ('user', 'assistant')),
  constraint conversation_turns_body_ck check (btrim(body) <> '' and length(body) <= 8000)
);

-- A thread read in order.
create index conversation_turns_conversation_idx
  on core.conversation_turns (conversation_id, created_at);
create index conversation_turns_user_idx on core.conversation_turns (user_id);

alter table core.conversations enable row level security;
alter table core.conversation_turns enable row level security;

create policy conversations_all on core.conversations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy conversation_turns_all on core.conversation_turns for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.conversations from anon;
revoke all on core.conversation_turns from anon;
grant select, insert, update, delete on core.conversations to authenticated, service_role;
grant select, insert, update, delete on core.conversation_turns to authenticated, service_role;

comment on table core.conversations is
  'A saved conversation with Dash about a Learn now card or a news story (plan #1053).';
comment on table core.conversation_turns is
  'The turns of a conversation in core.conversations, oldest first by created_at.';
