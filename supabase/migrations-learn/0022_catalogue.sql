-- The catalogue: places to go learn from, addressable down to a clip.
--
-- Specified in docs/LEARN-SOURCES-SPEC.md. Until now the module could only
-- point at a source you had already named. This holds material you have not
-- met yet, which is what lets Learn say anything about a part of a subject your
-- notes never covered.
--
-- Most of the shape this needs was designed in 0001 and never used:
-- `source_kind` already has `video` and `course`, `locator_kind` already has
-- `timestamp`, and `sources` already carries `duration_seconds`. Three things
-- were missing, and they are the whole of this migration: somewhere to put a
-- work you have not queued, the second offsets the `timestamp` locator has been
-- advertising since 0001, and a way to find a passage among many.
--
-- Two decisions are made here rather than left to the application.
--
--   **The catalogue belongs to nobody.** `learn.sources` is per-user and
--   deduped per user, which is right for a work you have a relationship with
--   and wrong for a reference catalogue: forty thousand Wikipedia sections is
--   not forty thousand rows per account. So the four catalogue tables carry no
--   `user_id`, and queuing something materialises an ordinary `sources` row
--   from it. Every existing foreign key, every page that reads `readings`, and
--   the whole locate pass keep working unchanged, because what they see is a
--   `sources` row exactly as before.
--
--   **The addressable unit is a segment, not a work.** Offering a whole
--   eighty-minute lecture as the answer to one claim is close to useless when
--   the claim is covered in four minutes somewhere in the middle. A segment is
--   a span of one work -- a section of an article, a few minutes of a
--   transcript -- and it is what gets embedded, what gets linked to a concept,
--   and what becomes a reading with `locator_kind = 'timestamp'`.
--
-- `catalogue_links` is the one table here that does belong to a person, because
-- it points at a concept, and concepts are per-user. It carries a `basis` and a
-- `confidence` for the reason `readings.locator_basis` is not null: a link
-- established by cosine similarity and a link a model read the segment and
-- argued for are different claims, and a screen that renders them identically
-- is overstating one of them.
--
-- No provider is ingested here. This is the store; the sweeps that fill it are
-- the next steps in that document's build order.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- pgvector. New to this database, and used by exactly one column below.
--
-- In `extensions` alongside pg_trgm, per 0001's note about keeping extension
-- operators resolvable from unqualified SQL.
-- ---------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Providers: where material comes from.
--
-- A table rather than an enum because the set is meant to grow -- adding a
-- lecture channel should not be a migration. `slug` is the stable handle code
-- refers to; `name` is what a screen shows.
--
-- `licence` and `ingest_note` are here because acquisition differs per provider
-- and that difference is the main risk in this feature. Wikipedia has an API.
-- YouTube's captions endpoint only serves videos the caller owns, so transcripts
-- come from the institution that published them. Khan Academy's API was
-- withdrawn in 2020 and answers 403. A column saying how this one works is
-- cheaper than finding out again.
-- ---------------------------------------------------------------------------
create table if not exists learn.catalogue_providers (
  id uuid primary key default gen_random_uuid(),

  slug text not null,
  name text not null,
  home_url text not null,

  -- Spelled out rather than inferred. Most of this material is CC BY-NC-SA,
  -- which permits what this module does and does not permit everything.
  licence text not null,
  -- How material is actually got from here, in a sentence or two.
  ingest_note text not null,

  -- Set when the provider is a YouTube channel, so the sweep knows what to walk.
  -- Left null by the seed below and filled by the sweep, which resolves it from
  -- the channel handle and stores what the API returned. A channel id typed from
  -- memory is the silent guess this schema is built to refuse, and a wrong one
  -- fails by quietly walking somebody else's playlists.
  youtube_channel_id text,

  -- Off by default. A provider row can exist before its sweep is written.
  enabled boolean not null default false,
  last_swept_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint catalogue_providers_slug_uq unique (slug),
  constraint catalogue_providers_slug_ck check (slug ~ '^[a-z0-9-]{2,64}$'),
  constraint catalogue_providers_name_ck check (btrim(name) <> ''),
  constraint catalogue_providers_home_url_ck check (home_url ~ '^https://'),
  constraint catalogue_providers_licence_ck check (btrim(licence) <> ''),
  constraint catalogue_providers_ingest_note_ck check (btrim(ingest_note) <> '')
);

