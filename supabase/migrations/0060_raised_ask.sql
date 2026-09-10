-- The one thing a raise wants back from you.
--
-- A raise today is a title and a paragraph of what a session ran into, and
-- reading one leaves you with the story but not the move: "the things in
-- raised should have an actual question, action, or choice for me. I dont
-- know what these are asking really." The narrative is the evidence, not the
-- ask, and a page of evidence is a page nobody can clear.
--
-- `ask` is that move, written by the session as one sentence you can answer in
-- one line -- a question with a recommendation, an action to approve, or a
-- choice between named options. It is separate from `detail` rather than the
-- first line of it, because the page shows it apart from the story and the
-- CLI refuses a raise without one.
--
-- Nullable, because the rows already filed have no ask and a raise is not
-- worth losing over a column added after it. Everything written from here
-- carries one: `scripts/plan.ts raise` requires `--ask`.

set search_path = public, extensions;

alter table raised_items
  add column if not exists ask text;

alter table raised_items
  drop constraint if exists raised_items_ask_length_ck;
alter table raised_items
  add constraint raised_items_ask_length_ck
  check (ask is null or length(ask) <= 500);

alter table raised_items
  drop constraint if exists raised_items_ask_not_blank_ck;
alter table raised_items
  add constraint raised_items_ask_not_blank_ck
  check (ask is null or length(btrim(ask)) > 0);

comment on column raised_items.ask is
  'The question, action or choice put to the user -- one sentence they can answer in one line.';
