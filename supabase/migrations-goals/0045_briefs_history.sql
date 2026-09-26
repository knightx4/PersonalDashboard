-- ===========================================================================
-- Claude's notes go in the history like every other goals table.
--
-- 0044 made goals.briefs without the history trigger that every other table
-- in the schema carries (0001, "history"), as 0025 did with goals.reviews
-- before 0026 added it. With it, each note a run leaves is recorded as
-- Claude's and tied to the run.
-- ===========================================================================

alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions', 'collections', 'collection_goals', 'records', 'comments', 'dependencies',
    'reviews', 'context', 'answers', 'briefs'
  )
);

create trigger briefs_history after insert or update or delete on goals.briefs
  for each row execute function goals.record_history();
