-- What the LinkedIn import needs to bring in followed companies and job
-- preferences (plan #2432.6).
--
-- job_search.watchlist_startups.source gains 'linkedin': a company the person
-- follows on LinkedIn and does not track goes on the startup watchlist, beside
-- the ones discovery found on YC and Hacker News.
--
-- job_search.profiles gains user_id, always equal to id. The import engine and
-- core.import_apply find a person's rows by user_id; the profile is keyed by
-- id alone, so without this the preferences could not be filled through them.
-- It is generated, so nothing ever writes it and it cannot disagree with id.
--
-- Schema only: no rows are changed.

alter table job_search.watchlist_startups
  drop constraint if exists watchlist_startups_source_ck;
alter table job_search.watchlist_startups
  add constraint watchlist_startups_source_ck check (source in ('yc', 'hn', 'linkedin'));

alter table job_search.profiles
  add column if not exists user_id uuid generated always as (id) stored;

comment on column job_search.profiles.user_id is
  'Always id: lets the import engine find the profile by user_id like every other row (plan #2432.6).';
