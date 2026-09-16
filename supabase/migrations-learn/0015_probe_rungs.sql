-- Which rung a question was asked at, and somewhere for a typed answer to live.
--
-- Every question stored so far is multiple choice, so picking the right answer
-- out of four has been all it takes to call a concept known. Plan #386 puts two
-- harder rungs above it: an applied case you have not seen, answered in a
-- sentence or two of your own, and a defence you have to hold. This records
-- which rung a question was, and keeps the typed answer and its grade beside
-- the multiple-choice ones.
--
-- One table rather than a second one for written questions. A probe row is
-- already "one question asked about one concept, and what came back"; the rung
-- changes which columns carry the question and which carry the answer, not what
-- the row is. Splitting it would put a union in front of every read of a
-- concept's history -- the concept page, the picker, the misconception rule.
--
-- Nothing is backfilled. The column defaults to recognise, which is what every
-- row already there was.

set search_path = learn, public, extensions;

-- The three rungs, hardest last. `defend` is in the enum with nothing writing
-- it yet: the ladder is three rungs whether or not the top one is built, and
-- leaving the value out would mean a second migration to say what this one
-- already knows.
create type learn.probe_rung as enum (
  'recognise',  -- pick the right answer out of four
  'apply',      -- a case you have not seen, answered in your own words
  'defend'      -- state a position and answer the strongest objection to it
);

alter table learn.probes
  add column if not exists rung learn.probe_rung not null default 'recognise';

comment on column learn.probes.rung is
  'Which rung of the ladder this question was asked at. A row written before '
  'the ladder existed reads as recognise, which is what it was.';

-- ---------------------------------------------------------------------------
-- The written path.
--
-- `expected` is to an applied case what `reason` is to a multiple-choice
-- question: written at the same time as the question, stored, and shown only
-- once you have answered -- so it stays the answer that was expected rather
-- than becoming an explanation of whatever you happened to say.
--
-- Whether a typed answer was right is its own boolean. On a multiple-choice
-- row it is a comparison of two indexes and needs no column; on a written one
-- there is nothing to compare, only a judgement, and a judgement nobody stored
-- cannot be read back.
-- ---------------------------------------------------------------------------
alter table learn.probes
  add column if not exists expected text,
  add column if not exists response text,
  add column if not exists response_correct boolean,
  add column if not exists grade_reason text;

comment on column learn.probes.expected is
  'The answer the writer expected, on a written rung. Null on a '
  'multiple-choice row, where `reason` does this job.';
comment on column learn.probes.response is
  'What was typed. Null until the question is answered.';
comment on column learn.probes.response_correct is
  'Whether what was typed held the idea. Right or wrong and nothing between: '
  'half credit would call a concept known off a near miss.';
comment on column learn.probes.grade_reason is
  'The grader''s one sentence on why. Written before the verdict, so the '
  'verdict follows the reasoning rather than the other way round.';

-- ---------------------------------------------------------------------------
-- The multiple-choice halves stop being facts about every row.
--
-- An applied case has no options to keep, no index that is right, and nothing
-- to put in `reason`. So the three columns that carry a multiple-choice
-- question become nullable, and the constraints below are what stops that
-- meaning "sometimes filled in": on a recognise row all three are required and
-- checked exactly as they were, and on the other rungs all three are refused.
-- A row cannot be half of each.
-- ---------------------------------------------------------------------------
alter table learn.probes alter column options drop not null;
alter table learn.probes alter column correct_index drop not null;
alter table learn.probes alter column reason drop not null;

alter table learn.probes drop constraint probes_options_ck;
alter table learn.probes drop constraint probes_correct_ck;
alter table learn.probes drop constraint probes_reason_ck;
alter table learn.probes drop constraint probes_chosen_ck;
alter table learn.probes drop constraint probes_answered_ck;

alter table learn.probes
  add constraint probes_recognise_ck check (
    rung <> 'recognise'
    or (
      options is not null
      and jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) between 2 and 6
      and correct_index is not null
      and correct_index >= 0
      and correct_index < jsonb_array_length(options)
      and reason is not null
      and reason <> ''
      and expected is null
    )
  );

alter table learn.probes
  add constraint probes_written_ck check (
    rung = 'recognise'
    or (
      options is null
      and correct_index is null
      and reason is null
      and expected is not null
      and expected <> ''
    )
  );

-- The picked answer, on the only rung that has one to pick.
alter table learn.probes
  add constraint probes_chosen_ck check (
    chosen_index is null
    or (
      rung = 'recognise'
      and chosen_index >= 0
      and chosen_index < jsonb_array_length(options)
    )
  );

-- The typed answer, on the rungs that take one. Blank is not an answer.
alter table learn.probes
  add constraint probes_response_ck check (
    response is null or (rung <> 'recognise' and response <> '')
  );

-- The grade and its sentence arrive with the answer they are about. A verdict
-- with nothing graded is a judgement about nothing, and an answer stored
-- ungraded is one the concept page cannot say anything about.
alter table learn.probes
  add constraint probes_grade_ck check (
    case
      when rung = 'recognise' then response_correct is null and grade_reason is null
      else (response_correct is null) = (response is null)
           and (grade_reason is null) = (response is null)
           and (grade_reason is null or grade_reason <> '')
    end
  );

-- Answered is a fact with two halves, and which column is the answer depends on
-- the rung. Half of it, either way, is a row nobody can read.
alter table learn.probes
  add constraint probes_answered_ck check (
    case
      when rung = 'recognise' then (chosen_index is null) = (answered_at is null)
      else (response is null) = (answered_at is null)
    end
  );
