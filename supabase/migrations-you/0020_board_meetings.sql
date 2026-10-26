-- The board's meetings and the person's marks on them (plan #2540.1, under
-- #2540).
--
-- The weekly board (.claude/skills/board/SKILL.md) has written its minutes
-- as a vault note, and the person voted and answered by editing the note.
-- These two tables hold the minutes and the marks instead, for the Board tab
-- in You. They follow the Insights tab's shape: a routine session writes the
-- meeting, the person's marks sit in a table of their own, and the next
-- meeting reads them first.
--
-- 1. you.board_meetings
--
-- One row per meeting. kind is weekly (the Sunday routine) or called (the
-- person asked about one decision, named in decision). status moves queued,
-- running, then ready or failed, as you.insight_runs does, and one meeting
-- may be open at a time. held_on is the date in the minutes' title.
--
-- minutes is a jsonb object, written by the session that held the meeting:
--
--   since          text: what last week's votes and answer change
--   disagreements  [ { key, point, positions: [ { seat, stance?, text,
--                    receipts: [ { label, link } ] } ], note? } ]
--   dream          { text, thread, receipts: [ { label, link } ] }
--   question       text: the one question
--   resolutions    [ { key, what, day, seats: [seat] } ], day an ISO date
--   resolutions_note?  text under the resolutions
--   predictions    [ { seat, text } ]
--   predictions_note?  text above the predictions
--   graded         [ { seat, text, grade, fact? } ], last week's
--                  predictions; grade is hit, miss, cant_tell or pending
--   graded_note?   text, such as "None. This is the first meeting."
--   scorecard      [ { seat, hits, misses } ]
--   memos          [ { seat, memo, resolution?, prediction?,
--                    rebuttal: { to, stance?, text } } ]
--   memos_note?    the chair's corrections
--
-- seat is hiring_manager, mentor, skeptic, cfo or dreamer. stance is how a
-- seat spoke when it was not simply its own view ("arguing against the
-- board's shared view", "in reply to the mentor"); a rebuttal with a stance
-- may have no single seat it answers, and its to is null. Text fields are
-- markdown and may hold links. key is a short id (d1, r1) the marks name.
--
-- 2. you.board_marks
--
-- The person's mark on one item of one meeting:
--   vote        item is a disagreement's key; value is the seat they sided
--               with, or neither
--   answer      item is 'question'; value is their answer
--   resolution  item is a resolution's key; value is done or open; todo_id
--               is the todo made from it, when they made one
-- One mark per item; marking it again replaces the mark and moves marked_at.
--
-- Schema change only; the two meetings already written as vault notes are
-- imported as the owner's rows by the session, not by this file.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Meetings.
-- ---------------------------------------------------------------------------

create table you.board_meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'weekly',
  decision text check (decision is null or (btrim(decision) <> '' and char_length(decision) <= 1000)),
  status text not null default 'queued',
  held_on date,
  minutes jsonb,
  error text check (error is null or char_length(error) <= 2000),
  run_url text check (run_url is null or char_length(run_url) <= 500),
  note_path text check (note_path is null or char_length(note_path) <= 500),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint board_meetings_kind_ck check (kind in ('weekly', 'called')),
  constraint board_meetings_decision_ck check ((kind = 'called') = (decision is not null)),
  constraint board_meetings_status_ck check (status in ('queued', 'running', 'ready', 'failed')),
  constraint board_meetings_minutes_ck check (minutes is null or jsonb_typeof(minutes) = 'object'),
  constraint board_meetings_ready_ck check (status <> 'ready' or (minutes is not null and held_on is not null)),
  constraint board_meetings_id_user_id_key unique (id, user_id)
);

comment on table you.board_meetings is
  'Each board meeting, weekly or called about one decision, with its state and its minutes as jsonb (plan #2540.1).';
comment on column you.board_meetings.note_path is
  'The vault note the minutes were imported from, for the meetings held before the tables existed.';

create index board_meetings_user_idx on you.board_meetings (user_id, held_on desc nulls first, requested_at desc);

-- One meeting at a time, so a second press does not start a second session.
create unique index board_meetings_one_open
  on you.board_meetings (user_id) where status in ('queued', 'running');

create trigger board_meetings_touch_updated_at
  before update on you.board_meetings
  for each row execute function you.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Marks.
-- ---------------------------------------------------------------------------

create table you.board_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null,
  kind text not null,
  item text not null check (item ~ '^[a-z0-9_]{1,40}$'),
  value text not null check (btrim(value) <> '' and char_length(value) <= 4000),
  note text check (note is null or char_length(note) <= 2000),
  todo_id uuid references todo.tasks (id) on delete set null,
  marked_at timestamptz not null default now(),

  constraint board_marks_kind_ck check (kind in ('vote', 'answer', 'resolution')),
  constraint board_marks_vote_ck check (
    kind <> 'vote' or value in ('hiring_manager', 'mentor', 'skeptic', 'cfo', 'dreamer', 'neither')
  ),
  constraint board_marks_answer_ck check (kind <> 'answer' or item = 'question'),
  constraint board_marks_resolution_ck check (kind <> 'resolution' or value in ('done', 'open')),
  constraint board_marks_todo_ck check (todo_id is null or kind = 'resolution'),
  constraint board_marks_item_key unique (meeting_id, kind, item),

  foreign key (meeting_id, user_id)
    references you.board_meetings (id, user_id) on delete cascade
);

comment on table you.board_marks is
  'The person''s marks on a board meeting: a vote on a disagreement, the answer to its question, or a resolution ticked or made a todo (plan #2540.1).';

create index board_marks_user_idx on you.board_marks (user_id, marked_at desc);
create index board_marks_todo_idx on you.board_marks (todo_id) where todo_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Row level security: each person's rows are theirs alone.
-- ---------------------------------------------------------------------------

alter table you.board_meetings enable row level security;
alter table you.board_marks enable row level security;

create policy board_meetings_all on you.board_meetings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy board_marks_all on you.board_marks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.board_meetings, you.board_marks from anon, authenticated;
grant select, insert, update, delete
  on you.board_meetings, you.board_marks
  to authenticated, service_role;

notify pgrst, 'reload schema';
