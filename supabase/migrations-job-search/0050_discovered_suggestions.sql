-- Roles at discovered startups in the weekly suggestions (plan #1685,
-- feature #1679).
--
--   origin 'discovered'    a role on the board or Hacker News post of a startup
--                          on the watchlist (watchlist_startups, 0047). Up to
--                          ten a week, on top of the search's own.
--   watchlist_startup_id   the watchlist row the role came from, so saving it
--                          can point that row at the companies row it creates.
--
-- A new column on a table lib/jobs/sources.ts already lists, so the catalogue
-- does not change.

set search_path = job_search, extensions;

alter table suggestions
  add column if not exists watchlist_startup_id uuid references watchlist_startups (id) on delete set null;

create index if not exists suggestions_watchlist_startup_idx
  on suggestions (watchlist_startup_id) where watchlist_startup_id is not null;

alter table suggestions drop constraint if exists suggestions_origin_ck;
alter table suggestions add constraint suggestions_origin_ck
  check (origin in ('search', 'board', 'goal', 'discovered'));
