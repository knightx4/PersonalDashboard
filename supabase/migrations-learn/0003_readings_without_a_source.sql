-- Let a reading be something you want to learn, before it is something to read.
--
-- Until now every reading pointed at a `sources` row, because every reading
-- arrived from a paste and a paste names works. But the thing you actually
-- want to write down first is usually not a work: it is "how central banks set
-- rates", or "why the 1965 separation happened". A subject, not a book.
--
-- Two changes, both additive:
--
--   `source_id` becomes nullable -- a reading may have no source yet.
--   `title` arrives -- somewhere to put the subject when there is no source.
--
-- A reading therefore has a subject one of two ways, and the check makes sure
-- it has one of them. Both together is allowed and useful: a source called
-- "A History of Modern Singapore" under your own title "the separation".
--
-- What this does NOT do is add a third level. A track is the broad thing and a
-- reading is the specific thing inside it, which is two levels and is what was
-- asked for. If subjects later need their own readings underneath them, that
-- is a different table and a different decision -- not a nullable column
-- quietly becoming a tree.
--
-- The composite foreign key stays as it is. A Postgres foreign key with MATCH
-- SIMPLE -- the default -- is satisfied when any of its columns is null, so a
-- reading with no source skips the check rather than failing it. Ownership is
-- still enforced on rows that do have a source, and every reading is anchored
-- to an owned track by the other foreign key regardless.

alter table learn.readings
  add column title text;

alter table learn.readings
  alter column source_id drop not null;

-- A reading has to be about something. Without this, a row with neither a
-- source nor a title renders as an empty line you cannot click, delete or
-- explain.
alter table learn.readings
  add constraint readings_has_a_subject_ck
  check (source_id is not null or btrim(coalesce(title, '')) <> '');

alter table learn.readings
  add constraint readings_title_ck
  check (title is null or (btrim(title) <> '' and length(title) <= 500));
