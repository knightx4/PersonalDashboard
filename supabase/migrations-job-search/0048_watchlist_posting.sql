-- What a shortlisted startup's hiring post said (plan #1682, feature #1679).
--
-- Dash's weekly shortlist reads each Hacker News post for the company, the
-- roles it names, where they are and the link it gives. The roles and the
-- link are kept here so finding the board (plan #1683) can start from the
-- link and suggesting roles (plan #1685) knows what the post offered.
--
--   posting_roles     the roles the post names, as written; empty for a YC-only find.
--   posting_location  where the post says the roles are, as written.
--   posting_url       the careers or apply link the post gives, when it gives one.

set search_path = job_search, extensions;

alter table watchlist_startups
  add column if not exists posting_roles text[] not null default '{}',
  add column if not exists posting_location text,
  add column if not exists posting_url text;
