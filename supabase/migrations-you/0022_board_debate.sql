-- The board's advisors, the questions put to it and every turn of its debate
-- (plan #2561.1, under #2561).
--
-- Until now a meeting kept everything in its minutes jsonb, and the five
-- seats were fixed in code (lib/you/board.ts). The board is becoming a
-- debate over an agenda of the person's questions, with guest advisors who
-- join where they fit. That needs three tables of its own.
--
-- 1. you.board_advisors
--
-- Everyone who can sit on the board. kind is seat (the five standing seats)
-- or guest. key is the advisor's short id (hiring_manager, buffett), the
-- same keys the minutes and the marks already use for the seats. question is
-- the one question the advisor owns, and focus a short line on what they
-- look at. brain is what Dash has built from a guest's public work, as a
-- jsonb object:
--
--   rules       [ text ]
--   frameworks  [ { name, text } ]
--   positions   [ { topic, text } ]
--   stories     [ { text, source? } ]
--   voice       text: how they speak
--   sources     [ { label, link } ]
--
-- brain_status moves none, building, then ready or failed; ready needs a
-- brain. active is false for an advisor taken off the board, kept so the
-- turns they spoke stay readable. added_by is person or dash.
--
-- 2. you.board_questions
--
-- A question for the board. options is [ { letter, text } ]. lean is the
-- person's current lean, a letter or a few words. advisors is the keys of
-- the advisors they asked to hear from, empty for the board's own choice.
-- source is person (they asked), suggested (Dash suggested it and it waits
-- on them) or board (the board raised it in a meeting). status moves
-- suggested or queued, discussing, then decided, dismissed or deferred.
-- meeting_id is the meeting it was worked in. verdict is the board's, as
-- jsonb:
--
--   recommended   option letter
--   conditions    [ text ]
--   dissent       [ { advisor, text } ]
--   would_change  [ text ]: what would change the recommendation
--   scores        [ { advisor, scores: { <letter>: number } } ], each
--                 advisor's final score per option
--
-- decided_option, decision_note and decided_at are the person's decision.
-- This table is what the person asked and decided, so it is a source.
--
-- 3. you.board_turns
--
-- One thing an advisor said in a meeting. round is 1, 2 or 3. addressed_to
-- is the advisor being answered, or null for the room. kind is opening,
-- reply or vote. scores is { <letter>: number } for the question's options,
-- receipts [ { label, link } ], and position the turn's order within the
-- meeting.
--
-- you.board_meetings needs no new column: a question names its meeting and
-- a turn names its meeting, question and advisor.
--
-- Schema change, plus the twelve advisors seeded for the owner only. The
-- meeting already held is not touched.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Advisors.
-- ---------------------------------------------------------------------------

create table you.board_advisors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  kind text not null default 'guest',
  question text not null check (btrim(question) <> '' and char_length(question) <= 500),
  focus text check (focus is null or char_length(focus) <= 300),
  brain jsonb,
  brain_status text not null default 'none',
  active boolean not null default true,
  added_by text not null default 'person',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint board_advisors_kind_ck check (kind in ('seat', 'guest')),
  constraint board_advisors_brain_ck check (brain is null or jsonb_typeof(brain) = 'object'),
  constraint board_advisors_brain_status_ck check (brain_status in ('none', 'building', 'ready', 'failed')),
  constraint board_advisors_ready_ck check (brain_status <> 'ready' or brain is not null),
  constraint board_advisors_added_by_ck check (added_by in ('person', 'dash')),
  constraint board_advisors_key_key unique (user_id, key),
  constraint board_advisors_id_user_id_key unique (id, user_id)
);

comment on table you.board_advisors is
  'Everyone who can sit on the board: the five seats and the guests, each with the question they own and, for a guest, the brain built from their public work (plan #2561.1).';

create trigger board_advisors_touch_updated_at
  before update on you.board_advisors
  for each row execute function you.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Questions.
-- ---------------------------------------------------------------------------

create table you.board_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null check (btrim(question) <> '' and char_length(question) <= 1000),
  options jsonb not null default '[]'::jsonb,
  context text check (context is null or char_length(context) <= 4000),
  lean text check (lean is null or char_length(lean) <= 500),
  advisors text[] not null default '{}',
  source text not null default 'person',
  status text not null default 'queued',
  meeting_id uuid,
  verdict jsonb,
  decided_option text check (decided_option is null or char_length(decided_option) <= 40),
  decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint board_questions_options_ck check (jsonb_typeof(options) = 'array'),
  constraint board_questions_verdict_ck check (verdict is null or jsonb_typeof(verdict) = 'object'),
  constraint board_questions_source_ck check (source in ('person', 'suggested', 'board')),
  constraint board_questions_status_ck check (
    status in ('suggested', 'queued', 'discussing', 'decided', 'dismissed', 'deferred')
  ),
  constraint board_questions_decided_ck check ((status = 'decided') = (decided_at is not null)),
  constraint board_questions_id_user_id_key unique (id, user_id),

  foreign key (meeting_id, user_id)
    references you.board_meetings (id, user_id) on delete set null (meeting_id)
);

comment on table you.board_questions is
  'The questions the person put to the board or accepted from its suggestions, with the board''s verdict and the person''s decision (plan #2561.1).';

