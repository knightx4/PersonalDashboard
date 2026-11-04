-- The Council: advice the mentors give unasked, one-on-one talks answered by
-- the board routine, and commitments a mentor follows up on.
--
-- The Board tab becomes the Council. Its sixteen advisors (five seats and
-- eleven guests in you.board_advisors) are now mentors the person can read
-- and talk to, as well as a board that works decisions. This migration
-- stores what that needs; the tables of plan #2581.1 (advisor_chats,
-- advisor_messages, advisor_memory) hold the talks and the memory.
--
-- 1. you.council_runs
--
-- Each session the board routine is fired for on the Council's behalf. kind
-- is advice (the daily round, where a few mentors write a note each) or
-- reply (a mentor answering the person's message in one chat, chat_id).
-- Same life as you.dash_question_runs: queued, running, then ready or
-- failed. One advice run open at a time per person, and one reply run open
-- at a time per chat.
--
-- 2. you.council_notes
--
-- A mentor's note to the person, written without being asked: text, the
-- receipts [ { label, link } ] it rests on (at least one), and the run that
-- wrote it. read_at is set when the person reads it. reaction is theirs:
-- useful, not_useful or disagree, with an optional line in reaction_note.
-- task_id is the todo made from it.
--
-- The person asked that notes not pile up while they are away, so a trigger
-- refuses a new note when
--   * that mentor already has an unread note,
--   * six notes are unread across the council, or
--   * three notes were already written today (UTC).
-- The routine checks the same numbers first; the trigger is the backstop.
--
-- 3. you.advisor_chats gains reply_status (idle, waiting or failed),
-- reply_requested_at and reply_error, so the Council can show that a mentor
-- is writing back. you.advisor_messages gains note_id, the note a message
-- was about, when the person pressed "Talk about this".
--
-- 4. you.advisor_memory gains due_on and done_at, for a commitment: the day
-- the person said they would do it by, and when they said it was done.
-- followed_up_at is when a mentor last asked about it.
--
-- 5. The mentor seat is renamed Jerwyn the Elder, in the owner's account
-- only. Its key stays `mentor`, which the minutes and turns already hold.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Runs.
-- ---------------------------------------------------------------------------

create table you.council_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  chat_id uuid,
  status text not null default 'queued',
  summary text check (summary is null or char_length(summary) <= 2000),
  error text check (error is null or char_length(error) <= 2000),
  run_url text check (run_url is null or char_length(run_url) <= 500),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint council_runs_kind_ck check (kind in ('advice', 'reply')),
  constraint council_runs_chat_ck check ((kind = 'reply') = (chat_id is not null)),
  constraint council_runs_status_ck check (status in ('queued', 'running', 'ready', 'failed')),
  constraint council_runs_id_user_id_key unique (id, user_id),
  foreign key (chat_id, user_id)
    references you.advisor_chats (id, user_id) on delete cascade
);

comment on table you.council_runs is
  'Each board-routine session run for the Council: the daily advice round, or a mentor replying in one chat.';

create index council_runs_user_idx on you.council_runs (user_id, kind, requested_at desc);
create index council_runs_chat_idx on you.council_runs (chat_id) where chat_id is not null;

create unique index council_runs_one_advice
  on you.council_runs (user_id) where kind = 'advice' and status in ('queued', 'running');
create unique index council_runs_one_reply
  on you.council_runs (chat_id) where kind = 'reply' and status in ('queued', 'running');

create trigger council_runs_touch_updated_at
  before update on you.council_runs
  for each row execute function you.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Notes.
-- ---------------------------------------------------------------------------

create table you.council_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  advisor_id uuid not null,
  run_id uuid,
  text text not null check (btrim(text) <> '' and char_length(text) <= 700),
  receipts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  reaction text,
  reaction_note text check (reaction_note is null or char_length(reaction_note) <= 1000),
  reacted_at timestamptz,
  task_id uuid,
  updated_at timestamptz not null default now(),
  constraint council_notes_receipts_ck check (
    jsonb_typeof(receipts) = 'array' and jsonb_array_length(receipts) between 1 and 4
  ),
  constraint council_notes_reaction_ck check (
    reaction is null or reaction in ('useful', 'not_useful', 'disagree')
  ),
  constraint council_notes_id_user_id_key unique (id, user_id),
  foreign key (advisor_id, user_id)
    references you.board_advisors (id, user_id) on delete cascade,
  foreign key (run_id, user_id)
    references you.council_runs (id, user_id) on delete set null (run_id)
);

