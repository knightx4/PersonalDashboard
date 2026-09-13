-- The ten questions asked before a subject is built, and what you answered.
--
-- Specified in docs/LEARN-GRAPH-SPEC.md and decided in plan #317-#320. Naming
-- a subject you have never studied here asks ten questions across the whole of
-- it, answered from memory, before anything is generated. Those questions and
-- the answers have to survive a closed tab and still be readable when a chain
-- is approved days later, so they are rows rather than something carried in a
-- request.
--
-- Neither table hangs off a subject, and that is #318's answer rather than an
-- omission. No subject row exists when a sweep is written -- nothing reaches
-- the graph before you have approved a chain -- so a sweep carries the words
-- you typed and the subject name the model proposed as plain text, plus a
-- subject id that stays null until approval stamps it in.
--
-- The answers are written, not chosen from a list. That is #319: on a subject
-- you have never studied, one right answer in four is a guess, and a guess
-- would seed a concept as known, which is a concept the views then stop
-- showing you. So `expected` holds the model answer the grader compares
-- against, and `response` holds what you actually wrote.

set search_path = learn, public, extensions;

-- How one opening question came out.
--
-- Skipped is a third value rather than an absent row because passing on a
-- question is an answer about you: it is the honest version of not knowing,
-- and it is what #320's "every question passable" produces. An outcome that
-- is still null is a question you have not reached yet.
create type learn.opening_outcome as enum (
  'right',
  'wrong',
  'skipped'
);

-- ---------------------------------------------------------------------------
-- One sweep: the words you typed, and the subject they turned out to be about.
-- ---------------------------------------------------------------------------
create table learn.opening_sweeps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Your words, kept, the same way learn.goals keeps them. The sweep is found
  -- again by these when the chain for the same goal is generated.
  asked text not null,
  -- The subject the claims were spread across, as the model named it. Text
  -- rather than a link, because there is nothing to link to yet.
  subject_name text not null,
  -- Stamped in when a chain is approved and a subject row finally exists.
  -- Null before that, and null forever for a sweep whose chain was never
  -- approved.
  subject_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint opening_sweeps_asked_ck check (asked <> ''),
  constraint opening_sweeps_subject_name_ck check (subject_name <> ''),
  constraint opening_sweeps_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete set null
);

-- The composite key the questions point at, so a question cannot be attached
-- to another account's sweep. Referential integrity bypasses RLS, which is why
-- the key carries user_id everywhere else in this schema.
alter table learn.opening_sweeps add constraint opening_sweeps_user_id_uq unique (id, user_id);

-- Finding the newest sweep for what somebody typed. Case-insensitive, because
-- "keynesian economics" and "Keynesian economics" are the same goal.
create index opening_sweeps_user_asked_idx on learn.opening_sweeps (user_id, lower(asked), created_at desc);

-- ---------------------------------------------------------------------------
-- The questions in it, in the order they are asked.
-- ---------------------------------------------------------------------------
create table learn.opening_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sweep_id uuid not null,

  -- Where in the ten this one comes. Fixed at write time so the order survives
  -- a resumed sweep rather than depending on how rows come back.
  position int not null,

  -- The claim the question was written against, in the same two parts a
  -- concept uses: a short name and the sentence somebody can be right or wrong
  -- about. Kept here rather than looked up, because the claim may never become
  -- a concept -- a chain that is never approved leaves the sweep as the only
  -- record of what was asked.
  claim_name text not null,
  claim text not null,

  question text not null,
  -- The model answer, written with the question and stored. It is what the
  -- grader compares a written answer against, and it is what gets shown once
  -- the question has been answered.
  expected text not null,

  -- What you wrote. Null until you answer, and null forever on one you passed.
  response text,
  outcome learn.opening_outcome,
  answered_at timestamptz,

  created_at timestamptz not null default now(),

  constraint opening_questions_claim_name_ck check (claim_name <> ''),
  constraint opening_questions_claim_ck check (claim <> ''),
  constraint opening_questions_question_ck check (question <> ''),
  constraint opening_questions_expected_ck check (expected <> ''),
  constraint opening_questions_position_ck check (position >= 0),
  -- Answered is a fact with two halves, the same rule probes already carry.
  constraint opening_questions_answered_ck check ((outcome is null) = (answered_at is null)),
  -- A graded outcome is a judgement about something you wrote, so the thing
  -- you wrote has to be there. A pass has nothing to grade and stores nothing.
  constraint opening_questions_response_ck check (
    case
      when outcome in ('right', 'wrong') then response is not null and response <> ''
      else response is null
    end
  ),
  constraint opening_questions_sweep_fk
    foreign key (sweep_id, user_id) references learn.opening_sweeps (id, user_id) on delete cascade,
  -- One question per place in the order. Two at position 3 is a sweep that
  -- reads back differently every time.
  constraint opening_questions_position_uq unique (sweep_id, position)
);

create index opening_questions_sweep_idx on learn.opening_questions (sweep_id, position);

create trigger opening_sweeps_touch_updated_at
  before update on learn.opening_sweeps
  for each row execute function learn.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security. What somebody could not answer about a subject they have
-- never studied is as personal as the rest of this schema.
-- ---------------------------------------------------------------------------
alter table learn.opening_sweeps enable row level security;
alter table learn.opening_questions enable row level security;

create policy opening_sweeps_all on learn.opening_sweeps for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy opening_questions_all on learn.opening_questions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on learn.opening_sweeps, learn.opening_questions from anon;

grant select, insert, update, delete on learn.opening_sweeps, learn.opening_questions
  to authenticated, service_role;
