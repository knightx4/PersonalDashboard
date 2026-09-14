-- A quiz over material you chose, its material, and its questions.
--
-- Specified in plan #429 and decided in #446. You pick a few vault notes or
-- paste something in, say what you are preparing for, and get questions drawn
-- from that material. The questions are written once, up front, and stored --
-- the same reason learn.opening_sweeps stores its ten: a quiz has to survive a
-- closed tab and still be readable a week later, so it is rows rather than
-- something carried in a request.
--
-- Three tables:
--
--   learn.quizzes         one quiz: what it is called and what it is for
--   learn.quiz_sources    the material, one row per note or paste
--   learn.quiz_questions  the questions, what you wrote, and how it was marked
--
-- A note is named by id and read where it lives. Its body is never copied in
-- here, which is the rule the todo module already holds to for rows belonging
-- to another schema: two copies of a note disagree the moment the vault syncs.
-- Pasted text has no other home, so that is stored.
--
-- Nothing here touches the concept graph. A quiz over your interview notes
-- stands on its own and does not put one-off nodes into a subject that lives
-- forever.

set search_path = learn, public, extensions;

-- How far through a quiz you are. Derived from the questions, never written by
-- hand -- see learn.sync_quiz_status() below.
create type learn.quiz_status as enum (
  'unanswered',
  'part_done',
  'finished'
);

-- How one answer came out.
--
-- The three values learn.opening_outcome carries, and deliberately not that
-- type: an opening sweep and a quiz are answered on different screens for
-- different reasons, and sharing the enum would mean a value added for one of
-- them silently arriving in the other.
create type learn.quiz_outcome as enum (
  'right',
  'wrong',
  'skipped'
);

-- ---------------------------------------------------------------------------
-- The quiz.
-- ---------------------------------------------------------------------------
create table learn.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- What it is called in the list of quizzes you have taken.
  title text not null,
  -- What you said you were preparing for -- "an interview on Thursday". It
  -- aims the questions when they are written, and it is what tells two quizzes
  -- over the same notes apart afterwards. Null when you did not say.
  preparing_for text,

  -- DERIVED. Maintained solely by learn.sync_quiz_status(); the same rule the
  -- shopping side holds for order status. A quiz that says it is finished
  -- while a question sits unanswered is a list page that lies.
  status learn.quiz_status not null default 'unanswered',
  -- When the last outstanding question was answered. Cleared if a question is
  -- added afterwards, because the quiz is then not finished.
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quizzes_title_ck check (title <> ''),
  constraint quizzes_preparing_for_ck check (preparing_for is null or preparing_for <> '')
);

-- The composite key the sources and questions point at, so neither can be
-- attached to another account's quiz. Referential integrity bypasses RLS,
-- which is why the key carries user_id everywhere else in this schema.
alter table learn.quizzes add constraint quizzes_user_id_uq unique (id, user_id);

-- The list page: your quizzes, newest first.
create index quizzes_user_created_idx on learn.quizzes (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The material it is over.
--
-- Exactly one of the two per row, the shape todo.task_links uses: a note id
-- read where it lives, or text you pasted. A third kind -- a file -- is one
-- column and one edited check constraint when #447 says what a file means.
-- ---------------------------------------------------------------------------
create table learn.quiz_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  quiz_id uuid not null,

  -- The order you picked them in. Fixed at write time so the material reads
  -- back the same way every time rather than depending on how rows come back.
  position int not null,

  -- A note in the vault, read by id when the questions are written. Never
  -- copied: the body lives in obsidian.notes and nowhere else.
  note_id uuid references obsidian.notes (id) on delete cascade,
  -- Text you pasted. Stored, because there is no other row holding it.
  body text,

  created_at timestamptz not null default now(),

  constraint quiz_sources_exactly_one_ck check (num_nonnulls(note_id, body) = 1),
  constraint quiz_sources_body_ck check (body is null or body <> ''),
  constraint quiz_sources_position_ck check (position >= 0),
  constraint quiz_sources_position_uq unique (quiz_id, position),
  constraint quiz_sources_quiz_fk
    foreign key (quiz_id, user_id) references learn.quizzes (id, user_id) on delete cascade
);

-- The key the questions point at, for the same reason the quiz carries one.
alter table learn.quiz_sources add constraint quiz_sources_user_id_uq unique (id, user_id);

create index quiz_sources_quiz_idx on learn.quiz_sources (quiz_id, position);
-- The same note twice in one quiz is material counted twice.
create unique index quiz_sources_note_key on learn.quiz_sources (quiz_id, note_id)
  where note_id is not null;

