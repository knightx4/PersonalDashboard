-- Too hard or too easy, kept on each Learn now card (plan #890, under #889).
--
-- A card remembers whether the person said it was too hard or too easy, and
-- they can change the rating or take it back, so the column is nullable and
-- null means no rating. It sits apart from `status`: rating a card does not
-- decide it, and a rated card can still be swiped, saved or tested.
--
-- Written by the person's own session through the existing update policy,
-- which limits it to their own rows. The code that pitches the next pick
-- (lib/learn/feed/depth.ts) reads it in a later step.
--
-- Numbered 0043 because learn_0042_youtube_library is already on the live
-- project from a branch not yet on main.

set search_path = learn, public, extensions;

alter table learn.feed_cards add column if not exists difficulty text;

alter table learn.feed_cards drop constraint if exists feed_cards_difficulty_ck;
alter table learn.feed_cards add constraint feed_cards_difficulty_ck
  check (difficulty is null or difficulty in ('too_hard', 'too_easy'));
