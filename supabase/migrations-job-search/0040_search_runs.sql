-- One row per run of Dash's recommended roles and people searches, so the
-- page can say what a search is doing and how the last one ended.
--
-- Search now used to do the whole search inside the button's request. Once
-- the run also read the followed boards and every posting, one press ran past
-- the route's five minutes and was cut off: nothing saved, no error, and the
-- button said "Searching…" until the page was reloaded. The search now runs
-- after the response (next/server `after`), writes its stage here as it goes,
-- and the section reads the latest row.
--
--   kind         'apply' (roles) or 'reach_out' (people), as suggestions.kind.
--   trigger      'button' (Search now) or 'daily' (the cron).
--   stage        where it is: boards, searching, saving, postings, scoring,
--                then done or failed. A row still short of done or failed
--                long after it started was cut off by the platform, and the
--                page says so (lib/jobs/suggest/search-runs.ts).
--   written      how many suggestions it stored.
--   boards_read  followed boards read, and candidates the ones passed on.
--   error        why it failed, in words the page can show.
--
-- Bookkeeping, so listed in lib/jobs/sources.ts as not a source.

set search_path = job_search, extensions;

create table if not exists search_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  trigger text not null,
  stage text not null default 'boards',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  written integer not null default 0,
  boards_read integer not null default 0,
  candidates integer not null default 0,
  error text,
  constraint search_runs_kind_ck check (kind in ('reach_out', 'apply')),
  constraint search_runs_trigger_ck check (trigger in ('button', 'daily')),
  constraint search_runs_stage_ck check
    (stage in ('boards', 'searching', 'saving', 'postings', 'scoring', 'done', 'failed')),
  constraint search_runs_error_length_ck check (error is null or length(error) <= 1000)
);

create index if not exists search_runs_user_kind_idx
  on search_runs (user_id, kind, started_at desc);

alter table search_runs enable row level security;

drop policy if exists search_runs_select on search_runs;
create policy search_runs_select on search_runs for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists search_runs_insert on search_runs;
create policy search_runs_insert on search_runs for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists search_runs_update on search_runs;
create policy search_runs_update on search_runs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on search_runs to authenticated;
grant all on search_runs to service_role;
revoke all on search_runs from anon;
