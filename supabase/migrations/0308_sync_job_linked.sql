-- What each workspace made of a mail sync (plan #3019).
--
-- The account menu's Check mail section says, per workspace, what the last
-- check found: "Jobs: 2 new, 1 linked to a role". A sync is one pass over the
-- mailbox that offers every message to each workspace's linker, and until now
-- the linkers' counts lived only in memory for the length of a batch. This
-- column keeps them on the job, added up over the job's batches, keyed by the
-- linker's domain:
--
--   { "jobs": { "claimed": 2, "linked": 1, "failed": 0, "errors": 0 }, ... }
--
--   claimed  messages the workspace took as its own in this job
--   linked   records it created or updated (orders, applications, bills)
--   failed   messages it took but could not read
--   errors   batches in which the linker threw
--
-- Schema change only: no account's rows are written. Existing jobs read as
-- '{}', which the menu shows as no result for that job.

set search_path = core, public, extensions;

alter table core.sync_jobs
  add column if not exists linked jsonb not null default '{}'::jsonb;

comment on column core.sync_jobs.linked is
  'Per linker domain, what the workspace made of this job''s messages: claimed, linked, failed, errors. Added up over the job''s batches (plan #3019).';
