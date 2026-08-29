-- Repair timezones that are not timezone names.
--
-- The settings field is free text and nothing validated it, so "ET" was
-- stored -- which is how a person writes a timezone and is not an IANA zone
-- name. Every page that formatted a date in the user's zone then threw
-- `RangeError: Invalid time zone specified` and returned a 500. It showed up on
-- the review queue first only because that page formats a date for every row.
--
-- The application now validates on write and falls back on read, so this is not
-- load-bearing. It exists so the stored value is actually right rather than
-- being corrected on every read forever: anything reading the column directly
-- would otherwise still see "ET".
--
-- Mapped to a region rather than a fixed offset so daylight saving applies.
-- Postgres knows these names, and the `is not null` test below is what proves
-- the replacement is one it will accept.

set search_path = job_search, extensions;

with repairs (typed, iana) as (
  values
    ('et', 'America/New_York'), ('est', 'America/New_York'),
    ('edt', 'America/New_York'), ('eastern', 'America/New_York'),
    ('ct', 'America/Chicago'), ('cst', 'America/Chicago'),
    ('cdt', 'America/Chicago'), ('central', 'America/Chicago'),
    ('mt', 'America/Denver'), ('mst', 'America/Denver'),
    ('mdt', 'America/Denver'), ('mountain', 'America/Denver'),
    ('pt', 'America/Los_Angeles'), ('pst', 'America/Los_Angeles'),
    ('pdt', 'America/Los_Angeles'), ('pacific', 'America/Los_Angeles'),
    ('gmt', 'Europe/London'), ('bst', 'Europe/London'),
    ('uk', 'Europe/London'), ('london', 'Europe/London'),
    ('cet', 'Europe/Paris'), ('cest', 'Europe/Paris'),
    ('ist', 'Asia/Kolkata'),
    ('aest', 'Australia/Sydney'), ('aedt', 'Australia/Sydney')
)
update profiles p
   set timezone = r.iana,
       updated_at = now()
  from repairs r
 where lower(btrim(p.timezone)) = r.typed
   -- Only rewrite a value the database itself cannot resolve. "Europe/London"
   -- is left alone; so is a legitimately stored zone that happens to collide.
   and to_regclass('pg_timezone_names') is not null
   and not exists (
     select 1 from pg_timezone_names n where n.name = p.timezone
   );

-- Anything still unusable becomes UTC rather than a 500. Narrow on purpose:
-- only values Postgres cannot resolve at all are touched.
update profiles
   set timezone = 'UTC',
       updated_at = now()
 where timezone is not null
   and timezone <> ''
   and not exists (
     select 1 from pg_timezone_names n where n.name = profiles.timezone
   );
