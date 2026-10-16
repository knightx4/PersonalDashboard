-- Structure documents in the catalogue (plan #2247.1).
--
-- A syllabus, a course calendar, a table of contents or a primary-source
-- index is kept whole once it has been pulled, with where it came from and
-- what it may be used for, so a document pulled for one goal serves the next.
-- The providers that fill this (#2247.3 to #2247.9) and the compiler that
-- reads it (#2247.10) come later; this is the store.
--
-- 1. 'structure' on learn.source_kind
--
-- A structure document is a catalogue_items row of kind 'structure'. Its
-- units (weeks, sessions, chapters, lectures) are catalogue_segments rows in
-- published order, embedded by the existing catalogue sweep, which embeds any
-- searchable segment whatever its item's kind.
--
-- 2. learn.catalogue_structures
--
-- One row per structure item, holding what only a structure document has:
-- the institution, course code and term; the licence mode; the address it
-- was fetched from; the text as pulled; a hash of that text, so an unchanged
-- document is not parsed again (the vault map's blob_sha, here a SHA-256 of
-- the raw text); the textbooks it names; and its outcomes and prerequisites.
-- Shared like the rest of the catalogue: no user_id, readable by any
-- signed-in account, written only by the service role.
--
-- licence_mode is what the material path reads before using a word:
--   show            the text may be shown and given to a model, with attribution
--   structure_only  the order and headings may be used, the text not shown
--   never_feed      nothing beyond the headings may go to a model (OpenStax)
--
-- 3. Unit columns on learn.catalogue_segments
--
-- unit_label is the document's own numbering ("Week 3", "Session 7"),
-- topics the topics the unit lists, and readings what it assigns, as
-- [{"title", "detail"?, "url"?}]. Nullable or defaulted, so every existing
-- segment is unchanged.
--
-- 4. learn.nearest_structure_units
--
-- The units of structure documents nearest a query vector, so a week can be
-- found by what it covers. learn.nearest_catalogue_segments leaves structure
-- units out from here on: a syllabus week is a place in a course, not
-- material to judge against a claim, and a never_feed unit must not reach
-- the judging model.
--
-- The new enum value cannot be used as a literal in the same transaction that
-- adds it, so the statements below compare kind::text.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The kind.
-- ---------------------------------------------------------------------------
alter type learn.source_kind add value if not exists 'structure';

-- ---------------------------------------------------------------------------
-- 2. What a structure document carries.
-- ---------------------------------------------------------------------------
create table if not exists learn.catalogue_structures (
  item_id uuid primary key references learn.catalogue_items (id) on delete cascade,

  institution text,
  course_code text,
  -- As the document gives it: "Fall 2024", "Spring 2019".
  term text,

  licence_mode text not null,
  -- Where the document itself was fetched from, which can differ from the
  -- item's canonical_url (a syllabus PDF behind a course page).
  source_url text not null,
  raw_text text not null,
  content_hash text not null,

  textbooks text[] not null default '{}',
  outcomes jsonb not null default '[]'::jsonb,
  prerequisites jsonb not null default '[]'::jsonb,

  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint catalogue_structures_licence_mode_ck
    check (licence_mode in ('show', 'structure_only', 'never_feed')),
  constraint catalogue_structures_source_url_ck check (source_url ~ '^https://'),
  constraint catalogue_structures_raw_text_ck check (btrim(raw_text) <> ''),
  constraint catalogue_structures_content_hash_ck check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint catalogue_structures_institution_ck check (institution is null or btrim(institution) <> ''),
  constraint catalogue_structures_course_code_ck check (course_code is null or btrim(course_code) <> ''),
  constraint catalogue_structures_term_ck check (term is null or btrim(term) <> ''),
  constraint catalogue_structures_outcomes_ck check (jsonb_typeof(outcomes) = 'array'),
  constraint catalogue_structures_prerequisites_ck check (jsonb_typeof(prerequisites) = 'array')
);

create or replace trigger catalogue_structures_touch_updated_at
  before update on learn.catalogue_structures
  for each row execute function learn.touch_updated_at();

-- Only an item of kind 'structure' has one of these. A foreign key cannot say
-- that, so a trigger does.
create or replace function learn.catalogue_structures_kind_check()
returns trigger
language plpgsql
set search_path = learn, pg_temp
as $$
begin
  if not exists (
    select 1 from learn.catalogue_items i
     where i.id = new.item_id and i.kind::text = 'structure'
  ) then
    raise exception 'catalogue_structures.item_id must be a catalogue item of kind structure';
  end if;
  return new;
end;
$$;

create or replace trigger catalogue_structures_kind_check
  before insert or update of item_id on learn.catalogue_structures
  for each row execute function learn.catalogue_structures_kind_check();

alter table learn.catalogue_structures enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'learn' and tablename = 'catalogue_structures'
       and policyname = 'catalogue_structures_select'
  ) then
    create policy catalogue_structures_select on learn.catalogue_structures
      for select to authenticated using (true);
  end if;
end;
$$;

grant select on learn.catalogue_structures to authenticated;
grant all on learn.catalogue_structures to service_role;
revoke all on table learn.catalogue_structures from anon;

-- ---------------------------------------------------------------------------
-- 3. A unit's numbering, topics and readings.
-- ---------------------------------------------------------------------------
alter table learn.catalogue_segments
  add column if not exists unit_label text
    constraint catalogue_segments_unit_label_ck check (unit_label is null or btrim(unit_label) <> ''),
  add column if not exists topics text[] not null default '{}',
  add column if not exists readings jsonb not null default '[]'::jsonb
    constraint catalogue_segments_readings_ck check (jsonb_typeof(readings) = 'array');

-- ---------------------------------------------------------------------------
-- 4. Finding a unit by what it covers.
-- ---------------------------------------------------------------------------
create or replace function learn.nearest_structure_units(
  query_embedding text,
  match_limit int default 40,
  min_similarity double precision default 0.5
)
returns table (
  segment_id uuid,
  item_id uuid,
  ordinal int,
  unit_label text,
  heading text,
  topics text[],
  readings jsonb,
  similarity double precision,
  item_title text,
  canonical_url text,
  institution text,
  course_code text,
  term text,
  licence_mode text
)
language sql
stable
security invoker
set search_path = learn, extensions, pg_temp
as $$
  with lim as (
    select least(greatest(coalesce(match_limit, 40), 1), 200) as n
  ),
  near as (
    select s.id,
           s.embedding <=> query_embedding::extensions.vector as distance
      from learn.catalogue_segments s
      join learn.catalogue_items i on i.id = s.item_id
     where s.embedding is not null
       and s.searchable
       and i.kind::text = 'structure'
     order by s.embedding <=> query_embedding::extensions.vector
     limit (select n from lim)
  )
  select s.id,
         s.item_id,
         s.ordinal,
         s.unit_label,
         s.heading,
         s.topics,
         s.readings,
         (1 - near.distance)::double precision,
         i.title,
         i.canonical_url,
         c.institution,
         c.course_code,
         c.term,
         c.licence_mode
    from near
    join learn.catalogue_segments s on s.id = near.id
    join learn.catalogue_items i on i.id = s.item_id
    join learn.catalogue_structures c on c.item_id = i.id
   where 1 - near.distance >= coalesce(min_similarity, 0.5)
   order by near.distance, s.item_id, s.ordinal
$$;

comment on function learn.nearest_structure_units(text, int, double precision) is
  'Units of structure documents nearest a query vector by cosine similarity, closest first, above min_similarity, with the document they belong to and its licence mode.';

revoke all on function learn.nearest_structure_units(text, int, double precision)
  from public, anon;
grant execute on function learn.nearest_structure_units(text, int, double precision)
  to authenticated, service_role;

-- The claim search, as 0070 wrote it, with structure units left out.
create or replace function learn.nearest_catalogue_segments(
  query_embedding text,
  match_limit int default 40,
  min_similarity double precision default 0.5,
  embedding_model_filter text default null
)
returns table (
  segment_id uuid,
  item_id uuid,
  ordinal int,
  heading text,
  section_anchor text,
  t_start_seconds int,
  t_end_seconds int,
  segment_text text,
  embedding_model text,
  similarity double precision,
  item_title text,
  item_kind learn.source_kind,
  item_canonical_url text
)
language sql
stable
security invoker
set search_path = learn, extensions, pg_temp
as $$
  with lim as (
    select least(greatest(coalesce(match_limit, 40), 1), 200) as n
  ),
  by_segment as (
    select s.id,
           s.embedding_model,
           s.embedding <=> query_embedding::extensions.vector as distance
      from learn.catalogue_segments s
      join learn.catalogue_items i on i.id = s.item_id
     where s.embedding is not null
       and s.searchable
       and i.kind::text <> 'structure'
       and (embedding_model_filter is null or s.embedding_model = embedding_model_filter)
       and not exists (select 1 from learn.catalogue_passages p where p.segment_id = s.id)
     order by s.embedding <=> query_embedding::extensions.vector
     limit (select n from lim)
  ),
  near_passages as (
    select p.segment_id,
           p.embedding_model,
           p.embedding <=> query_embedding::extensions.vector as distance
      from learn.catalogue_passages p
     where p.embedding is not null
       and (embedding_model_filter is null or p.embedding_model = embedding_model_filter)
     order by p.embedding <=> query_embedding::extensions.vector
     limit (select n * 4 from lim)
  ),
  by_passage as (
    select distinct on (np.segment_id)
           np.segment_id as id, np.embedding_model, np.distance
      from near_passages np
     order by np.segment_id, np.distance
  ),
  near as (
    select * from by_segment
    union all
    select * from by_passage
  )
  select s.id,
         s.item_id,
         s.ordinal,
         s.heading,
         s.section_anchor,
         s.t_start_seconds,
         s.t_end_seconds,
         s.text,
         near.embedding_model,
         (1 - near.distance)::double precision,
         i.title,
         i.kind,
         i.canonical_url
    from near
    join learn.catalogue_segments s on s.id = near.id
    join learn.catalogue_items i on i.id = s.item_id
   where s.searchable
     and i.kind::text <> 'structure'
     and 1 - near.distance >= coalesce(min_similarity, 0.5)
   order by near.distance, s.item_id, s.ordinal
   limit (select n from lim)
$$;

comment on function learn.nearest_catalogue_segments(text, int, double precision, text) is
  'Searchable segments nearest a query vector by cosine similarity, closest first, above min_similarity. An article section is scored by its best passage in catalogue_passages; its own vector is read only while it has no passages. Units of structure documents are left out; learn.nearest_structure_units reads those.';

revoke all on function learn.nearest_catalogue_segments(text, int, double precision, text)
  from public, anon;
grant execute on function learn.nearest_catalogue_segments(text, int, double precision, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The providers #2247.4 to #2247.8 pull from, off until each one's code
-- exists. MIT OpenCourseWare and Yale Courses are already here from 0022.
-- ---------------------------------------------------------------------------
insert into learn.catalogue_providers (slug, name, home_url, licence, ingest_note, enabled)
values
  ('ut-austin', 'UT Austin public syllabi', 'https://utdirect.utexas.edu',
   'Copyright of each instructor; structure only',
   'A plain GET form by year, semester and department; the syllabus is a PDF download. Rows that link Simple Syllabus need JavaScript and are recorded as not fetchable.',
   false),
  ('arxiv', 'arXiv', 'https://arxiv.org',
   'Per paper, as arXiv records it',
   'The HTML rendering of a paper by its id; section headings give the units.',
   false),
  ('openstax', 'OpenStax', 'https://openstax.org',
   'CC BY 4.0, and OpenStax forbids feeding the text to a model',
   'A book''s table of contents by its slug. Headings only; licence mode never_feed.',
   false),
  ('federal-reserve', 'Federal Reserve', 'https://www.federalreserve.gov',
   'US government work, public domain',
   'Chapter pages of The Fed Explained, parsed from an allowlisted host.',
   false),
  ('avalon', 'The Avalon Project', 'https://avalon.law.yale.edu',
   'Yale Law School; terms as each document states',
   'Document menus by century, parsed from an allowlisted host.',
   false)
on conflict (slug) do nothing;