drop trigger if exists catalogue_providers_touch_updated_at on learn.catalogue_providers;
create trigger catalogue_providers_touch_updated_at
  before update on learn.catalogue_providers
  for each row execute function learn.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Items: one work in the catalogue.
--
-- Reuses `learn.source_kind`, whose `video` and `course` values were written
-- for exactly this and have been unused since 0001. A course is an item of kind
-- `course`; its members are ordered by `catalogue_course_items` below.
-- ---------------------------------------------------------------------------
create table if not exists learn.catalogue_items (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references learn.catalogue_providers (id) on delete cascade,

  -- The provider's own identifier: a Wikipedia page title, a YouTube video id,
  -- an OCW course number. What makes a re-sweep update a row instead of adding
  -- one.
  external_id text not null,

  title text not null,
  kind learn.source_kind not null,
  author text,
  canonical_url text not null,

  published_at date,
  -- Whichever applies, as on `sources`. Both null is fine.
  duration_seconds int,
  length_chars int,

  -- Null means it follows the provider's licence, which is the usual case. Set
  -- only where one work differs.
  licence text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint catalogue_items_external_uq unique (provider_id, external_id),
  constraint catalogue_items_external_ck check (btrim(external_id) <> ''),
  constraint catalogue_items_title_ck check (btrim(title) <> '' and length(title) <= 500),
  constraint catalogue_items_url_ck check (canonical_url ~ '^https://'),
  constraint catalogue_items_duration_ck check (duration_seconds is null or duration_seconds > 0),
  constraint catalogue_items_length_ck check (length_chars is null or length_chars > 0),
  constraint catalogue_items_licence_ck check (licence is null or btrim(licence) <> '')
);

drop trigger if exists catalogue_items_touch_updated_at on learn.catalogue_items;
create trigger catalogue_items_touch_updated_at
  before update on learn.catalogue_items
  for each row execute function learn.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Segments: the addressable unit, and the only thing here that is embedded.
--
-- A segment is either timed (a span of a transcript), anchored (a section of an
-- article), or neither (one segment standing for a whole work, which is what a
-- video with no available transcript gets). The constraint below allows all
-- three and refuses a row that is half of two of them.
--
-- `text` is not null because a segment with no text can neither be embedded nor
-- judged. For a work with no transcript that text is the title and description,
-- which is honest and makes it rank poorly, as it should.
-- ---------------------------------------------------------------------------
create table if not exists learn.catalogue_segments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references learn.catalogue_items (id) on delete cascade,

  -- Position within the work, from 0. Stable across a re-sweep only if the
  -- segmentation is; a changed segmentation replaces the rows.
  ordinal int not null,

  -- Timed segments.
  t_start_seconds int,
  t_end_seconds int,

  -- Anchored segments. `section_anchor` is the fragment that addresses it;
  -- `heading` is what a card shows.
  section_anchor text,
  heading text,

  text text not null,

  -- 1024 dimensions, which both candidate providers can emit: Voyage natively,
  -- and OpenAI's small model through its dimensions parameter. So the provider
  -- choice does not block this column, and re-embedding onto another model of
  -- the same width is a sweep rather than a migration.
  embedding extensions.vector(1024),
  -- Which model produced it. A catalogue embedded by two models is a silently
  -- broken index, and this column is what makes that detectable.
  embedding_model text,

  created_at timestamptz not null default now(),

  constraint catalogue_segments_ordinal_uq unique (item_id, ordinal),
  constraint catalogue_segments_ordinal_ck check (ordinal >= 0),
  constraint catalogue_segments_text_ck check (btrim(text) <> ''),
  constraint catalogue_segments_heading_ck check (heading is null or btrim(heading) <> ''),
  constraint catalogue_segments_anchor_ck check (section_anchor is null or btrim(section_anchor) <> ''),
  -- Timed or not, with no half-timed row. An open-ended clip is allowed: a
  -- start with no end means "from here to the end of the work".
  constraint catalogue_segments_time_ck check (
    (t_start_seconds is null and t_end_seconds is null)
    or (t_start_seconds >= 0 and (t_end_seconds is null or t_end_seconds > t_start_seconds))
  ),
  -- A segment is timed or anchored, never both.
  constraint catalogue_segments_one_address_ck check (
    t_start_seconds is null or section_anchor is null
  ),
  -- An embedding without its model is unusable and reads as trustworthy.
  constraint catalogue_segments_embedding_ck check (
    (embedding is null) = (embedding_model is null)
  )
);

