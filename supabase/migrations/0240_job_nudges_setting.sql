-- Whether the Jobs Inbox lists the nudges (plan #1937.14): a debrief owed
-- on a round that has ended, and a round coming up with no prep. Off by
-- default, because the note of 18 September asked for them to go.
alter table job_search.profiles
  add column if not exists show_nudges boolean not null default false;

comment on column job_search.profiles.show_nudges is
  'Whether the Jobs Inbox lists debriefs owed and rounds with no prep. Set on /jobs/settings.';
