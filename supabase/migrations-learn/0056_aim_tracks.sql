-- Each learning goal gets a track (LEARN-LESSONS-SPEC, build step 6; plan #972).
--
-- A goal set on the Goals page used to be drawn for section cards, one card in
-- three. An open goal now has a track instead, and its Learn now cards are
-- lessons from that track. The goal records which track is its own:
--
-- aims
--   subject_id  the goal's track. Set when the goal is saved, or by the Learn
--               now top-up for a goal that has none. The track is found by the
--               goal's name, so a goal named like a track you already have
--               takes that track. Null for the Level 3 goal, which still draws
--               from its list, and for a goal whose track was deleted, until
--               the next top-up gives it another. Archiving the goal leaves the
--               track, which stays one of your tracks.
--
-- The lesson chooser reads the tracks of active goals by person, so the index
-- covers that read.

set search_path = learn, public, extensions;

alter table learn.aims
  add column if not exists subject_id uuid references learn.subjects (id) on delete set null;

create index if not exists aims_subject_idx
  on learn.aims (user_id, subject_id)
  where subject_id is not null and archived_at is null;
