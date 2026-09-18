-- ---------------------------------------------------------------------------
-- 0008 -- who is reading this subscription right now.
--
-- Plan #277 settled that a subscribed calendar is re-read when you open the
-- calendar page and the copy is more than an hour old. That means the refresh
-- runs from a page render, and two tabs opened together would otherwise fetch
-- the same address twice and write the same rows over each other.
--
-- So a claim: a reader stamps this column, does the work, and clears it. A
-- stamp older than the longest a read can take is a reader that died holding
-- it, and is taken over rather than blocking the subscription forever.
--
-- Not a lock table and not an advisory lock: the thing being claimed is one
-- row, the claim is taken by the same conditional update that reads it, and a
-- column is the whole of that.
-- ---------------------------------------------------------------------------

set search_path = todo, public, extensions;

alter table todo.calendar_feeds
  add column if not exists refreshing_since timestamptz;

comment on column todo.calendar_feeds.refreshing_since is
  'When a reader claimed this subscription, or null. Cleared when the read '
  'finishes; a stamp older than a few minutes is taken over.';
