-- ===========================================================================
-- Job applications sent as a metric (plan #2908.1).
--
-- A metric (0078, 0085, 0089) counted a list's records, the goal's closed
-- steps, Dash's files or the hours logged. This lets one count the job
-- applications the person sent instead:
--
--   metrics.source   applications   every application of the metric's owner
--                                   with a submitted_at, in the period of the
--                                   day it was sent in the account's zone.
--                                   A withdrawn application is left out.
--
-- Like the steps, files and hours kinds it has no list and no date field,
-- which metrics_source_list_ck already holds for any source but list. The
-- counts are worked out in lib/goals/metrics.ts, not stored. No existing row
-- is changed by this file.
-- ===========================================================================

alter table goals.metrics drop constraint metrics_source_ck;
alter table goals.metrics add constraint metrics_source_ck
  check (source in ('list', 'steps', 'files', 'hours', 'applications'));

notify pgrst, 'reload schema';
