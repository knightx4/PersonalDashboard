-- The territory a subject's preparation compiled (plan #2276.4).
--
-- The compile_territory step reads the documents the preparation stored and
-- lays out the subject's topics, each with the frame topic it refines, a
-- target level and the document lines it came from. It is kept here, one per
-- subject, in the shape of lib/learn/levels/territory.ts, so the drafting
-- step (#2276.5) and the territory-draft route read it by subject. A column on
-- the existing table: no new table, no existing row changes.

set search_path = learn, public, extensions;

alter table learn.subject_preparations
  add column if not exists territory jsonb;

comment on column learn.subject_preparations.territory is
  'The territory compile_territory laid out from the stored documents: texts (the documents as numbered lines) and topics (ask, scope, frame, target, from, canonicality), in the Territory shape of lib/learn/levels/territory.ts. Null until the step has run.';