-- Nearest-neighbour retrieval, cosine. Built on an empty table and filled
-- incrementally, which HNSW supports; at catalogue sizes below a few thousand
-- segments the planner will sequentially scan anyway and be right to.
create index if not exists catalogue_segments_embedding_idx
  on learn.catalogue_segments using hnsw (embedding extensions.vector_cosine_ops);

-- Which segments still need embedding. Partial, because once the sweep has
-- caught up this index is empty and free.
create index if not exists catalogue_segments_unembedded_idx
  on learn.catalogue_segments (item_id)
  where embedding is null;

-- ---------------------------------------------------------------------------
-- Course order: the part of a provider these two tables exist for.
--
-- MIT OpenCourseWare, the Yale open courses and Khan Academy's units all ship a
-- sequence somebody competent argued about, and a published order is worth more
-- than a generated one. It feeds a track skeleton, and it is weak evidence for
-- the `requires` edges LEARN-MAP-SPEC names as its open extraction risk.
--
-- Weak evidence, treated as such: nothing here writes a `concept_edges` row.
-- Lecture 7 following lecture 4 reflects a term's scheduling as much as it
-- reflects dependency.
-- ---------------------------------------------------------------------------
create table if not exists learn.catalogue_course_items (
  id uuid primary key default gen_random_uuid(),
  -- The item of kind `course`.
  course_item_id uuid not null references learn.catalogue_items (id) on delete cascade,
  member_item_id uuid not null references learn.catalogue_items (id) on delete cascade,

  position int not null,
  -- The provider's own numbering, verbatim: `Lecture 7`, `Unit 2, Lesson 3`.
  provider_label text,

  created_at timestamptz not null default now(),

  constraint catalogue_course_items_position_uq unique (course_item_id, position),
  constraint catalogue_course_items_member_uq unique (course_item_id, member_item_id),
  constraint catalogue_course_items_position_ck check (position >= 0),
  constraint catalogue_course_items_not_self_ck check (course_item_id <> member_item_id),
  constraint catalogue_course_items_label_ck check (provider_label is null or btrim(provider_label) <> '')
);

create index if not exists catalogue_course_items_member_idx
  on learn.catalogue_course_items (member_item_id);

-- ---------------------------------------------------------------------------
-- Links: this segment speaks to this claim, or to this subject.
--
-- The one table here that belongs to a person, because concepts do. A link is
-- never written on similarity alone -- that is `locator_basis` applied to a new
-- surface, and the reason is the same one given there: a pointer that lands you
-- nowhere costs the twenty minutes anyway and then costs you trust in the queue.
--
--   `unverified` -- a nearest neighbour, and nothing more
--   `verified`   -- a model read the segment text and argued for the link
-- ---------------------------------------------------------------------------
create table if not exists learn.catalogue_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  segment_id uuid not null references learn.catalogue_segments (id) on delete cascade,

  -- Exactly one of these. A claim-level link is what the session reads; a
  -- subject-level one is what coverage reads.
  concept_id uuid,
  subject_id uuid,

  -- What this segment gives you about that claim, in a sentence. Becomes the
  -- reading's `why` when it is queued, which is what makes an ordered list a
  -- curriculum rather than a pile.
  basis text not null,
  confidence learn.locator_confidence not null default 'unverified',

  model text,
  created_at timestamptz not null default now(),

  constraint catalogue_links_basis_ck check (btrim(basis) <> ''),
  constraint catalogue_links_one_target_ck check (
    (concept_id is not null) <> (subject_id is not null)
  ),
  -- Composite, carrying user_id, so a row cannot join one account's concept to
  -- another account's link. Foreign keys are not subject to RLS, so this is the
  -- only thing that stops it.
  constraint catalogue_links_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete cascade,
  constraint catalogue_links_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade
);

