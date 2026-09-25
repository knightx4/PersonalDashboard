-- ===========================================================================
-- What Claude did since your last visit (plan #1010).
--
-- The Goals home opens with a short list of the runs that ended since you
-- last looked: steps worked, goals mapped, facts filed, and runs that failed
-- and why (docs/GOALS-SPEC.md, "Since your last visit"). The list is gone once
-- read, which needs the visit before this one.
--
-- goals.visits.last_visit_at moves on every page load, and the home reloads
-- itself after a press on it (a suggestion's going or not for me revalidates
-- the page). Reading "since last_visit_at" would empty the list on the first
-- press. So a visit belongs to a sitting, and a sitting is page loads less
-- than thirty minutes apart:
--
--   visits.previous_visit_at  the last visit before this sitting began; the
--                             list reads runs that ended after it. Null
--                             until a second sitting, so a first visit shows
--                             no list.
--
-- The rule is nextVisit() in lib/goals/catch-up.ts. No history trigger, for
-- the reason 0027 gives.
-- ===========================================================================

alter table goals.visits add column previous_visit_at timestamptz;

comment on column goals.visits.previous_visit_at is
  'The last visit before this sitting (page loads under thirty minutes apart). The Goals home lists the runs that ended after it (plan #1010).';

notify pgrst, 'reload schema';
