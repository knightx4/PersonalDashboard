-- Which of two things a blocked step is waiting for.
--
-- #525 settled this: a step blocked on the steps it names clears itself when
-- they close, and a step blocked on something outside the plan stays blocked
-- until somebody says otherwise. `isStaleBlock` in lib/plan/tree.ts cannot
-- tell the two apart today, so it clears both -- #499 read as not started and
-- the Send button accepted it while its block was about a GitHub token nobody
-- had made. Nothing recorded said which kind of block it was.
--
-- Two values, and no more, because there are two answers to "who clears this":
--
--   'steps'   -- the steps it names. They are rows in plan_dependencies, they
--                close on their own, and the block goes with them.
--   'outside' -- a key, an account, an answer, a DNS record. No amount of
--                other work on the plan produces it.
--
-- Null when the step is not blocked, and cleared on the way out the same way
-- `block_ask` is (0076): a sentence saying what a step needs and a word saying
-- who can supply it are both claims about work that has stopped, and they stop
-- being true the moment the step moves. The check does not insist on that
-- direction -- a leftover word on a step nobody is waiting for is untidy, not
-- wrong -- but it does insist on the one that matters: a row cannot say
-- `blocked` without saying which kind.
--
-- Backfilled before the check goes on, so the two rows blocked today pass it.
-- Both are 'outside' and neither has a dependency row: #433 wants Mailgun's
-- DNS records and two Vercel variables, #578 wants three migrations applied
-- and two Vault secrets. #494 and #499 are in the step's detail and in #525
-- as the rows this was written for; neither is blocked any more -- #494 went
-- back to not started and #499 is built -- so the backfill goes by status
-- rather than by number.

set search_path = public, extensions;

alter table plan_items
  add column if not exists block_kind text;

comment on column plan_items.block_kind is
  'Which kind of block a blocked step is carrying: ''steps'' clears itself when the steps it names close, ''outside'' waits for something only the person can supply. Null when the step is not blocked. Required whenever status is blocked.';

update plan_items
set block_kind = 'outside'
where status = 'blocked' and block_kind is null;

alter table plan_items drop constraint if exists plan_items_block_kind_ck;
alter table plan_items add constraint plan_items_block_kind_ck
  check (block_kind is null or block_kind in ('steps', 'outside'));

alter table plan_items drop constraint if exists plan_items_blocked_has_kind_ck;
alter table plan_items add constraint plan_items_blocked_has_kind_ck
  check (status <> 'blocked' or block_kind is not null);
