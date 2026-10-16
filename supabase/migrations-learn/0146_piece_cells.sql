-- The cells each piece of a plan teaches, and its check as a cell question
-- (LEARN-LESSONS-SPEC "A piece names the cells it teaches"; plan #2138.13).
--
--   plan_pieces.cell_ids
--       the cells (learn.topic_cells) of the goal's territory the piece
--       teaches, in the order the matcher named them. Set when the piece is
--       written. Empty when the goal had no territory then, or when the
--       piece teaches none of it.
--   plan_pieces.cells_matched_at
--       when cell_ids was matched against a territory. Null on a piece
--       written before its goal had one, which a later pass of the pieces'
--       top-up matches; set, an empty list means the piece teaches none.
--   cell_questions.piece_id
--       the piece whose check this question is. A piece that names a cell it
--       can ask about checks with a cell question on it, graded by the level
--       grader and written as cell_evidence like any other; the piece is
--       passed when one wrote a met on the cell it asked. Deleting the piece
--       keeps the question and its evidence, which are what the person
--       showed, and clears only the link.
--
-- cell_ids holds no foreign key, as concept_ids does not: a cell deleted from
-- the map drops out of the list when it is read.

set search_path = learn, public, extensions;

alter table learn.plan_pieces add column if not exists cell_ids uuid[] not null default '{}';
alter table learn.plan_pieces add column if not exists cells_matched_at timestamptz;

comment on column learn.plan_pieces.cell_ids is
  'The cells of the goal''s territory the piece teaches (plan #2138.13). Empty when it had none to match against or teaches none.';
comment on column learn.plan_pieces.cells_matched_at is
  'When cell_ids was matched against the goal''s territory. Null until then, so a later pass fills it.';

alter table learn.cell_questions add column if not exists piece_id uuid;

alter table learn.cell_questions
  add constraint cell_questions_piece_fk
    foreign key (piece_id, user_id) references learn.plan_pieces (id, user_id)
    on delete set null (piece_id);

create index if not exists cell_questions_piece_idx on learn.cell_questions (piece_id, created_at desc)
  where piece_id is not null;

comment on column learn.cell_questions.piece_id is
  'The plan piece whose check this question is (plan #2138.13). Null on a question asked from Practice Flow.';
