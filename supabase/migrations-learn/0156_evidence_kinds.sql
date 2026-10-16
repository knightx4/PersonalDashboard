-- Every evidence link says what kind of evidence it is, and how far that kind
-- can reach (plan #2172.2).
--
-- A mark on the map came from work you did, a graded course, a note you
-- wrote, a clipping or video you saved, or a mention, and each kind has a
-- ceiling: work 1, a graded course its grade and age (the weight the course
-- writer already gives it), a note 0.5, a clipping or a video 0.25, a mention
-- 0. A link's ceiling is the smaller of its own weight and its kind's, so an
-- application note at 0.4 stays at 0.4. The score reads the ceiling, never
-- the weight, and evidence of one kind never reads past the highest ceiling
-- of that kind however many links there are (lib/learn/evidence/kinds.ts).
--
-- A mention is a name match that does not count (held_reason, plan #2172.1),
-- or one of your ideas naming a topic: the idea's own state reaches the topic
-- through the ideas attached to it, so its text naming the topic adds
-- nothing. A mention alone writes nothing to a topic's state.
--
-- A clipping is a note at the clipping weight (a note in Bulk or Pending you
-- have not written in, lib/learn/evidence/notes.ts), and a reading counts as
-- one.
--
-- Argued writing (0.75) is a kind the app knows but nothing writes yet:
-- decision #2172.5 holds it back until the matcher repair has been measured.
--
-- Both columns are generated, so every writer, the SQL refresh of work
-- evidence included, gets them without a change, and they cannot disagree
-- with the weight and the reason they come from.

set search_path = learn, public, extensions;

alter table learn.evidence_links
  add column if not exists kind text generated always as (
    case
      when held_reason is not null then 'mention'
      when source_kind = 'idea' then 'mention'
      when source_kind = 'work' then 'work'
      when source_kind = 'course' then 'course'
      when source_kind = 'video' then 'video'
      when source_kind = 'reading' then 'clipping'
      when source_kind = 'note' and weight <= 0.25::real then 'clipping'
      else 'note'
    end
  ) stored;

alter table learn.evidence_links
  add column if not exists ceiling real generated always as (
    case
      when held_reason is not null or source_kind = 'idea' then 0::real
      when source_kind in ('video', 'reading') then least(weight, 0.25::real)
      when source_kind = 'note' and weight <= 0.25::real then least(weight, 0.25::real)
      when source_kind = 'note' then least(weight, 0.5::real)
      else least(weight, 1::real)
    end
  ) stored;

comment on column learn.evidence_links.kind is
  'What kind of evidence the link is: work, course, note, clipping, video or mention (plan #2172.2). Generated from source_kind, weight and held_reason. A mention counts for nothing on its own.';
comment on column learn.evidence_links.ceiling is
  'The most this link can count for, 0 to 1: the smaller of its weight and its kind''s ceiling (work 1, course 1 with the grade and age already in the weight, note 0.5, clipping and video 0.25, mention 0). The score reads this, not weight (plan #2172.2).';
comment on column learn.evidence_links.weight is
  'What the source counts for before its kind''s ceiling: a note 1 or 0.25 for a clipping, a course its grade times its age, work 1 or 0.4 for application notes. Read ceiling for the score (plan #2172.2).';
