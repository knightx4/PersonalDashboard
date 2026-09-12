-- What understanding a concept looks like, kept beside the claim.
--
-- A claim on its own says what is true; it does not say what having it looks
-- like. So a concept carries two to four short checks -- what it rules out,
-- how it applies to a case with the numbers changed, what the standard
-- objection to it is -- and a probe question is then written against one of
-- them rather than against the claim in general.
--
-- A jsonb array of strings rather than a table of its own. The checks are read
-- and written only as the whole list that belongs to one concept, never
-- queried across concepts, and nothing points at an individual check: the
-- probe row stores the text it was written against verbatim, the way it
-- already stores its options. A table would buy a foreign key nobody follows
-- and cost a join on every read of the graph.
--
-- Nullable, and a concept with no checks is not a defect. A chain can come
-- back with a node the model wrote none for, and showing that node with an
-- empty list is better than refusing it and losing the node.

alter table learn.concepts
  add column if not exists mastery jsonb;

-- Two to four, each a non-empty string. The count is a real bound rather than
-- a tidy one: one check is a restatement of the claim, and five is a syllabus
-- for the concept instead of a test of it. Written as a check constraint and
-- not left to the application because the application is a model writing
-- through a Zod schema, and a schema that drifts is exactly how a row with one
-- empty string in it gets stored.
--
-- No subquery, which a check constraint may not contain: the two jsonpath
-- tests do the work `not exists (select ...)` would. The first refuses an
-- element that is not a string, the second an element that is blank or only
-- whitespace.
alter table learn.concepts
  add constraint concepts_mastery_ck
  check (
    mastery is null
    or (
      jsonb_typeof(mastery) = 'array'
      and jsonb_array_length(mastery) between 2 and 4
      and not (mastery @? '$[*] ? (@.type() != "string")')
      and not (mastery @? '$[*] ? (@ like_regex "^\\s*$")')
    )
  );

comment on column learn.concepts.mastery is
  'Two to four short checks saying what understanding this claim looks like, '
  'in the order they were written. A probe question is aimed at one of them. '
  'Null for a concept whose checks were never written.';
