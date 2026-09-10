-- ---------------------------------------------------------------------------
-- 0005 -- events: the things that happen to you, as opposed to the things you
-- have to do.
--
-- The calendar has until now drawn only what other parts of the app already
-- knew about: a task with a date on it, a job interview, a return deadline.
-- None of them can be typed straight onto the page, and an appointment is not
-- any of them.
--
-- An event is not a task and must never become one. A task has a status, gets
-- ticked off, and sits in a pile on the agenda; an event has a start and an
-- end and there is nothing to tick. Putting them in one table would mean a
-- status column that is meaningless for half the rows and a checkbox that has
-- to be hidden by the reader -- so: a second table, and the todo module's
-- reads stay separate by construction rather than by remembering to filter.
--
-- No recurrence. Plan #208 settled that: each event is one event, typed once.
-- A repeat rule wants its own table and a generator over it, and bolting a
-- column onto this one now would be a guess at the shape of a feature nobody
-- has designed. Adding it later is one migration.
-- ---------------------------------------------------------------------------

set search_path = todo, public, extensions;

-- ---------------------------------------------------------------------------
-- Two pairs of columns for when, not one.
--
-- The same distinction todo.tasks draws between `due_on` and `due_at`, for the
-- same reason: a whole day must not move because you flew to Lisbon, and a
-- 15:00 appointment must. An all-day event is a pair of dates; a timed one is
-- a pair of instants; exactly one pair is filled.
--
-- `ends_on` is the last day the event covers, inclusive -- a one-day event has
-- `ends_on = starts_on`, and a week off is Monday to Sunday. Inclusive because
-- that is what the form asks for and what the calendar draws; an exclusive end
-- would be a date nobody typed and nobody sees, converted twice on the way
-- there and back.
-- ---------------------------------------------------------------------------
create table if not exists todo.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  title text not null,
  -- Optional detail, markdown, rendered by the component the vault uses.
  body text,
  -- Where it is. Free text: a room, a postcode, a video link. Nothing parses
  -- it, so nothing may assume a shape for it.
  location text,

  starts_on date,
  ends_on date,
  starts_at timestamptz,
  ends_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint events_title_ck check (btrim(title) <> '' and length(title) <= 500),
  constraint events_location_ck check (location is null or length(location) <= 500),

  -- Exactly one pair, both halves of it. "Starts but never ends" is not a
  -- thing this table stores: an event with no end cannot be drawn as a block,
  -- and a null end would have to be invented by every reader separately.
  constraint events_one_span_ck check (
    (num_nonnulls(starts_on, ends_on) = 2 and num_nonnulls(starts_at, ends_at) = 0)
    or (num_nonnulls(starts_on, ends_on) = 0 and num_nonnulls(starts_at, ends_at) = 2)
  ),

  -- An end before its start is not a short event, it is a typo. Equal is fine:
  -- a one-day all-day event, and a timed one somebody has not given a length.
  constraint events_span_order_ck check (
    (ends_on is null or ends_on >= starts_on) and (ends_at is null or ends_at >= starts_at)
  )
);

comment on column todo.events.ends_on is
  'The last day an all-day event covers, inclusive. Equal to starts_on for a '
  'single day.';

-- Two indexes rather than one over a coalesce of the two starts, for the
-- reason spelled out in 0001: timestamptz -> date depends on the session
-- TimeZone and so is not immutable, and an index expression must be.
--
-- The read this serves is always "everything overlapping the window on
-- screen", which is a range scan from the start column with the end checked
-- afterwards. A personal calendar has no volume of events, so the start is
-- selective enough on its own and a second column on the index would only
-- make it bigger.
create index if not exists events_user_starts_on_idx on todo.events (user_id, starts_on)
  where starts_on is not null;
create index if not exists events_user_starts_at_idx on todo.events (user_id, starts_at)
  where starts_at is not null;

create trigger events_touch_updated_at
  before update on todo.events
  for each row execute function todo.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS, from the first migration that creates the table -- and the grants,
-- explicitly. 0001's `grant ... on all tables in schema todo` applied to the
-- tables that existed when it ran; a table added later gets nothing from it.
-- ---------------------------------------------------------------------------
alter table todo.events enable row level security;

create policy events_all on todo.events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on todo.events to authenticated, service_role;
revoke all on todo.events from anon;
