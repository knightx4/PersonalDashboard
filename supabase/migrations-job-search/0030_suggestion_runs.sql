-- When each of Dash's searches last ran, per person.
--
-- The schedule (lib/jobs/suggest/cadence.ts) used to take the newest stored
-- suggestion as the last run. A run that found nothing stores nothing, so for
-- an account with little to search from it looked as if no run had happened,
-- and the daily cron paid for the same empty search every day. Recording the
-- run itself fixes that: an empty result waits out the full interval (three
-- days for people, a week for roles). It also tells an emptied list (the
-- person acted on or turned down everything the last run found, refilled
-- within the day) from an empty one (nothing was found, left alone).

set search_path = job_search, extensions;

alter table profiles add column if not exists people_searched_at timestamptz;
alter table profiles add column if not exists roles_searched_at timestamptz;
