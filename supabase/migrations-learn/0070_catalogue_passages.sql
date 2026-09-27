-- Paragraph passages inside article sections, for search only (plan #1132).
--
-- The section trial on #760 (docs/trials/2026-09-26-wikipedia-sections.md)
-- found 11 of 25 claims had a section that teaches them scoring under the 0.5
-- floor, because a section's vector averages everything the section covers:
-- the Tell lead mentions Alexander's conquest in one sentence and the conquest
-- claims reached it at 0.33 to 0.42. So each searchable article section is cut
-- a second time into passages of about 300 to 800 characters
-- (lib/learn/catalogue/passages.ts), and each passage is embedded.
--
-- A passage is not a thing anybody reads, links or queues. It points at its
-- section, and the nearest search scores a section by its best passage and
-- returns the section, so catalogue links, judgements and readings keep naming
-- the section. That is why this is its own table rather than more rows in
-- catalogue_segments: nothing that reads segments has to learn to skip them.
--
-- Rows are written by the article writers (store.ts, store-rest.ts) from the
-- section text, keyed on (segment_id, ordinal), and a passage whose text
-- changed loses its vector, the same rule the segments keep. A section that is
-- deleted takes its passages with it.
--
-- `nearest_catalogue_segments` changes in one way: an article section is
-- scored by its best passage. The section's own vector is still read, but
-- only for a section that has no passages yet, so the articles stored before
-- this keep being found until #1133 backfills their passages. After that no
-- article section vector is read, and those vectors can be left in place.
-- Lecture segments are searched exactly as before.

set search_path = learn, public, extensions;

create table if not exists learn.catalogue_passages (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references learn.catalogue_segments (id) on delete cascade,
  ordinal int not null,
  text text not null,
  embedding extensions.vector(1024),
  embedding_model text,
  embedded_at timestamptz,
  created_at timestamptz not null default now(),

  constraint catalogue_passages_ordinal_uq unique (segment_id, ordinal),
  constraint catalogue_passages_ordinal_ck check (ordinal >= 0),
  constraint catalogue_passages_text_ck check (btrim(text) <> ''),
  constraint catalogue_passages_embedding_ck check (
    (embedding is null) = (embedding_model is null)
  ),
  constraint catalogue_passages_embedded_at_ck check (
    (embedding is null) = (embedded_at is null)
  )
);

comment on table learn.catalogue_passages is
  'Paragraph passages of about 300 to 800 characters cut from searchable article sections (lib/learn/catalogue/passages.ts). Search only: the nearest search scores a section by its best passage and returns the section, so links, judgements and readings name the section.';

create index if not exists catalogue_passages_embedding_idx
  on learn.catalogue_passages using hnsw (embedding extensions.vector_cosine_ops);

-- What the embedding sweep reads: passages still without a vector.
create index if not exists catalogue_passages_unembedded_idx
  on learn.catalogue_passages (segment_id, ordinal)
  where embedding is null;

-- What the read button reads to decide whether anything new has arrived.
create index if not exists catalogue_passages_embedded_at_idx
  on learn.catalogue_passages (embedded_at)
  where embedded_at is not null;

alter table learn.catalogue_passages enable row level security;

drop policy if exists catalogue_passages_select on learn.catalogue_passages;
create policy catalogue_passages_select on learn.catalogue_passages for select to authenticated
  using (true);

grant select on learn.catalogue_passages to authenticated;
grant all on learn.catalogue_passages to service_role;
revoke all on table learn.catalogue_passages from anon;

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
  -- Segments by their own vector: every lecture segment, and an article
  -- section only while it has no passages.
  by_segment as (
    select s.id,
           s.embedding_model,
           s.embedding <=> query_embedding::extensions.vector as distance
      from learn.catalogue_segments s
     where s.embedding is not null
       and s.searchable
       and (embedding_model_filter is null or s.embedding_model = embedding_model_filter)
       and not exists (select 1 from learn.catalogue_passages p where p.segment_id = s.id)
     order by s.embedding <=> query_embedding::extensions.vector
     limit (select n from lim)
  ),
  -- Passages nearest the query. Several can belong to one section, so more
  -- are read than sections are wanted, and the best per section is kept.
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
     and 1 - near.distance >= coalesce(min_similarity, 0.5)
   order by near.distance, s.item_id, s.ordinal
   limit (select n from lim)
$$;

comment on function learn.nearest_catalogue_segments(text, int, double precision, text) is
  'Searchable segments nearest a query vector by cosine similarity, closest first, above min_similarity. An article section is scored by its best passage in catalogue_passages; its own vector is read only while it has no passages.';

revoke all on function learn.nearest_catalogue_segments(text, int, double precision, text)
  from public, anon;
grant execute on function learn.nearest_catalogue_segments(text, int, double precision, text)
  to authenticated, service_role;
