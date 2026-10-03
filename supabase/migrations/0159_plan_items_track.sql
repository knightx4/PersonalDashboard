-- Which order a feature is built in (plan #1511, docs/SPEC-LAYER-SPEC.md
-- Part 4).
--
-- A feature that replaces how something works is marked as an overhaul. The
-- overnight runner leaves an overhaul alone, and its own routine works it
-- instead. Every other row keeps the default, 'feature'. The column is read
-- on the feature at the top of a plan; a step beneath it inherits the track
-- from there rather than carrying its own.

alter table plan_items
  add column if not exists track text not null default 'feature';

alter table plan_items drop constraint if exists plan_items_track_ck;
alter table plan_items add constraint plan_items_track_ck
  check (track in ('feature', 'overhaul'));

comment on column plan_items.track is
  'feature or overhaul. An overhaul is skipped by the overnight runner and worked by its own routine.';
