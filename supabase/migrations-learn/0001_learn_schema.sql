-- The learn module: a fifth schema, for things you mean to read.
--
-- Specified in docs/LEARN-SPEC.md. Two rules everything here serves, and the
-- ones to read this file against:
--
--   Never send someone to a page that is not there.
--   Store locations, not texts.
--
-- The first is why every reading carries both a confidence and a basis, and
-- why the basis is `not null` with a non-empty check: the module is allowed to
-- guess where a passage is, and is not allowed to guess quietly. The second is
-- why there is no column anywhere in this schema for the body of a source.
-- What is stored is a citation, a location inside it, a short anchor phrase
-- used to build a link, and whatever the account holder writes themselves.
--
-- Applied by scripts/db-reset.sh after migrations-todo. Nothing in here points
-- outside the schema except at auth.users, so the position in the order is not
-- load-bearing -- unlike todo, which has foreign keys into three other schemas.
--
-- `learn` was checked against what Supabase ships on every project before it
-- was chosen. That is the lesson of `obsidian`, which is called that because
-- `vault` was already taken by Supabase Vault and creating tables there would
-- have published the secrets store. `learn` collides with nothing.
--
-- Remember to expose `learn` to PostgREST in the Supabase dashboard, as the
-- other four schemas already are. lib/core/db/schema-errors.ts turns the
-- failure into a legible message rather than an empty page, but the setting
-- still has to be made by hand once.

create schema if not exists learn;

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- Enums.
-- ---------------------------------------------------------------------------

-- What kind of thing a source is. Drives how it is opened and how a location
-- inside it can be expressed: a `page` gets a text fragment, a `video` gets a
-- timestamp, a `book` generally gets a chapter and nothing finer.
create type learn.source_kind as enum (
  'article',
  'paper',
  'book',
  'chapter',
  'video',
  'course',
  'page'
);

-- Whether you can actually read it, and at what cost.
--
-- First-class rather than derived, because the honest reading list for a
-- paywalled canon is "buy this one thing, then these six are free". A module
-- that cannot say that routes silently around the good source to a worse free
-- one, which is the failure it exists to correct.
create type learn.source_access as enum (
  'open',        -- free full text, no account
  'paywalled',   -- readable for a fee, per article
  'purchase',    -- a book you would buy
  'library',     -- free with a library card or institutional access
  'unknown'      -- not established. Not a synonym for open
);

-- How precisely a reading points into its source.
create type learn.locator_kind as enum (
  'whole',       -- read the thing. Correct for a 12-page essay
  'chapter',
  'section',
  'pages',
  'timestamp',
  'passage'      -- a specific paragraph, anchored by phrase
);

-- Whether the location was checked or merely proposed.
--
-- `verified` means something was fetched and the claim held: the anchor phrase
-- was found verbatim in the fetched text, or a table of contents was found
-- naming that chapter. `unverified` means a model believes it. Both are
-- allowed; only one may be displayed without a warning.
create type learn.locator_confidence as enum ('verified', 'unverified');

create type learn.reading_status as enum ('queued', 'reading', 'read', 'abandoned');

create type learn.track_status as enum ('active', 'done', 'shelved');

-- ---------------------------------------------------------------------------
-- sources -- a work that exists in the world.
--
-- Deduped per user: Hayek's essay turns up in three reading lists and is one
-- row. Nothing here is about your relationship to it; that is a reading.
-- ---------------------------------------------------------------------------
create table learn.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Canonical, as resolved -- not as pasted. "Dworkin's 'Equality of
  -- Resources'" is stored as its real title, which is what makes the same work
  -- pasted two different ways collapse to one row.
  title text not null,
  author text,
  kind learn.source_kind not null default 'page',
  year int,

  -- The best openable address found. Null when nothing free or legitimate
  -- turned up, which is a real outcome and not an error: a book with no free
  -- edition still belongs in a queue.
  canonical_url text,

  access learn.source_access not null default 'unknown',
  -- Integer cents, as everywhere else in this codebase. See lib/money.ts.
  price_cents int,
  -- Access decays. A check from eighteen months ago should look eighteen
  -- months old rather than look like a fact.
  access_checked_at timestamptz,

  -- Whichever applies. Both null is fine and common.
  page_count int,
  duration_seconds int,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sources_title_ck check (btrim(title) <> '' and length(title) <= 500),
  constraint sources_url_ck check (canonical_url is null or canonical_url ~ '^https://'),
  constraint sources_year_ck check (year is null or (year between 1000 and 2200)),
  constraint sources_price_ck check (price_cents is null or price_cents >= 0),
  constraint sources_page_count_ck check (page_count is null or page_count > 0),
  constraint sources_duration_ck check (duration_seconds is null or duration_seconds > 0),
  -- A price without a paid access kind is a contradiction, and reading it back
  -- as "$10, free" is worse than refusing to store it.
  constraint sources_price_needs_paid_access_ck
    check (price_cents is null or access in ('paywalled', 'purchase')),

  -- Lets a reading point at (source_id, user_id) as one foreign key. See the
  -- note on readings below -- this is what makes cross-account links
  -- impossible without a trigger.
  constraint sources_id_user_key unique (id, user_id)
);

