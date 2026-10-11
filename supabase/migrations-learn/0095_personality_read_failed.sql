-- When Dash's read of a personality result last failed (plan #1635, under #1630).
--
-- Saving a result asks Dash to read it against the person's notes once the
-- page has answered, and the Know page shows the read when it is there. A
-- failed call leaves the result saved, and the page has to be able to say the
-- read did not run rather than look as though it is still coming. This is the
-- mark it reads: the time of the last failed attempt, cleared when a read is
-- written. Null on a result whose read is waiting or done.
--
-- It may sit beside an earlier read: a fresh read asked for by the button that
-- fails keeps the old one and says the new one did not run.

set search_path = learn, public, extensions;

alter table learn.personality_results
  add column if not exists read_failed_at timestamptz;

comment on column learn.personality_results.read_failed_at is
  'When Dash''s last attempt to read this result against the notes failed; null once a read is written (plan #1635).';