create index board_questions_user_idx on you.board_questions (user_id, status, created_at desc);
create index board_questions_meeting_idx on you.board_questions (meeting_id) where meeting_id is not null;

create trigger board_questions_touch_updated_at
  before update on you.board_questions
  for each row execute function you.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Turns.
-- ---------------------------------------------------------------------------

create table you.board_turns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null,
  question_id uuid,
  round smallint not null check (round between 1 and 3),
  advisor_id uuid not null,
  addressed_to uuid,
  kind text not null,
  text text not null check (btrim(text) <> '' and char_length(text) <= 8000),
  scores jsonb,
  receipts jsonb not null default '[]'::jsonb,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),

  constraint board_turns_kind_ck check (kind in ('opening', 'reply', 'vote')),
  constraint board_turns_scores_ck check (scores is null or jsonb_typeof(scores) = 'object'),
  constraint board_turns_receipts_ck check (jsonb_typeof(receipts) = 'array'),
  constraint board_turns_not_self_ck check (addressed_to is null or addressed_to <> advisor_id),
  constraint board_turns_position_key unique (meeting_id, position),

  foreign key (meeting_id, user_id)
    references you.board_meetings (id, user_id) on delete cascade,
  foreign key (question_id, user_id)
    references you.board_questions (id, user_id) on delete cascade,
  foreign key (advisor_id, user_id)
    references you.board_advisors (id, user_id),
  foreign key (addressed_to, user_id)
    references you.board_advisors (id, user_id) on delete set null (addressed_to)
);

comment on table you.board_turns is
  'Every turn of a board debate: who spoke in which round, to whom, on which question, with their scores per option and receipts (plan #2561.1).';

create index board_turns_question_idx on you.board_turns (question_id, round, position) where question_id is not null;
create index board_turns_advisor_idx on you.board_turns (advisor_id);
create index board_turns_addressed_idx on you.board_turns (addressed_to) where addressed_to is not null;
create index board_turns_user_idx on you.board_turns (user_id);

-- ---------------------------------------------------------------------------
-- 4. Row level security: each person's rows are theirs alone.
-- ---------------------------------------------------------------------------

alter table you.board_advisors enable row level security;
alter table you.board_questions enable row level security;
alter table you.board_turns enable row level security;

create policy board_advisors_all on you.board_advisors for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy board_questions_all on you.board_questions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy board_turns_all on you.board_turns for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.board_advisors, you.board_questions, you.board_turns from anon, authenticated;
grant select, insert, update, delete
  on you.board_advisors, you.board_questions, you.board_turns
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The owner's roster: the five seats and seven guests, guests with no
-- brain yet. Only the owner's account, and only where it exists, so a local
-- database with no such user seeds nothing.
-- ---------------------------------------------------------------------------

insert into you.board_advisors (user_id, key, name, kind, question, focus, added_by)
select u.id, a.key, a.name, a.kind, a.question, a.focus, 'person'
from auth.users u
cross join (values
  ('hiring_manager', 'Hiring manager', 'seat',
    'Would I interview you for the roles you are applying to?',
    'This month: the pipeline, where each application stalled, and how your materials read.'),
  ('mentor', 'Mentor', 'seat',
    'Does this build toward a career you would want in ten years?',
    'Five to ten years: what you are building, and what you are not.'),
  ('skeptic', 'Skeptic', 'seat',
    'Do your hours match what you say matters?',
    'Right now: stated priorities beside where the time went.'),
  ('cfo', 'CFO', 'seat',
    'What does this cost, and can you afford it?',
    'Six to twelve months: spending, runway and income.'),
  ('dreamer', 'Dreamer', 'seat',
    'Which dream does this keep alive, or quietly drop?',
    'No horizon: the big ambitions in your own notes, and the smallest thread that keeps one going.'),
  ('buffett', 'Warren Buffett', 'guest',
    'Will you still be glad of this in twenty years?',
    'Long-term value, staying inside what you understand, and a margin of safety.'),
  ('dalio', 'Ray Dalio', 'guest',
    'What principle would you follow here every time, and what does the evidence say?',
    'Principles, honest reflection on mistakes, and weighing views by who has been right.'),
  ('dimon', 'Jamie Dimon', 'guest',
    'Can you carry this out, and what happens if it goes wrong?',
    'Execution, facing hard facts early, and preparing for the bad case.'),
  ('jobs', 'Steve Jobs', 'guest',
    'Is this the one thing worth doing, and are you willing to say no to the rest?',
    'Focus, saying no, and the care put into the work itself.'),
  ('da_vinci', 'Leonardo da Vinci', 'guest',
    'What would you notice if you studied this with real curiosity?',
    'Close observation, curiosity across fields, and sketching ideas before committing.'),
  ('franklin', 'Benjamin Franklin', 'guest',
    'Is this useful, and does it make you better day by day?',
    'Practical habits, thrift, hard work and steady self-improvement.'),
  ('washington', 'George Washington', 'guest',
    'Does this keep your word and your reputation intact under pressure?',
    'Duty, restraint, character, and knowing when to step back.')
) as a (key, name, kind, question, focus)
where u.id = core.dev_owner_id()
on conflict (user_id, key) do nothing;

notify pgrst, 'reload schema';
