-- A learning goal's track has its whole outline written at once (plan #1139).
--
-- Other tracks get three or four units when they start and one more each time
-- the last is nearly done. A goal's track gets every unit in one call, sized
-- to the goal's depth, so the person sees the whole course from the start.
--
--   outlined_at  when the track's whole outline was written. Null for a track
--                whose units are written as it goes. The Learn now top-up
--                adds no unit to a track with this set, and writes the
--                outline for a goal's track that does not have it yet.

set search_path = learn, public, extensions;

alter table learn.subjects add column if not exists outlined_at timestamptz;

comment on column learn.subjects.outlined_at is
  'When the track''s whole outline was written (plan #1139). Null for a track whose units are written as it goes.';
