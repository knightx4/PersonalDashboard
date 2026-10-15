-- What Learn believed about you when it asked (plan #2179.1).
--
-- A question is the only moment the belief is put to a test, and the belief
-- changes the moment the answer lands. So each question keeps the belief it
-- was asked under, beside the outcome and the time taken, and a later step can
-- check the one against the other.
--
-- learn.probes keeps the strength score (lib/learn/strength.ts, 0 to 1) the
-- idea had at the moment the question was shown. A question written ahead has
-- none until the flow takes it off the queue, because the belief is the one at
-- that moment and not at the writing; Not now clears it again with shown_at.
--
-- learn.cell_questions has no strength score: a cell is a level of a topic,
-- and what Learn believes of it is the status it computes and the level it
-- sits at. Both are kept as text and number. shown_at is new on this table and
-- is set when the question is put in front of the person.
--
-- answer_seconds is the time from shown_at to answered_at, falling back to
-- created_at for a question that was asked the moment it was written (every
-- probe outside Practice Flow, every cell question). Null until answered.

set search_path = learn, public, extensions;

alter table learn.probes
  add column predicted_strength numeric(5, 4),
  add column answer_seconds numeric
    generated always as (
      case
        when answered_at is null then null
        else greatest(0, extract(epoch from (answered_at - coalesce(shown_at, created_at))))
      end
    ) stored,
  add constraint probes_predicted_strength_ck
    check (predicted_strength is null or (predicted_strength >= 0 and predicted_strength <= 1));

alter table learn.cell_questions
  add column shown_at timestamptz,
  add column predicted_status text,
  add column predicted_level smallint,
  add column answer_seconds numeric
    generated always as (
      case
        when answered_at is null then null
        else greatest(0, extract(epoch from (answered_at - coalesce(shown_at, created_at))))
      end
    ) stored,
  add constraint cell_questions_predicted_status_ck
    check (predicted_status is null or predicted_status <> ''),
  add constraint cell_questions_predicted_level_ck
    check (predicted_level is null or (predicted_level >= 1 and predicted_level <= 10)),
  add constraint cell_questions_predicted_pair_ck
    check ((predicted_status is null) = (predicted_level is null));
