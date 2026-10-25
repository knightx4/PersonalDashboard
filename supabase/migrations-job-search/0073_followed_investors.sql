-- Investors whose portfolio job boards the daily board read follows, and what
-- those boards showed (plan #2535.4).
--
-- A fund's portfolio board lists the open jobs at every company it backs,
-- most of them on Getro or Consider. Reading one finds roles at companies the
-- person has never put on file, so the postings are kept against the investor
-- rather than against a company: a company row is made only when the person
-- acts on a suggestion, as with the startups the weekly discovery finds.
--
-- followed_investors
--   name         the investor as the found-in line names it ("RRE Ventures")
--   host         'getro' or 'consider', the service the board runs on
--   token        what the reader needs to find the board: Getro's collection
--                id, or the board's own hostname on Consider
--                (lib/jobs/ats/portfolio.ts)
--   board_url    the board as a person would open it
--   company_id   the investor's own row on file, when there is one
--   read_at      when the board last loaded; null until its first read, which
--                records what was up as seen and suggests none of it
--   tried_at     when the read last tried it, loaded or not, so a board that
--                fails waits for the next day like the rest
--
-- portfolio_postings: one row per posting a board showed, keyed by its
-- normalised link (board-diff.ts postingKey) per investor. offered_at is set
-- when it went to a daily pick, or on the first read. A portfolio board is
-- read only back to its last read, since the big ones hold thousands of
-- postings, so there is no "taken down" here as there is for a company's
-- own board (board_postings.gone_at).
--
-- Both are bookkeeping the server writes with the service role; the person
-- may only read their own rows.

set search_path = job_search, extensions;

create table if not exists followed_investors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  host text not null check (host in ('getro', 'consider')),
  token text not null,
  board_url text,
  company_id uuid references companies (id) on delete set null,
  read_at timestamptz,
  tried_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followed_investors_board_key unique (user_id, host, token),
  constraint followed_investors_id_user_key unique (id, user_id)
);

create index if not exists followed_investors_due_idx
  on followed_investors (user_id, tried_at nulls first);

create trigger followed_investors_touch_updated_at before update on followed_investors
  for each row execute function job_search.touch_updated_at();

create trigger followed_investors_same_owner before insert or update on followed_investors
  for each row execute function job_search.assert_parents_same_owner();

alter table followed_investors enable row level security;

create policy followed_investors_select on followed_investors for select to authenticated
  using (user_id = (select auth.uid()));

grant select on followed_investors to authenticated;
grant all on followed_investors to service_role;
revoke all on followed_investors from anon;

create table if not exists portfolio_postings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  investor_id uuid not null,
  posting_key text not null,
  company_name text not null,
  title text not null,
  url text not null,
  location text,
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  offered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The owner comes with the investor, so a posting can never sit under
  -- somebody else's investor.
  constraint portfolio_postings_investor_fk foreign key (investor_id, user_id)
    references followed_investors (id, user_id) on delete cascade,
  constraint portfolio_postings_investor_key unique (investor_id, posting_key)
);

create index if not exists portfolio_postings_user_idx on portfolio_postings (user_id);
create index if not exists portfolio_postings_unoffered_idx
  on portfolio_postings (user_id) where offered_at is null;

create trigger portfolio_postings_touch_updated_at before update on portfolio_postings
  for each row execute function job_search.touch_updated_at();

alter table portfolio_postings enable row level security;

create policy portfolio_postings_select on portfolio_postings for select to authenticated
  using (user_id = (select auth.uid()));

grant select on portfolio_postings to authenticated;
grant all on portfolio_postings to service_role;
revoke all on portfolio_postings from anon;

notify pgrst, 'reload schema';
