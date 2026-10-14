-- The stage a research run is on (plan #2023.2; feature #2023).
--
-- learn.briefs.stage says which of the run's three calls is going while the
-- brief is researching: 'framing' (the question becoming sub-questions),
-- 'searching' (searching the web and reading pages) or 'writing' (the
-- positions and the short answer). Null once the brief is ready or failed.
-- The brief page (plan #2023.4) shows it, with the sub-questions written so
-- far, while the run is going.

set search_path = learn, public, extensions;

alter table learn.briefs
  add column if not exists stage text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'briefs_stage_check') then
    alter table learn.briefs
      add constraint briefs_stage_check
      check (stage is null or stage in ('framing', 'searching', 'writing'));
  end if;
end;
$$;

comment on column learn.briefs.stage is
  'While researching, which call the run is on: framing, searching or writing. Null otherwise (plan #2023.2).';
