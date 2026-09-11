-- ---------------------------------------------------------------------------
-- 0006 -- calendar subscriptions: the appointments you keep somewhere else.
--
-- You paste the private address of a calendar you already keep and the
-- appointments in it are read out and stored here, so the page draws them
-- without waiting on somebody else's server. Two tables: the subscription, and
-- the appointments the last read of it produced.
--
-- It reads one way only. Nothing typed in this app is ever sent back to the
-- address, and an appointment that arrived through a subscription is not
-- editable here -- which is a rule the pages keep, not a grant, because the
-- refresh runs from a server action as the signed-in user and so needs to
-- write these rows. The account owns them either way.
--
-- These rows are a copy and are treated as one: a refresh replaces what a
-- subscription contributed last time, and nothing else in the app may point at
-- a feed_events row, because the next read can drop it.
-- ---------------------------------------------------------------------------

set search_path = todo, public, extensions;

-- ---------------------------------------------------------------------------
-- calendar_feeds -- one row per subscription.
--
-- The address is a credential. Anyone holding the private link to a Google
-- calendar can read the whole calendar, so what is stored is ciphertext from
-- lib/crypto/tokens.ts -- the same helper, and the same key, the mailbox OAuth
-- tokens use. The check constraint is what stops a plain URL being written
-- here by a caller that forgot: it can only be satisfied by a string that came
-- out of encryptToken(). A second ciphertext format later is one migration.
-- ---------------------------------------------------------------------------
create table if not exists todo.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- What you called it: "Work", "Family". Shown on the calendar and in
  -- settings; the address never is.
  name text not null,
  address text not null,

  -- When the address was last read successfully, and what went wrong if the
  -- last attempt did not. An error does not clear last_read_at: the
  -- appointments from the last good read stay on the page, and the pair says
  -- both that they are stale and why.
  last_read_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint calendar_feeds_name_ck check (btrim(name) <> '' and length(name) <= 200),
  constraint calendar_feeds_address_ck check (address like 'v1:%'),
  constraint calendar_feeds_last_error_ck check (last_error is null or length(last_error) <= 2000)
);

comment on column todo.calendar_feeds.address is
  'The subscription URL, encrypted by lib/crypto/tokens.ts. Never rendered '
  'back in full.';

-- The key the appointments point at. A plain reference to the id would be
-- satisfied by any feed in the table, including another account's -- the same
-- fact todo.task_links needs a trigger for -- so the pair is the key and the
-- ownership check is the foreign key itself.
alter table todo.calendar_feeds
  add constraint calendar_feeds_user_id_uq unique (id, user_id);

create index if not exists calendar_feeds_user_idx
  on todo.calendar_feeds (user_id, created_at);

create trigger calendar_feeds_touch_updated_at
  before update on todo.calendar_feeds
  for each row execute function todo.touch_updated_at();

-- ---------------------------------------------------------------------------
-- feed_events -- one row per occurrence of one appointment.
--
-- The same two pairs of columns todo.events has, with the same constraints,
-- for the same reason: a whole day off must not move because you flew to
-- Lisbon and a 15:00 meeting must. Everything that reads the calendar can
-- therefore ask a subscribed appointment the same date questions it asks one
-- you typed.
--
-- One row per occurrence, not per rule. A weekly stand-up is expanded into its
-- dates when the file is read, because the alternative is a recurrence
-- evaluator between the table and every reader of it. There is no updated_at
-- and no touch trigger: these rows are not edited, they are replaced.
-- ---------------------------------------------------------------------------
create table if not exists todo.feed_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feed_id uuid not null,

  -- The identifier the calendar file gave the appointment. Not unique on its
  -- own and not a key here: every occurrence of a repeating appointment
  -- carries the same one, and two calendars can hand out the same string. It
  -- is stored so a refresh can tell which appointment a row came from.
  uid text not null,

  title text not null,
  body text,
  -- Where it is, as the file said it: a room, a postcode, a video link.
  -- Nothing parses it.
  location text,

  starts_on date,
  ends_on date,
  starts_at timestamptz,
  ends_at timestamptz,

  created_at timestamptz not null default now(),

  -- An appointment with no name in the file is given one by the parser, for
  -- the same reason todo.events refuses a blank title: a pill with nothing
  -- written on it is not something the calendar can draw.
  constraint feed_events_title_ck check (btrim(title) <> '' and length(title) <= 500),
  constraint feed_events_uid_ck check (btrim(uid) <> '' and length(uid) <= 500),
  constraint feed_events_location_ck check (location is null or length(location) <= 500),

  constraint feed_events_one_span_ck check (
    (num_nonnulls(starts_on, ends_on) = 2 and num_nonnulls(starts_at, ends_at) = 0)
    or (num_nonnulls(starts_on, ends_on) = 0 and num_nonnulls(starts_at, ends_at) = 2)
  ),
  constraint feed_events_span_order_ck check (
    (ends_on is null or ends_on >= starts_on) and (ends_at is null or ends_at >= starts_at)
  ),

  -- Removing a subscription takes its appointments with it, which is what
  -- "and leaves everything you typed here alone" means: todo.events is a
  -- different table and nothing here touches it.
  constraint feed_events_feed_fk foreign key (feed_id, user_id)
    references todo.calendar_feeds (id, user_id) on delete cascade
);

comment on column todo.feed_events.uid is
  'The UID the calendar file gave this appointment. Shared by every occurrence '
  'of a repeating one.';

-- The same two indexes todo.events has, and for the same reason: timestamptz
-- to date is not immutable, so one index over a coalesce of the two starts is
-- not available. Plus the feed, which is the key a refresh deletes by.
create index if not exists feed_events_user_starts_on_idx
  on todo.feed_events (user_id, starts_on) where starts_on is not null;
create index if not exists feed_events_user_starts_at_idx
  on todo.feed_events (user_id, starts_at) where starts_at is not null;
create index if not exists feed_events_feed_idx on todo.feed_events (feed_id);

-- ---------------------------------------------------------------------------
-- RLS and the grants, written out. 0001's `grant ... on all tables in schema
-- todo` covered the tables that existed when it ran; these two get nothing
-- from it.
-- ---------------------------------------------------------------------------
alter table todo.calendar_feeds enable row level security;
alter table todo.feed_events enable row level security;

create policy calendar_feeds_all on todo.calendar_feeds for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy feed_events_all on todo.feed_events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on todo.calendar_feeds to authenticated, service_role;
grant select, insert, update, delete on todo.feed_events to authenticated, service_role;
revoke all on todo.calendar_feeds from anon;
revoke all on todo.feed_events from anon;
