-- What closing a raise produced.
--
-- The #342 raise was answered yes and closed, and for a day it read as handled
-- while the collision it described was still possible: the yes went into the
-- thread and nothing came out of it. A raise that reaches `answered` has to
-- have either done something or recorded that the answer meant no action and
-- why, and there was no column that could say which.
--
-- `outcome` is that record: what the action did, or the reason there was none.
-- It is written where the raise is closed -- answering yes stores what
-- lib/comments/act.ts reported, answering no stores the reason -- so a row that
-- reached `answered` with nothing in this column is one that closed into
-- nothing.
--
-- Not a check constraint saying `answered` implies an outcome. The rows that
-- made this rule are already answered with none, and a constraint would either
-- refuse to apply or have to pretend they produced something. They read as
-- waiting on their own follow-through instead, which is what /dev/raised shows
-- them as, and the rule is held where the closing happens.
--
-- Nullable, and null on a dismissal: dismissing is closing a raise without
-- saying anything, which is a different thing and still allowed.

set search_path = public, extensions;

alter table raised_items
  add column if not exists outcome text;

alter table raised_items
  drop constraint if exists raised_items_outcome_length_ck;
alter table raised_items
  add constraint raised_items_outcome_length_ck
  check (outcome is null or length(outcome) <= 4000);

alter table raised_items
  drop constraint if exists raised_items_outcome_not_blank_ck;
alter table raised_items
  add constraint raised_items_outcome_not_blank_ck
  check (outcome is null or length(btrim(outcome)) > 0);

comment on column raised_items.outcome is
  'What closing it produced: what the action did, or the reason there was none. Null means it closed into nothing.';
