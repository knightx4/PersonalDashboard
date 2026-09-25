-- The YouTube clip nearest each Learn now card's idea.
--
-- A card's idea is saved as a concept with its claim embedded (0052), and the
-- YouTube library cuts every lecture into timed segments embedded the same
-- way (0042). Both are documents from the same Voyage model, so a card can be
-- given a clip by comparing the two vectors, with no model call and nothing
-- stored: a video added to the library later reaches the cards already
-- written the next time they are dealt.
--
-- The floor is a parameter, defaulting to 0.5. Measured on the live catalogue
-- on 25 September 2026: Wikipedia sections on autoencoders and principal
-- component analysis met their Strang lectures (SVD, change of basis) at
-- 0.49 to 0.56, and unrelated pairs topped out at 0.38 to 0.45. Most cards
-- will get nothing until the library covers what they are about, which is
-- the point of a floor.
--
-- Security invoker, as 0023: `concepts` is limited to the caller's own rows
-- by RLS, and the catalogue is readable by any signed-in account, so nothing
-- here widens what anybody can see.
--
-- The scan is exact, not through the HNSW index. The index filters after it
-- scans, so a claim whose forty nearest segments are all articles would find
-- no video, and turning on pgvector's iterative scan inside the function is
-- not permitted on this project. Ordering by the distance plus zero keeps the
-- planner off the index. The library holds a few hundred video segments, so an
-- exact scan per card is cheap; revisit it when that is tens of thousands.

set search_path = learn, public, extensions;

create or replace function learn.video_clips_for_concepts(
  concept_ids uuid[],
  min_similarity double precision default 0.5
)
returns table (
  concept_id uuid,
  segment_id uuid,
  item_title text,
  item_canonical_url text,
  t_start_seconds int,
  t_end_seconds int,
  similarity double precision
)
language sql
stable
security invoker
set search_path = learn, extensions, pg_temp
as $$
  select c.id,
         near.segment_id,
         near.title,
         near.canonical_url,
         near.t_start_seconds,
         near.t_end_seconds,
         near.similarity
    from learn.concepts c
    cross join lateral (
      select s.id as segment_id,
             i.title,
             i.canonical_url,
             s.t_start_seconds,
             s.t_end_seconds,
             (1 - (s.embedding <=> c.embedding))::double precision as similarity
        from learn.catalogue_segments s
        join learn.catalogue_items i on i.id = s.item_id
       where i.kind = 'video'
         and s.embedding is not null
       order by (s.embedding <=> c.embedding) + 0
       limit 1
    ) near
   where c.id = any(concept_ids[1:50])
     and c.embedding is not null
     and near.similarity >= coalesce(min_similarity, 0.5)
$$;

comment on function learn.video_clips_for_concepts(uuid[], double precision) is
  'The nearest YouTube catalogue segment to each given concept, above min_similarity.';

revoke all on function learn.video_clips_for_concepts(uuid[], double precision)
  from public, anon;
grant execute on function learn.video_clips_for_concepts(uuid[], double precision)
  to authenticated, service_role;