-- ---------------------------------------------------------------------------
-- The questions, in the order they are asked.
--
-- learn.opening_questions with a source instead of a claim: written once,
-- answered in your own words, marked against the model answer stored beside
-- the question.
-- ---------------------------------------------------------------------------
create table learn.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  quiz_id uuid not null,
  -- Which piece of material this one came from, so the result page can say
  -- where the answer was supposed to come from.
  source_id uuid not null,

  position int not null,

  question text not null,
  -- The model answer, written with the question. It is what the grader
  -- compares a written answer against, and what gets shown once answered.
  expected text not null,

  -- What you wrote. Null until you answer, and null forever on one you passed.
  response text,
  outcome learn.quiz_outcome,
  answered_at timestamptz,

  created_at timestamptz not null default now(),

  constraint quiz_questions_question_ck check (question <> ''),
  constraint quiz_questions_expected_ck check (expected <> ''),
  constraint quiz_questions_position_ck check (position >= 0),
  -- Answered is a fact with two halves, the same rule the opening questions
  -- and the probes carry.
  constraint quiz_questions_answered_ck check ((outcome is null) = (answered_at is null)),
  -- A graded outcome is a judgement about something you wrote, so the thing
  -- you wrote has to be there. A pass has nothing to grade and stores nothing.
  constraint quiz_questions_response_ck check (
    case
      when outcome in ('right', 'wrong') then response is not null and response <> ''
      else response is null
    end
  ),
  constraint quiz_questions_position_uq unique (quiz_id, position),
  constraint quiz_questions_quiz_fk
    foreign key (quiz_id, user_id) references learn.quizzes (id, user_id) on delete cascade,
  constraint quiz_questions_source_fk
    foreign key (source_id, user_id) references learn.quiz_sources (id, user_id) on delete cascade
);

create index quiz_questions_quiz_idx on learn.quiz_questions (quiz_id, position);
create index quiz_questions_source_idx on learn.quiz_questions (source_id);

create trigger quizzes_touch_updated_at
  before update on learn.quizzes
  for each row execute function learn.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A source has to point at a note you own.
--
-- A foreign key is not an ownership check: referential integrity in Postgres
-- bypasses RLS, so obsidian.notes would happily accept a link to somebody
-- else's note and the policy on quiz_sources would never look. The same
-- trigger todo.task_links carries, for the same reason.
-- ---------------------------------------------------------------------------
create or replace function learn.quiz_source_note_is_owned()
returns trigger
language plpgsql
security definer
set search_path = learn, obsidian, public
as $$
declare
  owner uuid;
begin
  if new.note_id is null then
    return new;
  end if;

  select user_id into owner from obsidian.notes where id = new.note_id;

  if owner is null or owner <> new.user_id then
    raise exception 'a quiz source must point at a note its owner owns';
  end if;

  return new;
end;
$$;

create trigger quiz_sources_note_is_owned
  before insert or update on learn.quiz_sources
  for each row execute function learn.quiz_source_note_is_owned();

revoke all on function learn.quiz_source_note_is_owned() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Where the quiz has got to, derived from its questions.
--
-- One writer of `status`, so the list page and the questions cannot disagree.
-- A quiz with no questions yet -- the row the picking screen writes before
-- anything is generated -- is unanswered, and a passed question counts as
-- answered: pressing past a question is a thing you did.
-- ---------------------------------------------------------------------------
create or replace function learn.sync_quiz_status(p_quiz_id uuid)
returns void
language plpgsql
security definer
set search_path = learn, public
as $$
declare
  v_total int;
  v_answered int;
  v_status learn.quiz_status;
begin
  if p_quiz_id is null then
    return;
  end if;

  select count(*), count(*) filter (where outcome is not null)
    into v_total, v_answered
  from learn.quiz_questions
  where quiz_id = p_quiz_id;

  if v_total > 0 and v_answered = v_total then
    v_status := 'finished';
  elsif v_answered > 0 then
    v_status := 'part_done';
  else
    v_status := 'unanswered';
  end if;

  update learn.quizzes
     set status = v_status,
         completed_at = case when v_status = 'finished' then coalesce(completed_at, now()) end
   where id = p_quiz_id;
end;
$$;

revoke all on function learn.sync_quiz_status(uuid) from public, anon, authenticated;

create or replace function learn.sync_quiz_status_from_question()
returns trigger
language plpgsql
security definer
set search_path = learn, public
as $$
begin
  perform learn.sync_quiz_status(case tg_op when 'DELETE' then old.quiz_id else new.quiz_id end);
  return null;
end;
$$;

create trigger quiz_questions_sync_quiz_status
  after insert or update or delete on learn.quiz_questions
  for each row execute function learn.sync_quiz_status_from_question();

revoke all on function learn.sync_quiz_status_from_question() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security. What you could not answer about your own notes is as
-- personal as the rest of this schema.
-- ---------------------------------------------------------------------------
alter table learn.quizzes enable row level security;
alter table learn.quiz_sources enable row level security;
alter table learn.quiz_questions enable row level security;

create policy quizzes_all on learn.quizzes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy quiz_sources_all on learn.quiz_sources for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy quiz_questions_all on learn.quiz_questions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on learn.quizzes, learn.quiz_sources, learn.quiz_questions from anon;

grant select, insert, update, delete on learn.quizzes, learn.quiz_sources, learn.quiz_questions
  to authenticated, service_role;
