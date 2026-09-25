-- Choosing which listed videos to transcribe, by what Learn knows you study.
--
-- The YouTube library lists every upload of a followed channel, and twelve
-- channels hold about 22,000 videos. A transcript costs one TranscriptAPI
-- credit and the plan gives 1,000 a month, so most videos will never be
-- transcribed, and a video with no transcript has no clips for a Learn now
-- card to show. This spends the credits on the videos nearest your own ideas.
--
-- Three parts.
--
--   **A vector for each video's title and description.** Embedded by the
--   scheduled run with the same Voyage model as everything else, as a
--   document, so it compares with the concept embeddings `feed` writes. It is
--   a guess at what the video covers, good enough to choose what to pay for
--   and never shown as a match on a card: cards match on transcript segments
--   (0058), which say what was actually said.
--
--   **`videos_to_transcribe`.** For each of the owner's concepts, its nearest
--   few videos by that vector, then each video's best match, then the ones
--   not already queued, fetched or found to have no captions, strongest
--   first. The nearest-few cut is taken before the transcribed ones are
--   dropped, on purpose: once a concept's nearest videos are transcribed it
--   has what it needs, and it stops pulling in weaker ones.
--
--   **`match` as a reason a transcript was asked for**, beside a press, a
--   channel's auto-transcribe and a playlist pulled as a course.
--
-- The writes go through `store_video_metadata_embeddings`, one call per
-- batch, because PostgREST would otherwise take one request per row.

set search_path = learn, public, extensions;

alter table learn.catalogue_items
  add column if not exists metadata_embedding extensions.vector(1024),
  add column if not exists metadata_embedding_model text,
  add column if not exists metadata_embedded_at timestamptz;

create index if not exists catalogue_items_metadata_embedding_idx
  on learn.catalogue_items
  using hnsw (metadata_embedding extensions.vector_cosine_ops)
  where metadata_embedding is not null;

alter table learn.video_transcripts drop constraint if exists video_transcripts_requested_by_ck;
alter table learn.video_transcripts add constraint video_transcripts_requested_by_ck
  check (requested_by in ('press', 'auto', 'course', 'match'));

-- ---------------------------------------------------------------------------
-- Store one batch of title-and-description vectors.
-- ---------------------------------------------------------------------------
create or replace function learn.store_video_metadata_embeddings(
  item_ids uuid[],
  vectors text[],
  model text
)
returns int
language sql
security invoker
set search_path = learn, extensions, pg_temp
as $$
  with written as (
    update learn.catalogue_items i
       set metadata_embedding = v.vector::extensions.vector,
           metadata_embedding_model = model,
           metadata_embedded_at = now()
      from unnest(item_ids, vectors) as v(id, vector)
     where i.id = v.id
       and i.kind = 'video'
    returning 1
  )
  select count(*)::int from written
$$;

-- ---------------------------------------------------------------------------
-- The untranscribed videos nearest the owner's concepts, strongest first.
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
         order by i.metadata_embedding <=> c.embedding
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

-- Both run under the service role from the scheduled run, and neither is for
-- a signed-in session: one writes the shared catalogue, the other reads a
-- named user's concepts.
revoke all on function learn.store_video_metadata_embeddings(uuid[], text[], text) from public, anon, authenticated;
grant execute on function learn.store_video_metadata_embeddings(uuid[], text[], text) to service_role;
revoke all on function learn.videos_to_transcribe(uuid, int, double precision, int) from public, anon, authenticated;
grant execute on function learn.videos_to_transcribe(uuid, int, double precision, int) to service_role;
