-- Putting an idea aside without losing it.
--
-- Once a session can suggest an idea (0061), the list grows with things you
-- did not write and will not all want. Deleting one is the only move the page
-- had, and delete is the wrong one: the reason for saying no is usually timing,
-- and a suggestion deleted is a suggestion the next session can write again
-- with nothing to tell it not to.
--
-- `dismissed_at` is the softer move #340 chose: hidden from the list, kept in a
-- place you can find, and brought back by hand. Null while the idea is live, a
-- timestamp once it is put aside. A timestamp rather than a flag so the
-- dismissed view can say when.
--
-- The column is on every idea rather than only on suggestions: the same button
-- is worth having on one of your own, and a second table for the same fact
-- would be a join for one nullable column.

set search_path = public, extensions;

alter table ideas
  add column if not exists dismissed_at timestamptz;

-- The page reads the live list far more often than the dismissed one, and this
-- is the index that list uses.
create index if not exists ideas_user_live_created_idx
  on ideas (user_id, created_at desc)
  where dismissed_at is null;

comment on column ideas.dismissed_at is
  'When the idea was put aside. Null while it is live; hidden from the list and from a session while set.';
