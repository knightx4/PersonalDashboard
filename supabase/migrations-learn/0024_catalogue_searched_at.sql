-- When the catalogue was last searched for a claim.
--
-- #742 settled that the search runs when you press "Find something to read for
-- this", not when you open a claim and not on a schedule. That leaves a claim
-- with no material in two states nothing can tell apart, because
-- `catalogue_links` stores matches only: nobody has pressed the button, and
-- somebody pressed it and nothing survived judging. A candidate the judging
-- call read and refused leaves no row anywhere, so the absence of links is the
-- same absence in both cases.
--
-- One nullable column settles it. Null means nobody has looked, which is every
-- claim in this database today; a time means the last press that got an answer
-- out of the catalogue, whether or not anything matched.
--
-- **The column is written only when the search ran to a verdict.** A press that
-- could not embed the claim, could not reach the index, or could not judge what
-- it retrieved leaves it alone. Two reasons, and the second is the larger one.
-- The claim page reads this column to say "we looked and nothing matched",
-- which a press that never reached the catalogue did not do. And the repeat
-- press above this (#746) reads it to decide whether to search again, so a time
-- written after a failure would turn one timeout into a claim that is never
-- searched again.
--
-- No index. The column is read one claim at a time, by primary key, with the
-- rest of the row the claim page is already loading. Nothing scans for claims
-- searched before a date, and an index for a query nobody writes is a cost on
-- every press that does.
--
-- No grant and no policy either: the table-level grants on `learn.concepts`
-- cover a new column, and `concepts_all` is `for all` on
-- `user_id = auth.uid()`, so the press updates its own row and no other.

set search_path = learn, public, extensions;

alter table learn.concepts
  add column if not exists catalogue_searched_at timestamptz;

comment on column learn.concepts.catalogue_searched_at is
  'When the catalogue was last searched for this claim, or null when nothing ever has. Written by the read button once retrieval and judging have run, whether or not anything matched.';
