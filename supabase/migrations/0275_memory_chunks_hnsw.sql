-- Index the passages recall searches (core.search_memory).
--
-- search_memory compared the question with every one of the person's passages:
-- 14,838 by 21 October 2026, each a vector(1024) of 4KB kept out of line in
-- TOAST, about 60MB read per search. Warm, a search took about a second. Cold,
-- or with Dash running three recalls at once, it passed the 8-second statement
-- timeout, and every recall Dash made from 17 to 19 October failed with "That
-- lookup failed to read the database" ("core.search_memory: canceling
-- statement due to statement timeout" in the function logs).
--
-- The index is HNSW on the vector cast to halfvec, as learn's 0083 did for
-- video titles: two bytes a dimension, so about 40MB rather than 80. The
-- column stays vector(1024), and the similarity search_memory returns is still
-- worked out on the full vectors, so RECALL_MIN_SIMILARITY keeps its meaning.
--
-- The search filters on the person and, often, on a few source tables, which
-- an HNSW scan applies after it walks the graph. pgvector 0.8's iterative scan
-- keeps walking until the limit is met, so a filtered search still returns its
-- 50 closest rather than the few of the first 40 that pass the filter.
-- ef_search is raised past the largest limit (50) for the same reason
-- (0276 raises it further).
--
-- search_memory_from is left as it is: it starts from a row's own passages
-- and is called by routines, not while someone waits on an answer.

set search_path = core, public, extensions;

set local statement_timeout = 0;
set local maintenance_work_mem = '128MB';

create index if not exists memory_chunks_embedding_idx
  on core.memory_chunks
  using hnsw ((embedding::extensions.halfvec(1024)) extensions.halfvec_cosine_ops);

create or replace function core.search_memory(
  query_embedding text,
  p_user_id uuid,
  p_sources text[] default null,
  match_limit int default 10,
  min_similarity double precision default 0,
  embedding_model_filter text default null,
  p_authors text[] default null
)
returns table (
  id uuid,
  source_table text,
  source_ref text,
  chunk_index int,
  author text,
  body text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = core, extensions, pg_temp
set hnsw.iterative_scan = strict_order
set hnsw.ef_search = 100
as $$
  with query as materialized (
    select query_embedding::extensions.vector as v
  )
  select near.id, near.source_table, near.source_ref, near.chunk_index, near.author,
         near.body, (1 - near.distance)::double precision
    from (
      -- The query vector is a scalar subquery, so the order by compares the
      -- indexed expression with a value and the planner can walk the index.
      select c.id, c.source_table, c.source_ref, c.chunk_index, c.author, c.body,
             c.embedding <=> (select v from query) as distance
        from core.memory_chunks c
       where c.user_id = p_user_id
         and (p_sources is null or c.source_table = any (p_sources))
         and (p_authors is null or c.author = any (p_authors))
         and (embedding_model_filter is null or c.embedding_model = embedding_model_filter)
       order by c.embedding::extensions.halfvec(1024) <=> (select v::extensions.halfvec(1024) from query)
       limit least(greatest(coalesce(match_limit, 10), 1), 50)
    ) near
   where 1 - near.distance >= coalesce(min_similarity, 0)
   order by near.distance, near.source_table, near.source_ref, near.chunk_index
$$;
comment on function core.search_memory(text, uuid, text[], int, double precision, text, text[]) is
  'One person''s passages nearest a query vector by cosine similarity, closest first, above min_similarity (plan #1246). Walks memory_chunks_embedding_idx.';
