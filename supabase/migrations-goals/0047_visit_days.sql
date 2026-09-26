-- ===========================================================================
-- The days you opened Goals (plan #1079).
--
-- The bottom of the home counts the days you visited this week. goals.visits
-- keeps one row per person with the latest visit and the one before this
-- sitting (0027, 0030), which cannot say how many days of a week had a visit.
-- So the row also keeps the days themselves:
--
--   visits.visit_days  each day (YYYY-MM-DD, the account's zone) the home was
--                      opened, oldest first, trimmed to the last 28 days by
--                      recordVisit in lib/goals/visits-store.ts
--
-- The existing row is seeded with the days of its last visit and of the visit
-- before its sitting, in the account's zone, so this week does not start
-- from nothing. Still no history trigger, for the reason 0027 gives.
-- ===========================================================================

alter table goals.visits add column visit_days date[] not null default '{}';

update goals.visits v
set visit_days = array(
  select distinct d
  from unnest(array[
    (v.last_visit_at at time zone coalesce(p.timezone, 'UTC'))::date,
    (v.previous_visit_at at time zone coalesce(p.timezone, 'UTC'))::date
  ]) as d
  where d is not null
  order by d
)
from (select v2.user_id, s.timezone
      from goals.visits v2
      left join core.account_settings s on s.user_id = v2.user_id) p
where p.user_id = v.user_id;

comment on column goals.visits.visit_days is
  'Each day the Goals home was opened, in the account''s zone, oldest first and kept to the last 28 days. The home counts this week''s (plan #1079).';

notify pgrst, 'reload schema';
