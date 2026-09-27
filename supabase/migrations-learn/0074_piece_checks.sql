-- The check at the end of a piece, one row per question asked (plan #1141).
--
-- A piece of a learning goal's plan ends with one question answered in
-- writing. Haiku writes the question when the person asks for it and marks
-- what they write. A right answer sets the piece's passed_at and marks its
-- ideas tested; a wrong one keeps the row with what was missing, and trying
-- again writes a fresh question in a new row, told the ones already asked.
--
--   question, expected   what was asked and the answer it was marked against.
--   response             what they wrote. Null until answered.
--   correct, marked_why  the mark and the marker's sentence on what the
--                        answer had or was missing. Set with the response.
--   answered_at          when it was marked.
--
-- A piece's checks go with the piece.

set search_path = learn, public, extensions;

-- The composite key a check's foreign key needs, so a check cannot point at
-- someone else's piece.
create unique index if not exists plan_pieces_id_user_uq on learn.plan_pieces (id, user_id);

create table if not exists learn.piece_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  piece_id uuid not null,

  question text not null,
  expected text not null,
  response text,
  correct boolean,
  marked_why text,
  answered_at timestamptz,

  -- The model that wrote the question, for the day one turns out wrong.
  write_model text,
  created_at timestamptz not null default now(),

  constraint piece_checks_piece_fk
    foreign key (piece_id, user_id) references learn.plan_pieces (id, user_id) on delete cascade,
  constraint piece_checks_question_ck check (btrim(question) <> '' and btrim(expected) <> ''),
  -- Answered means marked: all four together, or none of them.
  constraint piece_checks_answered_ck check (
    (response is null and correct is null and answered_at is null)
    or (response is not null and correct is not null and answered_at is not null)
  )
);

create index if not exists piece_checks_user_idx on learn.piece_checks (user_id);
create index if not exists piece_checks_piece_idx on learn.piece_checks (piece_id, created_at desc);

alter table learn.piece_checks enable row level security;

drop policy if exists piece_checks_all on learn.piece_checks;
create policy piece_checks_all on learn.piece_checks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on learn.piece_checks from anon;
-- Insert for a new question and update for the answer, from the piece's page.
grant select, insert, update on learn.piece_checks to authenticated;
grant select, insert, update, delete on learn.piece_checks to service_role;

comment on table learn.piece_checks is
  'Questions asked at the end of a piece of a learning goal''s plan, with what was answered and the mark (plan #1141).';
