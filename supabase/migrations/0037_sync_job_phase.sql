-- Say what a mailbox check is doing while it is doing it.
--
-- A check writes its counters once, when it finishes. Until then the row reads
-- zero of nothing, so Check now could say "Started" and then, minutes later,
-- nothing at all -- the run ends and the button goes quiet. That is the whole
-- of the feedback a run gives, and it is why it reads as broken on a mailbox
-- that takes a while.
--
-- Two columns are what a bar needs: how many messages this run found to look
-- at, and which of the things it does it is on right now.

alter table core.sync_jobs
  add column phase text,
  add column messages_total integer;

comment on column core.sync_jobs.phase is
  'listing | reading | linking | done. Read by lib/core/inbox/progress.ts.';

comment on column core.sync_jobs.messages_total is
  'Messages this run found to look at, once the list step knows. Null before that, and on a backfill, whose pages each find their own.';