-- One link per pair, in both shapes. Partial because a unique constraint over a
-- nullable column treats nulls as distinct and would let duplicates through.
create unique index if not exists catalogue_links_concept_uq
  on learn.catalogue_links (user_id, segment_id, concept_id)
  where concept_id is not null;
create unique index if not exists catalogue_links_subject_uq
  on learn.catalogue_links (user_id, segment_id, subject_id)
  where subject_id is not null;

-- The read this feature is built around: everything linked to one claim, best
-- first.
create index if not exists catalogue_links_concept_idx
  on learn.catalogue_links (user_id, concept_id, confidence)
  where concept_id is not null;
create index if not exists catalogue_links_subject_idx
  on learn.catalogue_links (user_id, subject_id)
  where subject_id is not null;
create index if not exists catalogue_links_segment_idx
  on learn.catalogue_links (segment_id);

-- ---------------------------------------------------------------------------
-- The two changes to existing tables.
-- ---------------------------------------------------------------------------

-- Where in a video a reading points. `locator_kind` has been able to say
-- `timestamp` since 0001 with nowhere to put the offsets, which left a clip
-- expressible only by hiding `?t=` inside `open_url`, where it cannot be
-- rendered as `12:04-18:30` and cannot be measured.
alter table learn.readings
  add column if not exists t_start_seconds int,
  add column if not exists t_end_seconds int;

alter table learn.readings drop constraint if exists readings_time_ck;
alter table learn.readings add constraint readings_time_ck check (
  (t_start_seconds is null and t_end_seconds is null)
  or (t_start_seconds >= 0 and (t_end_seconds is null or t_end_seconds > t_start_seconds))
);

-- The offsets and the locator kind agree, in both directions. Same instinct as
-- the `pages` columns: a locator that says one thing and stores another is a
-- card that reads wrong and a query that quietly returns the mismatch.
alter table learn.readings drop constraint if exists readings_timestamp_needs_offsets_ck;
alter table learn.readings add constraint readings_timestamp_needs_offsets_ck check (
  case when locator_kind = 'timestamp'
    then t_start_seconds is not null
    else t_start_seconds is null and t_end_seconds is null
  end
);

-- Where a materialised source came from, so queuing the same lecture twice
-- collapses onto one row. Nullable: a source you pasted has no catalogue entry,
-- which stays the common case.
alter table learn.sources
  add column if not exists catalogue_item_id uuid
  references learn.catalogue_items (id) on delete set null;

create index if not exists sources_catalogue_item_idx
  on learn.sources (catalogue_item_id)
  where catalogue_item_id is not null;

-- ---------------------------------------------------------------------------
-- RLS.
--
-- The four catalogue tables are reference data: readable by any signed-in
-- account, written only by the sweeps, which run as `service_role` and bypass
-- RLS. So there is no insert, update or delete policy on them at all, and the
-- grant is `select` alone -- a missing policy is a refusal, which is the
-- behaviour wanted here.
--
-- `catalogue_links` is per-user and follows the same shape as
-- `concept_subjects`: the three policies it needs, and no update policy,
-- because changing either end is a different link.
-- ---------------------------------------------------------------------------
alter table learn.catalogue_providers enable row level security;
alter table learn.catalogue_items enable row level security;
alter table learn.catalogue_segments enable row level security;
alter table learn.catalogue_course_items enable row level security;
alter table learn.catalogue_links enable row level security;

