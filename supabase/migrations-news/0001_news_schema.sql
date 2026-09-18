-- The news module: a sixth schema, for newsletters sent to an address of your
-- own.
--
-- Planned as #433. Mail is not read out of a mailbox here. An inbound mail
-- service receives on one address that belongs to this app, posts the message
-- to it, and what arrives is written straight into these three tables. So the
-- rule to read this file against is:
--
--   The address is the account. Nothing else identifies who mail is for.
--
-- That is why `addresses.local_part` is unique across the whole table rather
-- than per user, and why it is random: anyone who learns the address can send
-- to it, and the only defence is that it cannot be guessed and can be replaced.
-- Replacing it is an update of that one row, which is what makes the old
-- address stop working the moment the new one exists.
--
-- Applied by scripts/db-reset.sh after migrations-learn. Nothing in here points
-- outside the schema except at auth.users, so this set could go anywhere in the
-- order except after migrations-todo, which must stay last.
--
-- `news` was checked against what Supabase ships on every project before it was
-- chosen. That is the lesson of `obsidian`, which is called that because
-- `vault` was already taken by Supabase Vault and creating tables there would
-- have published the secrets store. `news` collides with nothing.
--
-- Remember to expose `news` to PostgREST in the Supabase dashboard, as the
-- other five schemas already are. lib/core/db/schema-errors.ts turns the
-- failure into a legible message rather than an empty page, but the setting
-- still has to be made by hand once.
--
-- It was not, and /news was a server error from the day it shipped. 0002 makes
-- the setting a migration instead of a note; this paragraph stays as the reason
-- that file exists.

create schema if not exists news;

set search_path = news, public, extensions;

-- ---------------------------------------------------------------------------
-- addresses -- the one address mail arrives on, one row per account.
--
-- Only the local part is stored. The domain is deployment configuration, not
-- account data: it is decided once for the whole app, it is the same for every
-- account, and storing a copy of it on every row would mean a migration the
-- day it changes.
-- ---------------------------------------------------------------------------
create table news.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Random, lowercase, and long enough that guessing it is not worth trying.
  -- No dots, plus signs or hyphens: every provider treats those differently
  -- when it routes, and an address that means two things is an address that
  -- gets delivered somewhere unexpected.
  local_part text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One address per account. Replacing yours updates this row, and there is no
  -- window in which both work.
  constraint addresses_user_key unique (user_id),
  -- And one account per address, which is the lookup delivery makes.
  constraint addresses_local_part_key unique (local_part),
  constraint addresses_local_part_ck check (local_part ~ '^[a-z0-9]{16,40}$')
);

-- ---------------------------------------------------------------------------
-- senders -- who has written to that address.
--
-- A row per newsletter rather than per message, so the list can group by it and
-- so muting one is a boolean rather than a rule matched against every arrival.
-- Deduped on the address it sent from, lowercased on the way in: mail systems
-- vary the case of a sender freely, and two spellings of one newsletter would
-- read as two newsletters.
-- ---------------------------------------------------------------------------
create table news.senders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  email text not null,
  -- The display name from the From header, when it carried one. Not unique and
  -- not trusted -- it is whatever the sender typed.
  name text,

  -- Nothing reads this yet. It is here because muting is a property of the
  -- sender and the alternative is a second table later holding one boolean.
  muted boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint senders_email_ck check (
    email = lower(email)
    and length(email) between 3 and 320
    and position('@' in email) > 1
  ),
  constraint senders_name_ck check (name is null or (btrim(name) <> '' and length(name) <= 300)),
  constraint senders_user_email_key unique (user_id, email),
  -- Lets an issue point at (sender_id, user_id) as one foreign key. See the
  -- note on issues below.
  constraint senders_id_user_key unique (id, user_id)
);

create index senders_user_name_idx on news.senders (user_id, lower(coalesce(name, email)));