-- Only https URLs get in, so this is the dedup key when there is one. Partial
-- because a book with no free edition has no URL and two of those are not the
-- same book.
create unique index sources_user_url_key
  on learn.sources (user_id, canonical_url)
  where canonical_url is not null;

create index sources_user_title_idx on learn.sources (user_id, lower(title));

-- ---------------------------------------------------------------------------
-- tracks -- an ordered queue, with the reason it exists.
-- ---------------------------------------------------------------------------
create table learn.tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  title text not null,

  -- What you were actually stuck on, in your own words. Nullable, and the more
  -- important of the two: a specific question produces a far better reading
  -- list than a topic name, and it is what the locate pass aims at when it
  -- goes looking for the part of a source that matters.
  question text,

  status learn.track_status not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tracks_title_ck check (btrim(title) <> '' and length(title) <= 300),
  constraint tracks_question_ck check (question is null or btrim(question) <> ''),
  constraint tracks_id_user_key unique (id, user_id)
);

create index tracks_user_status_idx
  on learn.tracks (user_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- readings -- the unit, and the thing progress is tracked on.
--
-- A reading is not a source. It is a located slice of one: "ch. 4, pp. 95-128
-- of Spheres of Justice", which is thirty-five pages you might read, where the
-- source is three hundred and fifty you will not.
--
-- The two parents are joined by COMPOSITE foreign keys carrying user_id, not
-- by a trigger. Foreign keys bypass row level security -- documented
-- behaviour -- so `references learn.tracks (id)` alone would be satisfied by
-- any track in the table, including another account's, and the policy below
-- only asks who owns the reading. todo.task_links solves the same problem with
-- a security definer trigger because it points at one of six optional targets
-- across three schemas and no single foreign key can express that. This points
-- at exactly two parents in its own schema, so the constraint says it directly
-- and there is no function to write, pin, or revoke.
-- ---------------------------------------------------------------------------
create table learn.readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null,
  source_id uuid not null,

  -- Order within the track. Sparse and rewritten on reorder; deliberately not
  -- unique, because swapping two rows under a unique constraint needs a
  -- deferred check or a temporary value, and neither is worth it here.
  position int not null default 0,

  -- Where in the source, and how sure we are.
  locator_kind learn.locator_kind not null default 'whole',
  -- Human text: `Ch. 4, "Money and Commodities"`. What the card shows.
  locator_label text,
  page_from int,
  page_to int,
  -- Where the Open button goes. The base URL, or `...#page=12`, or a text
  -- fragment URL that scrolls to and highlights the passage.
  open_url text,
  -- The phrase a text fragment matches on. Short by construction: it is a
  -- handle for the browser, not an excerpt, and this schema does not store
  -- excerpts.
  text_anchor text,

  locator_confidence learn.locator_confidence not null default 'unverified',
  -- How the location was established, in a sentence, rendered on the reading
  -- page. "Found verbatim in the fetched page" and "the model believes this,
  -- unchecked" are different claims and the interface must not flatten them.
  --
  -- not null, and non-empty: a locator with no stated basis is exactly the
  -- silent guess both rules in the header forbid.
  locator_basis text not null,

  -- One line: what this reading gives you that the previous one did not. Not a
  -- summary of the source. This is what makes an ordered list a curriculum.
  why text,

  status learn.reading_status not null default 'queued',
  -- What you took from it. Yours, optional, and the first thing this
  -- application stores about what you learned rather than what you did.
  note text,

  -- Stamped by a trigger, not by the caller. See below.
  started_at timestamptz,
  finished_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Named, because PostgREST embeds a parent by naming its foreign key, and
  -- `user_id` sits in both of these. A generated name would work until the day
  -- one of them changed; `readings!readings_track_fk(...)` in a select says
  -- exactly which relationship is meant and keeps saying it.
  constraint readings_track_fk foreign key (track_id, user_id)
    references learn.tracks (id, user_id) on delete cascade,
  -- Cascade rather than restrict: a reading without a source is meaningless,
  -- and it keeps account deletion a matter of foreign keys rather than of a
  -- route remembering four more tables. Nothing in the app deletes a source.
  constraint readings_source_fk foreign key (source_id, user_id)
    references learn.sources (id, user_id) on delete cascade,

  constraint readings_pages_ck check (
    (page_from is null or page_from > 0)
    and (page_to is null or page_to > 0)
    and (page_from is null or page_to is null or page_from <= page_to)
  ),
  constraint readings_basis_ck check (btrim(locator_basis) <> ''),
  constraint readings_anchor_ck check (text_anchor is null or length(text_anchor) <= 300),
  constraint readings_open_url_ck check (open_url is null or open_url ~ '^https://'),
  constraint readings_label_ck check (locator_label is null or btrim(locator_label) <> '')
);

