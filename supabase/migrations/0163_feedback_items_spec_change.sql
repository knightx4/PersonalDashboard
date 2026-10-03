-- Which proposed rule a note is waiting on (plan #1526,
-- docs/SPEC-LAYER-SPEC.md part 5).
--
-- When three or more notes on different pages ask for the same thing, the
-- notes routine drafts one spec change adding a rule for the whole app,
-- instead of fixing each page. The notes are linked to that change here, so
-- the routine can find them again: it closes them with a reply naming the rule
-- once the change is applied, and puts them back in the queue to be fixed on
-- their pages if the person declines it.
--
-- One column on the note rather than a list on the change: a note waits on at
-- most one rule, and both questions the routine asks ("which notes wait on
-- this change", "which change is this note waiting on") read it directly.
-- Null for every note that is not waiting on a rule.

alter table public.feedback_items
  add column if not exists spec_change_id uuid
  references public.spec_changes (id) on delete set null;

create index if not exists feedback_items_spec_change_idx
  on public.feedback_items (spec_change_id)
  where spec_change_id is not null;

comment on column public.feedback_items.spec_change_id is
  'The spec change proposing a rule that covers this note, set by the notes routine when three or more notes on different pages ask for the same thing (plan #1526).';
