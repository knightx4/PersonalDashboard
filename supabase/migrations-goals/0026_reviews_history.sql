-- ===========================================================================
-- The weekly verdicts go in the history like every other goals table
-- (plan #1018).
--
-- 0025 made goals.reviews without the history trigger that every other table
-- in the schema carries (0001, "history"). With it, each verdict the weekly
-- run writes is recorded as Claude's and tied to the run, so the run's page
-- lists it among the run's changes.
-- ===========================================================================

alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions', 'collections', 'collection_goals', 'records', 'comments', 'dependencies',
    'reviews'
  )
);

create trigger reviews_history after insert or update or delete on goals.reviews
  for each row execute function goals.record_history();
