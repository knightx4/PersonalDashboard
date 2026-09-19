-- A third kind of plan step: something only you can set up.
--
-- `kind` has meant one of two things since 0054: a `build` step, which closes
-- on a commit, and a `decision`, which closes on an answer. #595 adds the
-- third thing a row on the plan turns out to be -- a token to mint, an account
-- to open, a DNS record to add -- which today has nowhere to live. A session
-- that needs one blocks with `block_kind = 'outside'` (0081) and the want is
-- then a sentence on a stopped step rather than a row anybody can see, sort,
-- or click done on.
--
--   'build'    -- work. Closes on a commit.
--   'decision' -- a question put to the person. Closes on an answer.
--   'setup'    -- something only the person can supply. Closes when they have
--                 done it and said so.
--
-- A kind rather than a status, for the same reason `decision` is one: a setup
-- step moves through exactly the states a build step moves through --
-- not started, in progress, blocked, done -- and differs only in what closing
-- it means and in who may close it.
--
-- This migration widens the check and nothing else. No row becomes `setup`
-- here: the steps blocked on something outside today stay as they are, and
-- what reads the new value -- the health and waiting rules (#597), the plan
-- page and the dev tab (#598), the CLI (#600) -- comes after it. Widening a
-- check is not destructive and takes no backfill; every row that passed the
-- old constraint passes this one.

set search_path = public, extensions;

alter table plan_items drop constraint if exists plan_items_kind_ck;
alter table plan_items add constraint plan_items_kind_ck
  check (kind in ('build', 'decision', 'setup'));

comment on column plan_items.kind is
  'What closing the step means: ''build'' closes on a commit, ''decision'' on an answer from the person, ''setup'' on the person doing the thing only they can do. Defaults to ''build''.';
