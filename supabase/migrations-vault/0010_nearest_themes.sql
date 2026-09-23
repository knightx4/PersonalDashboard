-- The themes nearest a note, for the extractor to reuse (plan #818).
--
-- Reading a note offered the model the 200 strongest theme names. A note on a
-- subject outside those 200 was shown nothing close and coined a new theme,
-- which is how 540 of the first sweep's 685 themes came to cover one note
-- each. lib/vault/map/themes.ts now embeds the note, asks this function for
-- the themes closest to it, and offers those alongside the strongest few.
--
-- This is an exact scan, not a walk of themes_embedding_idx. An HNSW scan
-- returns at most hnsw.ef_search rows (40 by default), fewer than the 150
-- the extractor asks for, and the migration role is refused permission to
-- set it on a function. One person has hundreds of themes, a few
-- thousand at most, and comparing a vector with each of them is a few
-- milliseconds. Ordering by the distance plus zero is what keeps the planner
-- off the index. The floor is applied after the cap.
--
-- Themes with no vector are skipped: a theme renamed or merged loses its
-- vector until the next embedding pass, and is offered through the strongest
-- list in the meantime. `p_user_id` null means whoever RLS lets the caller
-- see; the service-role sweep passes the owner so one person's themes are
-- never offered with another's note.

set search_path = obsidian, public, extensions;

create or replace function obsidian.nearest_themes(
  query_embedding text,
  p_user_id uuid default null,
  match_limit int default 150,
  min_similarity double precision default 0,
  embedding_model_filter text default null
)
returns table (
  id uuid,
  name text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
  select near.id, near.name, (1 - near.distance)::double precision
    from (
      select t.id,
             t.name,
             t.embedding <=> query_embedding::extensions.vector as distance
        from obsidian.themes t
       where t.embedding is not null
         and (p_user_id is null or t.user_id = p_user_id)
         and (embedding_model_filter is null or t.embedding_model = embedding_model_filter)
       order by (t.embedding <=> query_embedding::extensions.vector) + 0
       limit least(greatest(coalesce(match_limit, 150), 1), 200)
    ) near
   where 1 - near.distance >= coalesce(min_similarity, 0)
   order by near.distance, near.name
$$;

comment on function obsidian.nearest_themes(text, uuid, int, double precision, text) is
  'Themes nearest a query vector by cosine similarity, closest first, above min_similarity.';

revoke all on function obsidian.nearest_themes(text, uuid, int, double precision, text)
  from public, anon;
grant execute on function obsidian.nearest_themes(text, uuid, int, double precision, text)
  to authenticated, service_role;
