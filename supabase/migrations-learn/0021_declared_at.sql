-- The day you said you already knew a claim.
--
-- Waving an applied case through writes `state = 'known'` with
-- `established = 'declared'` and no date at all, because `tested_at` means
-- "last actually answered about" and a wave-through answers nothing. That is
-- still right, and it is also why a waved-through claim can never come back:
-- the re-check schedule in lib/learn/graph/recheck.ts orders by `tested_at`
-- and passes over a row that has none, so a claim settled on your word drops
-- out of the rotation for good. Plan #650 wants it back after the same wait a
-- tested claim takes, and that needs a date of its own.
--
-- `updated_at` is not that date. It moves on any later write to the row, so a
-- claim declared in March and touched by something unrelated in June would
-- read as declared in June.
--
-- One date or the other, never both. Which of the two is set is the claim the
-- row makes about where its date came from, and a row carrying both would be
-- saying that a claim you were tested on is also a claim nobody has checked.
-- The writes keep it that way: the two declare paths in lib/learn/graph/save.ts
-- set `declared_at` and null `tested_at`, and every path that writes a real
-- `tested_at` -- `settleConcept` and `setMisconception` in
-- lib/learn/graph/session.ts, `seedFromSweep` in lib/learn/graph/opening.ts --
-- nulls `declared_at` in the same upsert.
--
-- Nothing to backfill: the table is empty, and a row written before this would
-- have been declared on a day nobody recorded.

set search_path = learn, public, extensions;

alter table learn.concept_state
  add column if not exists declared_at timestamptz;

comment on column learn.concept_state.declared_at is
  'When you said you already knew this, without being asked. Null on a claim '
  'you never declared. Never set alongside tested_at: a claim carries the date '
  'it was answered about or the date you declared it, and not both.';

alter table learn.concept_state
  add constraint concept_state_one_date_ck check (
    declared_at is null or tested_at is null
  );
