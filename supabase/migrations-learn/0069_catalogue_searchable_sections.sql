-- Stub sections and link lists are stored but never matched against a claim.
--
-- The section trial on #760 (docs/trials/2026-09-26-wikipedia-sections.md)
-- found that article sections under 300 characters were accepted 0 times in
-- 13, and that See also, External links and the like came up as close matches
-- for almost every claim without teaching any of them. When this was applied
-- the backfill below marked 632 of the live catalogue's 4,075 article sections
-- and cleared the vectors on the 182 of those that had one.
--
-- `searchable` says whether a claim may be matched against a segment. The
-- Wikipedia cutter sets it by the rule in lib/learn/catalogue/searchable.ts;
-- every other writer leaves the default, so lecture segments stay searchable.
-- The rows themselves stay, because a reading queued on one of them points at
-- its segment and has to keep opening.
--
-- Three things follow from it here:
--
--   1. The check constraint refuses a vector on a segment that is not
--      searchable. The embedding sweep skips those rows, and the article
--      writers clear the vector in the same statement that marks a row, so
--      nothing should ever hit it. It is there so a writer that forgets gets
--      an error instead of a stub back in every claim's candidates.
--   2. `nearest_catalogue_segments` filters on the column as well. That is
--      redundant with the constraint and costs nothing, and it keeps the
--      function correct on its own terms.
--   3. The partial index the sweep reads is narrowed to searchable rows, so
--      the stubs do not sit in the "still to embed" list for ever.
--
-- The backfill restates the rule in SQL, once, for the rows written before
-- the cutter knew it: trimmed text under 300 characters, or a heading that is
-- exactly one of the eight names (case and spacing aside). It only touches
-- article segments. Clearing those vectors is recoverable: marking a row
-- searchable again lets the next embedding pass write a new one.

set search_path = learn, public, extensions;

alter table learn.catalogue_segments
  add column if not exists searchable boolean not null default true;

comment on column learn.catalogue_segments.searchable is
  'False for an article section too short (under 300 characters) or too list-like (See also, External links, ...) to match a claim against. Such a row is kept so readings queued on it still open, but it holds no vector and is never a candidate. Set by lib/learn/catalogue/searchable.ts.';

update learn.catalogue_segments s
   set searchable = false,
       embedding = null,
       embedding_model = null,
       embedded_at = null
  from learn.catalogue_items i
 where i.id = s.item_id
   and i.kind = 'article'
   and s.searchable
   and (
     char_length(btrim(s.text)) < 300
     or lower(regexp_replace(btrim(coalesce(s.heading, '')), '\s+', ' ', 'g')) in (
       'see also', 'external links', 'references', 'further reading', 'notes',
       'bibliography', 'sources', 'works cited'
     )
   );

alter table learn.catalogue_segments
  drop constraint if exists catalogue_segments_searchable_ck;
alter table learn.catalogue_segments
  add constraint catalogue_segments_searchable_ck check (searchable or embedding is null);

drop index if exists learn.catalogue_segments_unembedded_idx;
create index if not exists catalogue_segments_unembedded_idx
  on learn.catalogue_segments (item_id, ordinal)
  where embedding is null and searchable;

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
  select near.id,
         near.item_id,
         near.ordinal,
         near.heading,
         near.section_anchor,
         near.t_start_seconds,
         near.t_end_seconds,
         near.text,
         near.embedding_model,
         (1 - near.distance)::double precision,
         i.title,
         i.kind,
         i.canonical_url
    from (
      select s.id,
             s.item_id,
             s.ordinal,
             s.heading,
             s.section_anchor,
             s.t_start_seconds,
             s.t_end_seconds,
             s.text,
             s.embedding_model,
             s.embedding <=> query_embedding::extensions.vector as distance
        from learn.catalogue_segments s
       where s.embedding is not null
         and s.searchable
         and (
           embedding_model_filter is null
           or s.embedding_model = embedding_model_filter
         )
       order by s.embedding <=> query_embedding::extensions.vector
       limit least(greatest(coalesce(match_limit, 40), 1), 200)
    ) near
    join learn.catalogue_items i on i.id = near.item_id
   where 1 - near.distance >= coalesce(min_similarity, 0.5)
   order by near.distance, near.item_id, near.ordinal
$$;

comment on function learn.nearest_catalogue_segments(text, int, double precision, text) is
  'Searchable segments nearest a query vector by cosine similarity, closest first, above min_similarity.';

revoke all on function learn.nearest_catalogue_segments(text, int, double precision, text)
  from public, anon;
grant execute on function learn.nearest_catalogue_segments(text, int, double precision, text)
  to authenticated, service_role;
