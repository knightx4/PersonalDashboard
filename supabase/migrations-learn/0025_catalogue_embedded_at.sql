-- When a segment became searchable.
--
-- #743's answer is that a second press on a claim searches again only when new
-- material has arrived, and #746 is the press that has to decide that. Nothing
-- in the catalogue could answer it. `catalogue_items.updated_at` moves whenever
-- a work is re-fetched, whether or not anything about it changed.
-- `catalogue_segments.created_at` is when the row was written, which is before
-- the sweep embeds it and never moves again, so a section fetched in March and
-- embedded in September reads as older than a search run in June and the press
-- that should have found it would skip. `catalogue_providers.last_swept_at` is
-- per provider and is null for all seven seeded rows.
--
-- The time the vector was written is the one that answers it. A segment with no
-- vector cannot be retrieved and so is not material a claim could have found;
-- the check constraint keeps the two null together, the same way
-- `catalogue_segments_embedding_ck` keeps the model with the vector. That also
-- covers a section rewritten in place: the re-sweep nulls both columns because
-- the text changed, and the next embedding pass stamps a new time, which puts
-- the segment back in front of every claim searched before it.
--
-- The backfill writes `now()` rather than `created_at`. Neither is the truth
-- for a row embedded before this column existed, and `now()` is the one that
-- errs towards searching: a claim searched yesterday looks again on its next
-- press instead of skipping material nobody knows the age of. The catalogue is
-- empty in this database today, so it writes nothing here.
--
-- The index is partial because the press asks one question of this column --
-- has anything been embedded since this time -- and a segment with no vector is
-- never part of the answer.
--
-- No grant and no policy. The table-level grant covers a new column, and
-- `catalogue_segments_select` is `using (true)` for `authenticated`, which is
-- what the press reads this through.

set search_path = learn, public, extensions;

alter table learn.catalogue_segments
  add column if not exists embedded_at timestamptz;

comment on column learn.catalogue_segments.embedded_at is
  'When the current vector was written. Null exactly when the segment has no embedding. Read by the read button to decide whether anything has been embedded since the claim was last searched.';

update learn.catalogue_segments
   set embedded_at = now()
 where embedding is not null and embedded_at is null;

alter table learn.catalogue_segments
  drop constraint if exists catalogue_segments_embedded_at_ck;
alter table learn.catalogue_segments
  add constraint catalogue_segments_embedded_at_ck check (
    (embedding is null) = (embedded_at is null)
  );

create index if not exists catalogue_segments_embedded_at_idx
  on learn.catalogue_segments (embedded_at)
  where embedded_at is not null;
