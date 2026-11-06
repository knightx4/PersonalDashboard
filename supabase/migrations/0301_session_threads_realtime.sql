-- Session threads update live on the Dash screen (plan #2789.12).
--
-- The thread screen and the Dash tab's list subscribe over Realtime to
-- core.session_messages (each reply, question, mockup and status line, and
-- an answer), core.session_threads (the thread's state) and
-- core.session_progress (each progress report). session_progress joined the
-- supabase_realtime publication in 0289; the two thread tables were added on
-- the live project by hand and are written down here, so a database built
-- from the migrations has them too. Realtime reads each event through RLS,
-- whose policies already keep each account to its own rows.
--
-- Schema only: no account's rows are read or changed. The local test
-- database has no publication, so each table is added only where Supabase
-- made one and only when it is not there yet.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['session_threads', 'session_messages', 'session_progress'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'core' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table core.%I', t);
    end if;
  end loop;
end;
$$;
