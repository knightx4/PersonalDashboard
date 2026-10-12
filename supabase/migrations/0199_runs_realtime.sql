-- plan #1826: a run's page follows the run without reloading.
--
-- core.run_activities joined the supabase_realtime publication in 0197, so a
-- run's page hears each line as it is written. The run rows themselves join
-- here, so the same pages hear a run change state (finished, failed, waiting
-- on you, gone quiet) and the goal pages no longer poll every 15 seconds to
-- find out. Realtime reads each event through the subscriber's own RLS, and
-- both tables are owner-only already.
--
-- The local test database has no publication, and goals.runs comes from
-- supabase/migrations-goals, so each table is added only where both exist.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plan_runs'
    ) then
      alter publication supabase_realtime add table public.plan_runs;
    end if;
    if to_regclass('goals.runs') is not null and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'goals' and tablename = 'runs'
    ) then
      alter publication supabase_realtime add table goals.runs;
    end if;
  end if;
end;
$$;
