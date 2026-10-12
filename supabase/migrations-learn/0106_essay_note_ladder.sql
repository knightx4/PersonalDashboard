-- What a margin note says at each rung, and why it was raised (plan #1869,
-- under #1863; docs/LEARN-ESSAYS-SPEC.md, "What Dash does, and how far it
-- goes" and "Margin notes and checks").
--
-- A check writes the whole ladder in the one call that finds the problem, so
-- Help moves a note up a rung without another call:
--
-- learn.essay_notes.ladder  what the note says at rungs 1 to 3, as a JSON
--                           array of strings: [question, hint, directions].
--                           `body` is the entry for the rung the note is on
--                           (empty at rung 0, the marker alone).
-- learn.essay_notes.why     what Explain shows: why the check raised it.
-- status 'waiting'          a note found while three were already open. It
--                           opens, oldest first, when an open one is closed.

alter table learn.essay_notes
  add column if not exists ladder jsonb not null default '[]'::jsonb,
  add column if not exists why text not null default '';

alter table learn.essay_notes drop constraint if exists essay_notes_ladder_array;
alter table learn.essay_notes add constraint essay_notes_ladder_array
  check (jsonb_typeof(ladder) = 'array');

alter table learn.essay_notes drop constraint if exists essay_notes_status_check;
alter table learn.essay_notes add constraint essay_notes_status_check
  check (status in ('open', 'waiting', 'done', 'dismissed', 'detached'));

comment on column learn.essay_notes.ladder is
  'What the note says at rungs 1 to 3: [question, hint, directions] (plan #1869).';
comment on column learn.essay_notes.why is
  'Why the check raised the note, shown by Explain (plan #1869).';
