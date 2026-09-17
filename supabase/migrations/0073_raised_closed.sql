-- A raise you are finished with, so `answered` stops being the end of the row.
--
-- 0057 gave a raise three states: open, answered and dismissed. Answering is
-- the person replying, which is not the same as being finished -- a yes that
-- files an idea leaves work behind it, and the reply a session owes on an
-- answer is written days later. So every row on the account sits at answered
-- and reads "Answered" for as long as it exists, and the only way off that
-- state is a dismissal, which says the raise did not need asking.
--
-- `closed` is the state past answered: you have read what came of it and want
-- the row filed. It is not dismissed, which closes a raise without saying
-- anything and leaves `answered_at` null, and it is not a second way of
-- answering -- app/dev/raised/actions.ts only offers it on a raise that is
-- already answered and carries an outcome, so the #367 rule that a raise
-- closes on what it produced still holds.
--
-- No backfill. Which of the answered rows the person is finished with is
-- theirs to say, one press each on /dev/raised, and a migration guessing it
-- would close the two that are still waiting on a reply.

set search_path = public, extensions;

alter table raised_items drop constraint if exists raised_items_status_ck;
alter table raised_items add constraint raised_items_status_ck
  check (status in ('open', 'answered', 'closed', 'dismissed'));

comment on column raised_items.status is
  'open while it waits on you, answered once you have replied, closed once you are finished with it, dismissed if it did not need asking.';
