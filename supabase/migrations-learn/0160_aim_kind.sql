-- What kind of goal each learning goal is (plan #2247.2).
--
-- Before a territory is drafted, the goal is sorted into one of six kinds, and
-- the kind decides which sources are tried and at what grain
-- (lib/learn/goal-kind.ts). One Haiku call reads the goal's name and line and
-- answers with a kind and a sentence of why; the person can change either.
--
--   kind            academic_course, research_subfield, narrow_question,
--                   institution, practical_skill or broad_field. Null until
--                   the goal has been classified.
--   kind_reason     one sentence saying why, shown beside the kind.
--   kind_by         'model' when the call chose it, 'person' when they changed
--                   it. A person's choice is never overwritten by the call.
--   kind_model      the model that chose it, or 'manual-backfill' for a goal
--                   sorted by a session when this column was added.
--   kind_at         when it was set.
--   kind_read_name, kind_read_about
--                   the wording the call read. A model-set kind whose goal has
--                   since been reworded no longer matches these, which is how
--                   the next save knows to classify it again.

set search_path = learn, public, extensions;

alter table learn.aims
  add column if not exists kind text,
  add column if not exists kind_reason text,
  add column if not exists kind_by text,
  add column if not exists kind_model text,
  add column if not exists kind_at timestamptz,
  add column if not exists kind_read_name text,
  add column if not exists kind_read_about text;

alter table learn.aims
  drop constraint if exists aims_kind_ck,
  drop constraint if exists aims_kind_by_ck,
  drop constraint if exists aims_kind_complete_ck;

alter table learn.aims
  add constraint aims_kind_ck
    check (kind is null or kind in (
      'academic_course', 'research_subfield', 'narrow_question',
      'institution', 'practical_skill', 'broad_field')),
  add constraint aims_kind_by_ck
    check (kind_by is null or kind_by in ('model', 'person')),
  add constraint aims_kind_complete_ck
    check ((kind is null) = (kind_by is null) and (kind is null) = (kind_at is null));

comment on column learn.aims.kind is
  'The goal''s kind, which decides the providers its territory draft pulls from (lib/learn/goal-kind.ts). Null until classified.';
comment on column learn.aims.kind_by is
  'model or person. A kind the person set is never replaced by the classifying call.';
