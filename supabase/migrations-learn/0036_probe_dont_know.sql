-- "I don't know" on a multiple-choice question (note a62b132f, answer A).
--
-- Pressing it answers the question with nothing picked: it counts as a miss,
-- so the idea goes shaky, and the right answer and its reason are shown. The
-- row needs to say which of the two it was, because a question with no chosen
-- index and no answered_at is one that was asked and never answered.
--
--   dont_know  true when the question was answered by saying you did not
--              know. Only on the multiple-choice rung, and never alongside a
--              chosen index.
--
-- probes_answered_ck is rewritten so a recognise row is answered when it has a
-- chosen index or says it was not known, and not before.

set search_path = learn, public, extensions;

alter table learn.probes
  add column if not exists dont_know boolean not null default false;

alter table learn.probes drop constraint if exists probes_dont_know_ck;
alter table learn.probes
  add constraint probes_dont_know_ck check (
    not dont_know or (rung = 'recognise' and chosen_index is null)
  );

alter table learn.probes drop constraint if exists probes_answered_ck;
alter table learn.probes
  add constraint probes_answered_ck check (
    case
      when rung = 'recognise' then (chosen_index is null and not dont_know) = (answered_at is null)
      else (response is null) = (answered_at is null)
    end
  );
