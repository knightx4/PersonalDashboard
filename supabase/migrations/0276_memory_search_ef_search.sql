-- Widen the index walk core.search_memory makes (0275), and set it where
-- the database allows.
--
-- At ef_search 100, a recall narrowed to the vault's notes shared 33 of its
-- 50 passages with the exact search over the same rows; at 400 it shared 48,
-- in 17ms. A recall narrowed to a few small tables is planned as an exact scan
-- of memory_chunks_user_source_idx instead, about 25ms, so this changes
-- nothing there.
--
-- 0275 put both hnsw settings on the function itself (`set hnsw... = ...`).
-- That went through once, and every later attempt, `alter function` or
-- `create or replace`, was refused with "permission denied to set parameter":
-- the project lets a role set these for a transaction but not store them on a
-- function. So the function is plpgsql and sets them with set_config(..., true),
-- for the transaction the call runs in, before the search.

set search_path = core, public, extensions;

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
language plpgsql
stable
security invoker
set search_path = core, extensions, pg_temp
as $$
begin
  perform set_config('hnsw.iterative_scan', 'strict_order', true);
  perform set_config('hnsw.ef_search', '400', true);
  return query
    with query as materialized (
      select query_embedding::extensions.vector as v
    )
    select near.id, near.source_table, near.source_ref, near.chunk_index, near.author,
           near.body, (1 - near.distance)::double precision
      from (
        -- The query vector is a scalar subquery, so the order by compares the
        -- indexed expression with a value and the planner can walk the index.
        select c.id, c.source_table, c.source_ref, c.chunk_index, c.author, c.body,
               c.embedding <=> (select q.v from query q) as distance
          from core.memory_chunks c
         where c.user_id = p_user_id
           and (p_sources is null or c.source_table = any (p_sources))
           and (p_authors is null or c.author = any (p_authors))
           and (embedding_model_filter is null or c.embedding_model = embedding_model_filter)
         order by c.embedding::extensions.halfvec(1024) <=> (select q.v::extensions.halfvec(1024) from query q)
         limit least(greatest(coalesce(match_limit, 10), 1), 50)
      ) near
     where 1 - near.distance >= coalesce(min_similarity, 0)
     order by near.distance, near.source_table, near.source_ref, near.chunk_index;
end;
$$;
comment on function core.search_memory(text, uuid, text[], int, double precision, text, text[]) is
  'One person''s passages nearest a query vector by cosine similarity, closest first, above min_similarity (plan #1246). Walks memory_chunks_embedding_idx.';
