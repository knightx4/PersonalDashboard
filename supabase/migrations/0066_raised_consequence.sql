-- What answering a raise will do.
--
-- A raise asks for a yes or a no and nothing says what either one causes. On
-- 13 September a raise proposed refusing a second session on a step already
-- being worked, the answer was yes, the row closed, and no code changed and no
-- step was written: the yes went into a thread that nothing reads back.
--
-- `consequence` is the action a yes takes, named by the session that files the
-- raise and stored in the same shape lib/comments/act.ts already carries out
-- for a comment -- a name from its fixed list and the arguments that go with
-- it. The page shows it under the ask, so the answer is given knowing what it
-- causes, and #365 runs it without a model call because it was named when the
-- raise was written.
--
-- jsonb rather than text because it is executed rather than read: a sentence
-- would need a model call to turn back into an action, which is the thing this
-- column exists to avoid.
--
-- The check is the shape and not the list of names. Which names are allowed is
-- lib/comments/reply-payload.ts, the same as `module` being text with no
-- foreign key because the list that matters is lib/modules.ts; a name outside
-- the list is refused where it is written and again where it is run, and a
-- constraint here would mean a migration every time the list grows.
--
-- Nullable, because the raises already filed have none and are not worth
-- losing over a column added after them. Everything written from here carries
-- one: `scripts/plan.ts raise` requires `--consequence`.

set search_path = public, extensions;

alter table raised_items
  add column if not exists consequence jsonb;

alter table raised_items
  drop constraint if exists raised_items_consequence_shape_ck;
alter table raised_items
  add constraint raised_items_consequence_shape_ck
  check (
    consequence is null
    or (
      jsonb_typeof(consequence) = 'object'
      and jsonb_typeof(consequence -> 'name') = 'string'
      and length(btrim(consequence ->> 'name')) > 0
      and length(consequence::text) <= 4000
    )
  );

comment on column raised_items.consequence is
  'The action a yes takes, in the shape lib/comments/act.ts carries out: {name, text, module, field}.';
