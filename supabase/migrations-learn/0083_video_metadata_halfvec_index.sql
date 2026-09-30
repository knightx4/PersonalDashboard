-- Index video title vectors as halfvec (plan #1243).
--
-- Every vector store_video_metadata_embeddings writes also goes into the HNSW
-- index on catalogue_items.metadata_embedding (0059). At 1024 dimensions in
-- single precision that index was 118MB by 30 September 2026 against 224MB
-- of shared_buffers, so each insert read graph pages from disk: a store of 32
-- rows took 14.9 seconds at 15,048 vectors, about 470ms a row, and the
-- scheduled run's 8-second statement timeout cancelled every chunk of 32
-- from 07:53 UTC on 29 September.
--
-- The index is rebuilt on the vector cast to halfvec, which stores each
-- dimension in two bytes and so halves the index. The column stays
-- vector(1024), so what is stored and what the embedding call writes do not
-- change. videos_to_transcribe orders by the same cast, which is what lets
-- the planner use the new index; the similarity it returns is still worked
-- out on the full vectors, so MATCH_MIN_SIMILARITY keeps its meaning.
--
-- The drop and the build run in one transaction, so the table is locked for
-- writes while the index builds and a store that arrives meanwhile waits
-- rather than fails. Rebuilt this way on 30 September at 15,048 vectors, the
-- new index was 39MB, and a store of 32 took 84 to 190ms once it was cached
-- (4 seconds on the first write after the build). The build is given
-- more memory than the 32MB default so the graph is built in memory, and no
-- statement timeout, which the connector otherwise applies at two minutes.

set search_path = learn, public, extensions;

set local statement_timeout = 0;
set local maintenance_work_mem = '128MB';

drop index if exists learn.catalogue_items_metadata_embedding_idx;

create index catalogue_items_metadata_embedding_idx
  on learn.catalogue_items
  using hnsw ((metadata_embedding::extensions.halfvec(1024)) extensions.halfvec_cosine_ops)
  where metadata_embedding is not null;

-- ---------------------------------------------------------------------------
-- The untranscribed videos nearest the owner's concepts, strongest first.
-- As 0059, with the nearest-few search ordered by the halfvec cast.
-- ---------------------------------------------------------------------------
create or replace function learn.videos_to_transcribe(
  owner_id uuid,
  per_concept int default 3,
  min_similarity double precision default 0.45,
  match_limit int default 60
)
returns table (
  video_id text,
  item_title text,
  concept_name text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = learn, extensions, pg_temp
as $$
  with near as (
    select v.external_id,
           v.title,
           c.name,
           (1 - v.distance)::double precision as similarity
      from learn.concepts c
      cross join lateral (
        select i.external_id,
               i.title,
               i.metadata_embedding <=> c.embedding as distance
          from learn.catalogue_items i
         where i.metadata_embedding is not null
         order by i.metadata_embedding::extensions.halfvec(1024)
                  <=> c.embedding::extensions.halfvec(1024)
         limit least(greatest(coalesce(per_concept, 3), 1), 20)
      ) v
     where c.user_id = owner_id
       and c.embedding is not null
  ),
  best as (
    select distinct on (external_id) external_id, title, name, similarity
      from near
     order by external_id, similarity desc
  )
  select b.external_id, b.title, b.name, b.similarity
    from best b
   where b.similarity >= coalesce(min_similarity, 0.45)
     and not exists (select 1 from learn.video_transcripts t where t.video_id = b.external_id)
   order by b.similarity desc, b.external_id
   limit least(greatest(coalesce(match_limit, 60), 1), 500)
$$;

revoke all on function learn.videos_to_transcribe(uuid, int, double precision, int) from public, anon, authenticated;
grant execute on function learn.videos_to_transcribe(uuid, int, double precision, int) to service_role;