-- The track view: every reading in one track, in order.
create index readings_track_position_idx
  on learn.readings (user_id, track_id, position, created_at);

-- Progress counts per track.
create index readings_track_status_idx on learn.readings (track_id, status);

-- "You already read this in another track" -- and the foreign key index
-- Postgres does not create for you.
create index readings_source_idx on learn.readings (source_id);

-- ---------------------------------------------------------------------------
-- imports -- provenance for a paste.
--
-- Six weeks later "why is this in my queue?" is a real question, and when the
-- parser gets something wrong the only way to see how is to still have what
-- went in. Small, cheap, and the alternative is guessing.
-- ---------------------------------------------------------------------------
create table learn.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null,

  raw_text text not null,
  -- Free text: 'claude', 'chatgpt', 'a syllabus', null. Not an enum -- there
  -- is no behaviour attached to it and no list worth maintaining.
  source_hint text,
  -- The candidate list the parse produced, before resolution and before you
  -- ticked anything.
  parsed jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),

  constraint imports_track_fk foreign key (track_id, user_id)
    references learn.tracks (id, user_id) on delete cascade,

  constraint imports_raw_text_ck check (btrim(raw_text) <> ''),
  constraint imports_parsed_is_array_ck check (jsonb_typeof(parsed) = 'array')
);

create index imports_track_idx on learn.imports (track_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------

create or replace function learn.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function learn.touch_updated_at() set search_path = learn;
revoke all on function learn.touch_updated_at() from public, anon, authenticated;

create trigger sources_touch_updated_at
  before update on learn.sources
  for each row execute function learn.touch_updated_at();

create trigger tracks_touch_updated_at
  before update on learn.tracks
  for each row execute function learn.touch_updated_at();

create trigger readings_touch_updated_at
  before update on learn.readings
  for each row execute function learn.touch_updated_at();

-- When a reading's status moves, the timestamps follow. Stamped here rather
-- than by the caller for the same reason todo.tasks stamps completed_at: four
-- call sites will eventually disagree about it, and one of them will forget.
--
-- `abandoned` finishes a reading as surely as `read` does -- it is over, you
-- are not going back -- so it stamps finished_at too. What separates them is
-- the status itself, and /learn counts only `read` toward progress.
create or replace function learn.stamp_reading_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('reading', 'read', 'abandoned') and new.started_at is null then
      new.started_at := now();
    end if;

    if new.status in ('read', 'abandoned') then
      new.finished_at := coalesce(new.finished_at, now());
    else
      -- Back to queued or reading: it is not finished any more, and a stale
      -- finished_at would outlive the status that justified it.
      new.finished_at := null;
    end if;
  end if;

  return new;
end;
$$;

alter function learn.stamp_reading_status() set search_path = learn;
revoke all on function learn.stamp_reading_status() from public, anon, authenticated;

create trigger readings_stamp_status
  before update on learn.readings
  for each row execute function learn.stamp_reading_status();

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- Every table, from the first migration, before any feature code -- build step
-- 2's rule. tests/rls-learn.test.ts asserts it rather than trusting this
-- comment, and asserts the coverage too, so a table added later without a
-- policy fails immediately.
--
-- auth.uid() is wrapped in a select in every policy so it is evaluated once
-- per query rather than once per row.
-- ---------------------------------------------------------------------------
alter table learn.sources enable row level security;
alter table learn.tracks enable row level security;
alter table learn.readings enable row level security;
alter table learn.imports enable row level security;

create policy sources_all on learn.sources for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy tracks_all on learn.tracks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy readings_all on learn.readings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy imports_all on learn.imports for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Nothing here is readable by an anonymous visitor.
revoke all on all tables in schema learn from anon;

grant usage on schema learn to authenticated, service_role;
grant select, insert, update, delete on all tables in schema learn to authenticated, service_role;
