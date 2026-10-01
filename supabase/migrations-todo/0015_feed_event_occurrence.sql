-- Which date of a repeating subscribed appointment a copied row is
-- (plan #1372, under #1371).
--
-- A calendar file gives every date of a weekly meeting the same UID, and marks
-- a date that was moved with the start it originally had (RECURRENCE-ID).
-- todo.feed_events held only the UID and the current start, so a Tuesday moved
-- to Wednesday could not be told apart from a new Wednesday. The rows are
-- deleted and rewritten on every refresh, so anything that points at one date
-- of a meeting (a task linked to it, #1373) has to find it again by
-- (feed_id, uid, occurrence) rather than by id.
--
-- occurrence is the original start, written the way the row's own start is:
-- 'YYYY-MM-DD' for a whole-day appointment, an ISO instant in UTC
-- ('2026-03-23T09:30:00.000Z') for a timed one. Text rather than a date so a
-- meeting that repeats more than once a day still has one value per date, and
-- so a whole-day repeat is not given a time it never had. Null for an
-- appointment that does not repeat.
--
-- Existing rows stay null until their calendar's next refresh rewrites them,
-- which happens once a calendar is an hour old (STALE_MS in
-- lib/todo/feeds/refresh.ts). Not a new table, so the sources
-- catalogue (lib/todo/sources.ts) is unchanged.

set search_path = todo, public, extensions;

alter table todo.feed_events
  add column if not exists occurrence text;

alter table todo.feed_events
  drop constraint if exists feed_events_occurrence_ck;
alter table todo.feed_events
  add constraint feed_events_occurrence_ck
  check (occurrence is null or (btrim(occurrence) <> '' and length(occurrence) <= 40));

comment on column todo.feed_events.occurrence is
  'For a repeating appointment, the start this date originally had (the '
  'RECURRENCE-ID): YYYY-MM-DD when whole-day, an ISO UTC instant when timed. '
  'Kept when the date is moved. Null for an appointment that does not repeat.';

create index if not exists feed_events_feed_uid_occurrence_idx
  on todo.feed_events (feed_id, uid, occurrence);
