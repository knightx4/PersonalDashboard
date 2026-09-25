-- Too hard on a lesson adds a prerequisite (LEARN-LESSONS-SPEC, build step 4;
-- plan #970).
--
-- When a lesson is rated too hard, the Learn now top-up asks what its concept
-- rests on (proposeFloor, lib/learn/graph/floor.ts) and adds the answer under
-- it in the track's graph. It does that once per lesson, so the card records
-- when it was done:
--
-- feed_cards
--   floor_at  when the top-up took this too-hard lesson to add a prerequisite
--             under its concept. Null until then. Set before the model call,
--             so two runs at once do not both add one, and left set whatever
--             the call found: taking the rating back and giving it again does
--             not add a second prerequisite. Set back to null only when the
--             call itself failed, so a later run tries again.
--
-- The top-up reads the lessons still waiting for a prerequisite by person, so
-- a partial index keeps that read to the rows it wants.

set search_path = learn, public, extensions;

alter table learn.feed_cards add column if not exists floor_at timestamptz;

create index if not exists feed_cards_floor_due_idx
  on learn.feed_cards (user_id, written_at desc)
  where reason = 'lesson' and difficulty = 'too_hard' and floor_at is null;
