-- The startups the weekly discovery has found, kept apart from the person's
-- own companies page (plan #1680, feature #1679).
--
-- One row per company per person. A discovered company is not a companies
-- row: it shows only through its roles, and becomes a companies row when the
-- person saves one of them (company_id then points at it).
--
--   source          'yc' or 'hn': which list it was found on.
--   source_ref      the source's own id (YC slug, HN comment id), when it has one.
--   description     the source's own description of the company.
--   board_vendor    the job board vendor once found, with board_token; both null
--   board_token     until a link on the company's own site points at a board.
--   last_read_at    when its board was last read for openings.
--   empty_weeks     weeks in a row it showed nothing that fit.
--   board_checked_at when a board was last looked for, so a miss is not retried
--                   for four weeks.
--   company_id      the companies row it became, if any.
--
-- Bookkeeping, so listed in lib/jobs/sources.ts as not a source.

set search_path = job_search, extensions;

create table if not exists watchlist_startups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  name_key text not null,
  website text,
  source text not null,
  source_ref text,
  description text,
  reason text,
  stage text,
  locations text[] not null default '{}',
  board_vendor ats_type,
  board_token text,
  board_checked_at timestamptz,
  last_read_at timestamptz,
  empty_weeks integer not null default 0,
  company_id uuid references companies (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watchlist_startups_source_ck check (source in ('yc', 'hn')),
  constraint watchlist_startups_empty_weeks_ck check (empty_weeks >= 0),
  constraint watchlist_startups_board_pair_ck
    check ((board_vendor is null) = (board_token is null)),
  constraint watchlist_startups_user_name_uk unique (user_id, name_key)
);

create index if not exists watchlist_startups_user_seen_idx
  on watchlist_startups (user_id, last_seen_at desc);
create index if not exists watchlist_startups_company_idx
  on watchlist_startups (company_id) where company_id is not null;

create trigger watchlist_startups_touch_updated_at
  before update on watchlist_startups
  for each row execute function job_search.touch_updated_at();

alter table watchlist_startups enable row level security;

create policy watchlist_startups_select on watchlist_startups for select to authenticated
  using (user_id = (select auth.uid()));
create policy watchlist_startups_insert on watchlist_startups for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy watchlist_startups_update on watchlist_startups for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy watchlist_startups_delete on watchlist_startups for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on watchlist_startups to authenticated;
grant all on watchlist_startups to service_role;
revoke all on watchlist_startups from anon;