-- ---------------------------------------------------------------------------
-- issues -- one delivered message.
--
-- Both bodies are kept as they arrived. Cleaning the HTML happens on the way
-- out rather than on the way in, so a better sanitiser can be applied to mail
-- that is already here, and so what is stored stays comparable with what was
-- sent.
--
-- The parent is joined by a COMPOSITE foreign key carrying user_id, not by a
-- trigger. Foreign keys bypass row level security -- documented behaviour --
-- so `references news.senders (id)` alone would be satisfied by any sender in
-- the table, including another account's, and the policy below only asks who
-- owns the issue. learn.readings points at its two parents the same way.
-- ---------------------------------------------------------------------------
create table news.issues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_id uuid not null,

  -- The Message-ID the delivering service hands over. A provider retries a
  -- delivery it did not get a 200 for, so the unique index below is what makes
  -- the second attempt land on the row the first one wrote instead of beside
  -- it.
  message_id text not null,

  subject text,
  -- When it arrived here, which is what the list sorts on. Not the Date header:
  -- a sender writes that and some of them write it wrong, and an issue that
  -- claims to be from next week would sit at the top of the list forever.
  received_at timestamptz not null default now(),

  text_body text,
  html_body text,

  -- Null until you open it. A timestamp rather than a boolean because "when"
  -- is free to keep and answers questions "whether" cannot.
  read_at timestamptz,

  created_at timestamptz not null default now(),

  constraint issues_sender_fk foreign key (sender_id, user_id)
    references news.senders (id, user_id) on delete cascade,

  constraint issues_message_id_ck check (btrim(message_id) <> '' and length(message_id) <= 998),
  constraint issues_subject_ck check (subject is null or btrim(subject) <> ''),
  -- A message with neither body is a delivery that failed rather than an issue
  -- to read, and storing it would put an empty row in the list.
  constraint issues_body_ck check (num_nonnulls(text_body, html_body) >= 1)
);

create unique index issues_user_message_key on news.issues (user_id, message_id);

-- The list: everything you have been sent, newest first.
create index issues_user_received_idx on news.issues (user_id, received_at desc);

-- Unread counts, and the foreign key index Postgres does not create for you.
create index issues_user_unread_idx on news.issues (user_id, received_at desc)
  where read_at is null;
create index issues_sender_idx on news.issues (sender_id, received_at desc);

-- ---------------------------------------------------------------------------
-- updated_at. Its own copy, as learn, todo, obsidian and core have their own
-- copies, so the schema does not depend on another schema's function surviving
-- a refactor.
--
-- issues has no updated_at: a delivered message is not edited, and read_at is
-- the only column that moves after it is written.
-- ---------------------------------------------------------------------------
create or replace function news.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function news.touch_updated_at() set search_path = news;
revoke all on function news.touch_updated_at() from public, anon, authenticated;

create trigger addresses_touch_updated_at
  before update on news.addresses
  for each row execute function news.touch_updated_at();

create trigger senders_touch_updated_at
  before update on news.senders
  for each row execute function news.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- Every table, from the first migration, before any feature code.
-- tests/rls-news.test.ts asserts it rather than trusting this comment, and
-- asserts the coverage too, so a table added later without a policy fails
-- immediately.
--
-- auth.uid() is wrapped in a select in every policy so it is evaluated once per
-- query rather than once per row.
--
-- Delivery writes through the service role, which these policies do not apply
-- to. That is deliberate: mail arrives on a webhook with no session behind it,
-- and the address is what says whose it is.
-- ---------------------------------------------------------------------------
alter table news.addresses enable row level security;
alter table news.senders enable row level security;
alter table news.issues enable row level security;

create policy addresses_all on news.addresses for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy senders_all on news.senders for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy issues_all on news.issues for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Nothing here is readable by an anonymous visitor.
revoke all on all tables in schema news from anon;

grant usage on schema news to authenticated, service_role;
grant select, insert, update, delete on all tables in schema news to authenticated, service_role;
