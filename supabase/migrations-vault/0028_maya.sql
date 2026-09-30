-- Maya's threads, the messages in them, and the notes Jev has already looked
-- at (plan #1283, under #1282).
--
-- Maya is a thought partner in the vault, a separate character from Dash. Ask
-- it about a note, or let Jev pick a note after a sync, and Maya writes a
-- thought: up to three ranked points drawn from the person's other notes and
-- from outside sources. The thought opens a thread the person can answer.
--
-- 1. obsidian.maya_threads
--
-- One thread per note. question is the line the thread is about, which the
-- person may rewrite; summary is where they have got to, rewritten after each
-- exchange. origin says whether the person asked or Jev picked the note.
--
-- 2. obsidian.maya_messages
--
-- The turns of a thread in order. role is who wrote it; kind is 'thought' for
-- Maya's ranked points on the note and 'reply' for everything said after. A
-- thought keeps its points as jsonb (each with its note quotes and outside
-- sources), the blob_sha of the note it read and the model that wrote it. The
-- person's turns are always replies and carry no points.
--
-- 3. obsidian.maya_gate_checks
--
-- One row per note version Jev has been asked about, so the hourly job asks
-- once per version. outcome is 'thought' when Maya then wrote, 'skip' below
-- the threshold, 'failed' when Jev errored and 'not_enabled' when Jev is off.
--
-- Who writes what. The server actions that ask Maya and reply to it run on
-- the session client, as Talk's do (core.conversation_turns), so the owner may
-- open a thread on their own note, rewrite its question and summary, and add
-- messages of either role to their own threads. The hourly job writes through
-- the service role. Gate checks are the job's bookkeeping: the owner may read
-- theirs and write nothing.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Threads.
-- ---------------------------------------------------------------------------
create table obsidian.maya_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  question text not null
    check (btrim(question) <> '' and char_length(question) <= 200),
  summary text,
  summary_at timestamptz,
  origin text not null check (origin in ('asked', 'automatic')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (note_id, user_id) references obsidian.notes (id, user_id) on delete cascade,
  unique (user_id, note_id),
  unique (id, user_id)
);

comment on table obsidian.maya_threads is
  'One thread per note with Maya: the question, where the person has got to, and whether they asked or Jev picked it (plan #1283).';

create index maya_threads_user_updated_idx
  on obsidian.maya_threads (user_id, updated_at desc);

create trigger maya_threads_touch_updated_at
  before update on obsidian.maya_threads
  for each row execute function obsidian.touch_updated_at();

alter table obsidian.maya_threads enable row level security;

create policy maya_threads_select on obsidian.maya_threads for select to authenticated
  using (user_id = (select auth.uid()));

create policy maya_threads_insert on obsidian.maya_threads for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy maya_threads_update on obsidian.maya_threads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on obsidian.maya_threads from anon, authenticated;
grant select on obsidian.maya_threads to authenticated;
grant insert (user_id, note_id, question, origin, summary, summary_at)
  on obsidian.maya_threads to authenticated;
grant update (question, summary, summary_at) on obsidian.maya_threads to authenticated;
grant select, insert, update, delete on obsidian.maya_threads to service_role;

-- ---------------------------------------------------------------------------
-- 2. Messages.
-- ---------------------------------------------------------------------------
create table obsidian.maya_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('person', 'maya')),
  kind text not null check (kind in ('thought', 'reply')),
  body text not null check (char_length(body) <= 8000),
  points jsonb,
  note_blob_sha text,
  model text,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (thread_id, user_id) references obsidian.maya_threads (id, user_id) on delete cascade,
  -- The person only replies, in words: thoughts and points are Maya's.
  check (role = 'maya' or (kind = 'reply' and points is null)),
  check (points is null or jsonb_typeof(points) = 'array')
);

comment on table obsidian.maya_messages is
  'The turns of a thread with Maya: its thoughts on the note, and the replies either way (plan #1283).';

create index maya_messages_thread_created_idx
  on obsidian.maya_messages (thread_id, created_at);

alter table obsidian.maya_messages enable row level security;

create policy maya_messages_select on obsidian.maya_messages for select to authenticated
  using (user_id = (select auth.uid()));

-- The composite foreign key already ties the thread to the same user_id, so
-- a message can only go into a thread the writer owns.
create policy maya_messages_insert on obsidian.maya_messages for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on obsidian.maya_messages from anon, authenticated;
grant select on obsidian.maya_messages to authenticated;
grant insert (thread_id, user_id, role, kind, body, points, note_blob_sha, model)
  on obsidian.maya_messages to authenticated;
grant select, insert, update, delete on obsidian.maya_messages to service_role;

-- ---------------------------------------------------------------------------
-- 3. Which note versions Jev has looked at.
-- ---------------------------------------------------------------------------
create table obsidian.maya_gate_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  blob_sha text not null,
  probability numeric check (probability is null or probability between 0 and 1),
  outcome text not null check (outcome in ('thought', 'skip', 'failed', 'not_enabled')),
  jev_model text,
  created_at timestamptz not null default now(),
  foreign key (note_id, user_id) references obsidian.notes (id, user_id) on delete cascade,
  unique (note_id, blob_sha)
);

comment on table obsidian.maya_gate_checks is
  'One row per note version Jev was asked about, so Maya''s hourly job asks once per version (plan #1283).';

create index maya_gate_checks_user_created_idx
  on obsidian.maya_gate_checks (user_id, created_at desc);

alter table obsidian.maya_gate_checks enable row level security;

create policy maya_gate_checks_select on obsidian.maya_gate_checks for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on obsidian.maya_gate_checks from anon, authenticated;
grant select on obsidian.maya_gate_checks to authenticated;
grant select, insert, update, delete on obsidian.maya_gate_checks to service_role;
