-- What each followed company's job board showed, read daily (plan #2535.3).
--
-- Followed boards used to be read once a week, 80 at most, inside the roles
-- search. Now every followed board is read once a day, a few at a time on the
-- ten-minute batch cron (lib/jobs/suggest/board-watch.ts), and each posting
-- it showed is kept here, so the next read can tell what is new and what has
-- been taken down.
--
--   company_id     the followed company whose board it is on
--   posting_key    the posting's link, normalised (board-watch.ts postingKey);
--                  unique per company
--   title, url, location   as the board last showed them
--   first_seen_at  the read that first showed it
--   last_seen_at   the latest read that showed it
--   gone_at        the first read that no longer showed it; cleared if it
--                  comes back
--   offered_at     when it went to a daily pick. A board's first read sets it
--                  on everything, so what was already up is recorded as seen
--                  and never suggested as new
--
-- companies.board_read_at is when the company's board last loaded, which is
-- what spreads the reads over the day and tells a first read from the rest.
-- profiles.boards_picked_at is when the daily pick last asked Dash, so it
-- runs at most once a day and only on days with new candidates.
--
-- Bookkeeping fetched from the boards, not something the person wrote: the
-- server writes it with the service role, and the person may only read it.

set search_path = job_search, extensions;

create table if not exists board_postings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  posting_key text not null,
  title text not null,
  url text not null,
  location text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  gone_at timestamptz,
  offered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_postings_company_key unique (company_id, posting_key)
);

create index if not exists board_postings_user_idx on board_postings (user_id);
create index if not exists board_postings_unoffered_idx
  on board_postings (user_id) where offered_at is null and gone_at is null;

create trigger board_postings_touch_updated_at before update on board_postings
  for each row execute function job_search.touch_updated_at();

create trigger board_postings_same_owner before insert or update on board_postings
  for each row execute function job_search.assert_parents_same_owner();

alter table board_postings enable row level security;

create policy board_postings_select on board_postings for select to authenticated
  using (user_id = (select auth.uid()));

grant select on board_postings to authenticated;
grant all on board_postings to service_role;
revoke all on board_postings from anon;

alter table companies add column if not exists board_read_at timestamptz;
alter table profiles add column if not exists boards_picked_at timestamptz;

notify pgrst, 'reload schema';