comment on table you.council_notes is
  'A Council mentor''s note to the person, written unasked by the daily round, with what it rests on, whether they read it and what they made of it.';

create index council_notes_advisor_idx on you.council_notes (user_id, advisor_id, created_at desc);
create index council_notes_unread_idx on you.council_notes (user_id) where read_at is null;
create index council_notes_run_idx on you.council_notes (run_id) where run_id is not null;

create trigger council_notes_touch_updated_at
  before update on you.council_notes
  for each row execute function you.touch_updated_at();

-- The caps the person asked for, so notes never pile up unread.
create or replace function you.council_notes_cap()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if exists (
    select 1 from you.council_notes n
     where n.user_id = new.user_id and n.advisor_id = new.advisor_id and n.read_at is null
  ) then
    raise exception 'This mentor already has an unread note.' using errcode = 'check_violation';
  end if;
  if (
    select count(*) from you.council_notes n where n.user_id = new.user_id and n.read_at is null
  ) >= 6 then
    raise exception 'Six Council notes are unread; nothing new until some are read.' using errcode = 'check_violation';
  end if;
  if (
    select count(*) from you.council_notes n
     where n.user_id = new.user_id
       and n.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  ) >= 3 then
    raise exception 'The Council has written three notes today.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger council_notes_cap
  before insert on you.council_notes
  for each row execute function you.council_notes_cap();

-- ---------------------------------------------------------------------------
-- 3. Chats: a reply being written, and the note a message was about.
-- ---------------------------------------------------------------------------

alter table you.advisor_chats
  add column reply_status text not null default 'idle',
  add column reply_requested_at timestamptz,
  add column reply_error text check (reply_error is null or char_length(reply_error) <= 2000),
  add constraint advisor_chats_reply_status_ck check (reply_status in ('idle', 'waiting', 'failed'));

comment on column you.advisor_chats.reply_status is
  'idle, waiting (the person wrote and a council reply run is answering) or failed (reply_error says why).';

alter table you.advisor_messages add column note_id uuid;
alter table you.advisor_messages
  add constraint advisor_messages_note_fk foreign key (note_id, user_id)
  references you.council_notes (id, user_id) on delete set null (note_id);
create index advisor_messages_note_idx on you.advisor_messages (note_id) where note_id is not null;

comment on column you.advisor_messages.note_id is
  'The Council note this message was about, when the person opened the talk from it.';

-- ---------------------------------------------------------------------------
-- 4. Commitments.
-- ---------------------------------------------------------------------------

alter table you.advisor_memory
  add column due_on date,
  add column done_at timestamptz,
  add column followed_up_at timestamptz,
  add constraint advisor_memory_commitment_dates_ck check (
    kind = 'commitment' or (due_on is null and done_at is null)
  );

comment on column you.advisor_memory.due_on is
  'For a commitment: the day the person said they would do it by.';
comment on column you.advisor_memory.done_at is
  'For a commitment: when the person said it was done.';
comment on column you.advisor_memory.followed_up_at is
  'When a mentor last asked the person about this, in a note or a reply.';

-- ---------------------------------------------------------------------------
-- 5. Access.
-- ---------------------------------------------------------------------------

alter table you.council_runs enable row level security;
alter table you.council_notes enable row level security;

create policy council_runs_all on you.council_runs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy council_notes_all on you.council_notes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.council_runs, you.council_notes from anon, authenticated;
grant select, insert, update, delete on you.council_runs, you.council_notes to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Jerwyn the Elder, in the owner's account.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('core.dev_owner_id()') is not null then
    update you.board_advisors
       set name = 'Jerwyn the Elder'
     where key = 'mentor' and kind = 'seat' and user_id = core.dev_owner_id();
  end if;
end;
$$;

notify pgrst, 'reload schema';