drop policy if exists catalogue_providers_select on learn.catalogue_providers;
create policy catalogue_providers_select on learn.catalogue_providers for select to authenticated
  using (true);

drop policy if exists catalogue_items_select on learn.catalogue_items;
create policy catalogue_items_select on learn.catalogue_items for select to authenticated
  using (true);

drop policy if exists catalogue_segments_select on learn.catalogue_segments;
create policy catalogue_segments_select on learn.catalogue_segments for select to authenticated
  using (true);

drop policy if exists catalogue_course_items_select on learn.catalogue_course_items;
create policy catalogue_course_items_select on learn.catalogue_course_items for select to authenticated
  using (true);

drop policy if exists catalogue_links_select on learn.catalogue_links;
create policy catalogue_links_select on learn.catalogue_links for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists catalogue_links_insert on learn.catalogue_links;
create policy catalogue_links_insert on learn.catalogue_links for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists catalogue_links_delete on learn.catalogue_links;
create policy catalogue_links_delete on learn.catalogue_links for delete to authenticated
  using (user_id = (select auth.uid()));

grant select on learn.catalogue_providers to authenticated;
grant select on learn.catalogue_items to authenticated;
grant select on learn.catalogue_segments to authenticated;
grant select on learn.catalogue_course_items to authenticated;
grant select, insert, delete on learn.catalogue_links to authenticated;

grant all on learn.catalogue_providers to service_role;
grant all on learn.catalogue_items to service_role;
grant all on learn.catalogue_segments to service_role;
grant all on learn.catalogue_course_items to service_role;
grant all on learn.catalogue_links to service_role;

revoke all on table learn.catalogue_providers from anon;
revoke all on table learn.catalogue_items from anon;
revoke all on table learn.catalogue_segments from anon;
revoke all on table learn.catalogue_course_items from anon;
revoke all on table learn.catalogue_links from anon;

-- ---------------------------------------------------------------------------
-- The providers named in the spec, disabled until each one's sweep exists.
--
-- Rows rather than an enum, so this is data and not structure. Wikipedia first
-- because it needs no credential and its section structure gives segment
-- boundaries with no transcript work at all.
-- ---------------------------------------------------------------------------
insert into learn.catalogue_providers (slug, name, home_url, licence, ingest_note, youtube_channel_id, enabled)
values
  ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org',
   'CC BY-SA 4.0',
   'REST API, no credential. Sections give segment boundaries directly.',
   null, false),
  ('khan-academy', 'Khan Academy', 'https://www.khanacademy.org',
   'CC BY-NC-SA 3.0',
   'No supported public API: the v1 REST API was withdrawn in 2020 and the host answers 403. Videos come through the YouTube channel; only the unit structure needs the site.',
   null, false),
  ('mit-ocw', 'MIT OpenCourseWare', 'https://ocw.mit.edu',
   'CC BY-NC-SA 4.0',
   'Metadata and playlist order from the YouTube API; transcripts published per lecture on ocw.mit.edu.',
   null, false),
  ('stanford-online', 'Stanford Online', 'https://online.stanford.edu',
   'Standard YouTube licence unless a course states otherwise',
   'YouTube API for metadata and playlists. No published transcripts for most courses, so items land with one whole-work segment.',
   null, false),
  ('yale-courses', 'Yale Courses', 'https://oyc.yale.edu',
   'CC BY-NC-SA 3.0',
   'Metadata and playlist order from the YouTube API; transcripts published per lecture on oyc.yale.edu.',
   null, false),
  ('harvard-online', 'Harvard Online', 'https://pll.harvard.edu',
   'Standard YouTube licence unless a course states otherwise',
   'YouTube API for metadata and playlists. Transcript availability varies per course and has to be checked per playlist.',
   null, false),
  ('ted', 'TED', 'https://www.ted.com',
   'TED talks usage policy, CC BY-NC-ND in most cases',
   'Metadata from the YouTube API; transcripts published per talk on ted.com.',
   null, false)
on conflict (slug) do nothing;
