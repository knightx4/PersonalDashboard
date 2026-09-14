-- ---------------------------------------------------------------------------
-- 0009 -- whether a subscription is being drawn.
--
-- A calendar you subscribe to has two switches in it, and until now the table
-- only had one: added, or removed. Turning a noisy work calendar off for a
-- week meant deleting the subscription and pasting the address back in
-- afterwards, which is the kind of round trip nobody makes -- so the
-- appointments stayed on the page instead.
--
-- `shown` is the second switch. False hides everything that subscription
-- contributed, everywhere it is drawn -- the calendar and the agenda both --
-- while the address, the name and the appointments themselves stay exactly
-- where they are, so switching it back on costs one click and no re-reading.
--
-- Not null, default true: a subscription you have just added is one you want
-- to see, and an existing one is being drawn already.
-- ---------------------------------------------------------------------------

set search_path = todo, public, extensions;

alter table todo.calendar_feeds
  add column if not exists shown boolean not null default true;

comment on column todo.calendar_feeds.shown is
  'Whether this subscription is drawn. False hides its appointments from the '
  'calendar and the agenda without removing the subscription or its rows.';
