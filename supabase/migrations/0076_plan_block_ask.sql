-- What a blocked step needs, in one sentence.
--
-- `plan.ts block <n> --note` appends a dated paragraph to `comment`, so a step
-- blocked four times carries four of them. The history is worth keeping: each
-- paragraph says what was true when it was written, and #499's four are the
-- record of a credential being asked for, supplied in the wrong form, and
-- asked for again. What that column cannot do is say what the step needs now.
-- Dash and the plan row both had to guess at it, both the same way -- read the
-- last paragraph that opens with a date -- and on #499 that guess is four
-- sentences long on a row with space for one.
--
-- So the ask gets its own column, the way a raise already has one. `block`
-- writes it and rewrites it, while the dated line still goes into `comment`.
-- Cleared when the step stops being blocked: a sentence saying what is needed
-- is a claim about work that has stopped, and it stops being true the moment
-- the step moves.
--
-- Nothing is backfilled. A row blocked before this column existed keeps its
-- ask where it was written, and `latestBlockNote` in lib/plan/waiting.ts is
-- still read when the column is null.

set search_path = public, extensions;

alter table plan_items
  add column if not exists block_ask text;

comment on column plan_items.block_ask is
  'What a blocked step needs, in one sentence. Rewritten each time it is blocked, and cleared when the step is no longer blocked. The dated history stays in comment.';
