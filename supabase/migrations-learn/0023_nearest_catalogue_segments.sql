-- Finding the segments nearest a claim.
--
-- 0022 gave `catalogue_segments` an embedding and an HNSW index over it, and
-- the sweep above this fills them in. Nothing has read that index yet. This is
-- the read, written as a function because the caller that matters is a server
-- action holding a session client.
--
-- Why a function rather than a select the application writes. The catalogue is
-- reference data any signed-in account may read, so the read needs no
-- privilege it does not already have; `catalogue_segments_select` is `using
-- (true)` and this runs as the caller, so nothing here widens what anybody can
-- see. What the application cannot express is the ordering: PostgREST has no
-- way to say "order by this operator against that vector", and `<=>` against
-- the HNSW index is the whole of the query.
--
-- Two things here are easy to get wrong and expensive to notice.
--
--   **`extensions` is not on the default search path.** pgvector was installed
--   there by 0022, so the type, the cast and the operator class are written
--   qualified, and the function sets a path that includes it. A bare `::vector`
--   does not resolve from `learn`.
--
--   **The query vector arrives as text.** `[0.1,0.2,...]` is what Postgres
--   parses into a vector, and taking it as `text` keeps the conversion out of
--   the JSON handling between supabase-js and PostgREST, where a 1024-number
--   array has a longer way to go and more places to be quietly rounded. The
--   caller builds the literal with `vectorLiteral` in
--   lib/learn/catalogue/embed-sweep.ts, which refuses anything not 1024 wide.
--
-- `min_similarity` is a parameter with a default rather than a constant in the
-- query. Every segment this returns costs one model call in the judging pass
-- above it, so the floor is what keeps that cost tied to how much material
-- actually speaks to the claim rather than to how much material exists. The
-- number that separates "about this claim" from "same general subject" is a
-- property of the embedding model, and this database has no embedded segments
-- yet to measure it on, so the default is a starting point and the caller
-- passes its own once there is something to calibrate against.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- The nearest segments to one vector, with the floor and the cap applied.
--
-- The cap is applied to the index scan and the floor afterwards. That order
-- matters: filtering on distance inside the scan makes HNSW keep searching for
-- rows that clear it, which for a claim the catalogue does not cover means
-- walking the graph for neighbours that are never going to exist. Taking the
-- nearest `match_limit` and then dropping the weak ones costs one bounded scan
-- and returns nothing when nothing is close.
--
-- Similarity rather than distance in the result, because that is what the rest
-- of the feature talks in: `catalogue_links` records how good a match was, and
-- 1 is a perfect one everywhere else that number is shown.
-- ---------------------------------------------------------------------------
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
         and (
           embedding_model_filter is null
           or s.embedding_model = embedding_model_filter
         )
       order by s.embedding <=> query_embedding::extensions.vector
       limit least(greatest(coalesce(match_limit, 40), 1), 200)
    ) near
    join learn.catalogue_items i on i.id = near.item_id
   where 1 - near.distance >= coalesce(min_similarity, 0.5)
   -- The tiebreak is there so two segments at the same distance come back in
   -- the same order every time, which is what lets a repeat press show the
   -- same list.
   order by near.distance, near.item_id, near.ordinal
$$;

comment on function learn.nearest_catalogue_segments(text, int, double precision, text) is
  'Segments nearest a query vector by cosine similarity, closest first, above min_similarity.';

-- Execute is granted to PUBLIC by default, which would include `anon`. The
-- catalogue is not secret, but an unauthenticated caller has no business
-- spending index scans here.
revoke all on function learn.nearest_catalogue_segments(text, int, double precision, text)
  from public, anon;
grant execute on function learn.nearest_catalogue_segments(text, int, double precision, text)
  to authenticated, service_role;
