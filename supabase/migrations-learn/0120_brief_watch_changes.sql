-- What a source found by a brief's weekly check changes (plan #2023.8;
-- feature #2023).
--
-- Once a week, for a brief with its watch switch on, the daily cron searches
-- for anything published on the topic since the last check. Each new source
-- goes on the brief's reading list like the first run's, and this column
-- holds the line the check wrote on what it changes in the brief's answer.
--
-- A reading with found_change set is one a check found, not the first run:
-- the brief page lists those under what is new since you asked, and while
-- the reading is still queued it and its Learn now card are marked new.

set search_path = learn, public, extensions;

alter table learn.readings
  add column if not exists found_change text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'readings_found_change_len') then
    alter table learn.readings
      add constraint readings_found_change_len
      check (found_change is null or length(found_change) <= 600);
  end if;
end;
$$;

comment on column learn.readings.found_change is
  'Set on a source a brief''s weekly check found: one line on what it changes in the brief''s answer (plan #2023.8).';
