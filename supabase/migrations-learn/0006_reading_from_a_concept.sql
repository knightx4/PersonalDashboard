-- The reading remembers which gap it came from.
--
-- A concept marked shaky already becomes a reading: `readAboutConcept` writes
-- an ordinary row in an ordinary track and sends you to it. What it does not
-- do is store which concept that was, so by the time you open the row the
-- graph behind it is gone. The reading knows the claim -- it is the title --
-- and knows nothing about what else you have settled in that subject.
--
-- That link is what lets the source search be rooted. Given the concept, the
-- search can be handed the subject's settled claims and its frontier, and told
-- not to offer something that only re-teaches what is settled or that opens by
-- assuming what is not. Without it the rooting silently does nothing, which is
-- worse than not having it: a search that says it knows where you are and does
-- not is the guess this was meant to replace.
--
-- Nullable, and most rows will stay null. A reading you typed yourself came
-- from nowhere in particular, and that is not a defect to be backfilled.

alter table learn.readings
  add column if not exists concept_id uuid;

-- Ownership by the key, not by a check. The pair (concept_id, user_id) points
-- at concepts (id, user_id), so a reading cannot reach a concept in another
-- account -- referential integrity bypasses RLS, and carrying user_id in the
-- key is what makes the cross-account link impossible rather than unlikely.
-- MATCH SIMPLE, the default, means a row with a null concept_id skips the
-- check entirely, which is every reading that did not come from a gap.
--
-- `set null (concept_id)` names the column, so deleting a concept -- or the
-- subject above it -- clears the link and leaves the reading where it is. A
-- bare `set null` would try to null user_id as well and fail; a cascade would
-- delete a reading that lives in a track and has nothing to do with the
-- subject being tidied away.
alter table learn.readings
  add constraint readings_concept_fk
  foreign key (concept_id, user_id) references learn.concepts (id, user_id)
  on delete set null (concept_id);

-- Which readings were queued for this gap. A handful of rows out of a queue
-- that grows forever, so the index only carries the ones that have a concept.
create index if not exists readings_concept_idx
  on learn.readings (concept_id)
  where concept_id is not null;

comment on column learn.readings.concept_id is
  'The concept this reading was queued to close, when it came from a gap in a '
  'subject graph. Null for a reading you wrote down yourself. What roots the '
  'source search in what the graph already counts as settled.';
