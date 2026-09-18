-- Whether a concept is a door into its subject, or something downstream of one.
--
-- Meyer and Land's threshold concepts: a handful of ideas in any subject are
-- the ones you have to get through before anything after them lands --
-- opportunity cost, marginal thinking, equilibrium -- and the rest are
-- consequences of those. Without the distinction every node in a subject is
-- the same size, so forty claims read as a flat list and the four that are
-- actually in the way are buried in it.
--
-- Nullable, and that is the decision in plan #304 rather than an oversight.
-- Every concept written from now on says which it is; the ones already in the
-- graph say neither, because nobody has judged them and a default would assert
-- something nobody checked. Null reads as "not said" everywhere it is shown,
-- the same way an unverified locator says it is unverified.

set search_path = learn, public, extensions;

-- Two values and no third. "Unsure" belongs in the absence of a row's mark,
-- not in a value of its own: a mark that can say "maybe" is one every screen
-- has to render twice.
create type learn.concept_kind as enum (
  'threshold',    -- a door: usually counterintuitive, and what follows it does
                  -- not land until you are through it
  'consequence'   -- follows from a door, and is learnable once you have it
);

alter table learn.concepts
  add column if not exists kind learn.concept_kind;

comment on column learn.concepts.kind is
  'Whether this concept is a door into the subject or a consequence of one. '
  'Null for a concept written before the distinction existed, which is shown '
  'as unsaid rather than as either.';
