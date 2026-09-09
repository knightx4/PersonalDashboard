-- Manual order inside a pile.
--
-- lib/todo/tasks/model.ts said this would need "a position column and the
-- fractional-index problem behind it", and deferred it until sorting actually
-- grated. It grated: the automatic order is right about which day a thing is
-- due and has no idea which of four things due today you mean to do first.
--
-- No fractional indices. A move renumbers every task in that pile 1..n in the
-- order you are looking at, which is a handful of rows for a personal list and
-- costs one statement. Fractional indexing exists to avoid renumbering a
-- shared, unbounded list under concurrent writers; this is neither.
--
-- Nullable, and null is the whole of the old behaviour: a task nobody has
-- placed by hand sorts by the rules it always did. Ordering is done in the
-- reader, over tasks already loaded, so there is nothing to index here.
alter table todo.tasks add column if not exists position double precision;

comment on column todo.tasks.position is
  'Manual order within a pile. Null means unplaced: sort it by due date and '
  'creation, as before. Renumbered 1..n across the pile whenever one is moved.';
