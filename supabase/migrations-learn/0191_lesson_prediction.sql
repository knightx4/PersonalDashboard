-- A prediction to open a lesson (plan #2522.6).
--
--   feed_cards.predict_question
--       A question about the idea the lesson has not yet shown, which a
--       guess can answer. The card asks it before the takeaway.
--   feed_cards.predict_answer
--       What is true, in a sentence or two, shown once the person has
--       guessed or skipped.
--
-- Both set, or both null. A lesson written before this file has neither and
-- reads as it did. The guess itself is not stored: it is not graded and
-- moves no state. Columns only, so no existing row is changed.

set search_path = learn, public, extensions;

alter table learn.feed_cards
  add column if not exists predict_question text,
  add column if not exists predict_answer text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'feed_cards_predict_pair_ck' and conrelid = 'learn.feed_cards'::regclass
  ) then
    alter table learn.feed_cards
      add constraint feed_cards_predict_pair_ck
      check ((predict_question is null) = (predict_answer is null));
  end if;
end $$;

comment on column learn.feed_cards.predict_question is
  'A question a guess can answer, asked before the lesson opens (plan #2522.6). Null with predict_answer on older lessons.';
comment on column learn.feed_cards.predict_answer is
  'What is true, shown after the guess or a skip (plan #2522.6). Null with predict_question.';
