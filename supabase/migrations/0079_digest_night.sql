-- What the overnight runner did, on the morning summary that reports it.
--
-- The runner (0077) fires one feature at a time all night and writes almost
-- nothing down: one row saying what it is doing, and a `plan_runs` row per
-- press. By breakfast the answer to "what happened while I was asleep" is
-- spread across three tables, and the first thing you want is the thing you
-- went to bed wondering about -- which features it worked, what closed, what
-- it left stopped on you, and why it stopped.
--
-- Stored rather than computed, for the reason the rest of this row is stored:
-- the summary is written once a day and read all day, and a night rebuilt on
-- every page load would change under the reader as the next night starts. It
-- also has to survive the row it was read from. `plan_overnight_runs` holds
-- one row per account rather than one per night, so the night reported here is
-- overwritten the moment the next button is pressed; without a copy on the
-- day's summary, Tuesday's report would silently become Wednesday's.
--
-- One jsonb object rather than columns or a child table, the same as
-- `happened` and `attention` beside it: nothing queries inside it, nothing
-- links to it, and the row is a rendering rather than a record. lib/digest/
-- night.ts writes it and lib/digest/load.ts reads it back defensively, so an
-- older deploy's shape costs a missing block rather than the page.
--
-- Nullable, and null is the ordinary case: most days have no night, and every
-- summary written before this column existed has none.

set search_path = public, extensions;

alter table dev_digests
  add column if not exists night jsonb;

-- An object or nothing. An array here would be a list of nights, which this
-- is not: the summary covers one, the one that was running or had just ended.
alter table dev_digests
  drop constraint if exists dev_digests_night_object_ck;
alter table dev_digests
  add constraint dev_digests_night_object_ck
  check (night is null or jsonb_typeof(night) = 'object');

comment on column dev_digests.night is
  'What the overnight runner did in the window this summary covers: the features it fired, the steps that closed, the steps left blocked, and the sentence saying why it stopped. Null on a day with no night, and on every row written before the column existed.';
