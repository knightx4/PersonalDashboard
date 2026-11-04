-- ===========================================================================
-- Hours logged as a metric, and an aim given as a range.
--
-- The owner wants to average two to three hours a weekday on applying,
-- cleaning and AI training work, logged by a sentence in the capture box
-- ("applied 2h, cleaned 1.5h"). Capture already keeps each of those as a
-- progress entry with a quantity and a unit (0063). A metric (0078, 0085)
-- counted things; this lets one add up time instead:
--
--   metrics.source        hours  the progress entries on the goal and every
--                                step under it whose unit is a unit of time,
--                                added up in hours, in the period of their
--                                happened_on. Minutes count as a sixtieth.
--
--   metrics.target_high   the top of the aim, when the aim is a range: an
--                         aim of 10 with a target_high of 15 reads "aim
--                         10 to 15 a week". Any metric may have one, and
--                         only above its target.
--
-- The sums are worked out in lib/goals/metrics.ts, as the counts are, and
-- never stored. No existing row is changed by this file.
-- ===========================================================================

alter table goals.metrics drop constraint metrics_source_ck;
alter table goals.metrics add constraint metrics_source_ck
  check (source in ('list', 'steps', 'files', 'hours'));

alter table goals.metrics
  add column target_high integer,
  add constraint metrics_target_high_ck check (
    target_high is null
    or (target is not null and target_high > target and target_high <= 100000)
  );

comment on column goals.metrics.target_high is
  'The top of the aim when it is a range, above target (goals 0089). Null for a single aim.';

notify pgrst, 'reload schema';
