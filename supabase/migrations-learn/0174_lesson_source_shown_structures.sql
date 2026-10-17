-- The lesson writer's catalogue search reads shown structure documents too
-- (plan #2292.1).
--
-- A lesson is checked against the one catalogue section closest to its
-- idea's claim (lib/learn/lessons/closest-source.ts). Since 0160 the claim
-- search, learn.nearest_catalogue_segments, leaves every structure unit out,
-- because a never_feed unit must not reach a model. A prepared subject's
-- lessons are written from the same syllabi its territory was compiled from,
-- and a unit of one whose licence is show may be shown and given to a model
-- with attribution.
--
-- learn.nearest_lesson_segments is the claim search with those units added:
-- what learn.nearest_catalogue_segments returns, plus units of structure
-- documents whose licence_mode is show. structure_only and never_feed units
-- stay out. learn.nearest_catalogue_segments itself is unchanged, so the read
-- button and the claim judge still never see a syllabus week.
--
-- It returns the same columns, so the same reader maps both. No row is
-- written.

set search_path = learn, public, extensions;

create or replace function learn.nearest_lesson_segments(
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
  shown as (
    select s.id,
           s.embedding_model,
           s.embedding <=> query_embedding::extensions.vector as distance
      from learn.catalogue_segments s
      join learn.catalogue_items i on i.id = s.item_id
      join learn.catalogue_structures c on c.item_id = i.id
     where s.embedding is not null
       and s.searchable
       and i.kind::text = 'structure'
       and c.licence_mode = 'show'
       and (embedding_model_filter is null or s.embedding_model = embedding_model_filter)
     order by s.embedding <=> query_embedding::extensions.vector
     limit (select n from lim)
  ),
  both_sides as (
    select n.segment_id, n.item_id, n.ordinal, n.heading, n.section_anchor, n.t_start_seconds,
           n.t_end_seconds, n.segment_text, n.embedding_model, n.similarity, n.item_title,
           n.item_kind, n.item_canonical_url
      from learn.nearest_catalogue_segments(query_embedding, match_limit, min_similarity, embedding_model_filter) n
    union all
    select s.id, s.item_id, s.ordinal, s.heading, s.section_anchor, s.t_start_seconds,
           s.t_end_seconds, s.text, shown.embedding_model, (1 - shown.distance)::double precision, i.title,
           i.kind, i.canonical_url
      from shown
      join learn.catalogue_segments s on s.id = shown.id
      join learn.catalogue_items i on i.id = s.item_id
     where 1 - shown.distance >= coalesce(min_similarity, 0.5)
  )
  select *
    from both_sides
   order by similarity desc, item_id, ordinal
   limit (select n from lim)
$$;

comment on function learn.nearest_lesson_segments(text, int, double precision, text) is
  'The lesson writer''s claim search: learn.nearest_catalogue_segments plus units of structure documents whose licence_mode is show, closest first. structure_only and never_feed units are left out (plan #2292.1).';

revoke all on function learn.nearest_lesson_segments(text, int, double precision, text)
  from public, anon;
grant execute on function learn.nearest_lesson_segments(text, int, double precision, text)
  to authenticated, service_role;
