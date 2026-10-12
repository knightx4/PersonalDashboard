-- The positions on the vault map nearest a piece of text (plan #1863.8,
-- LEARN-ESSAYS-SPEC "From your study").
--
-- The essay page's study panel searches with the paragraph being written and
-- lists your positions beside it, each with a checked quote from the note it
-- came from. Positions already carry a Voyage vector (0006), in the same
-- model and size as note blocks, so one embedding of the paragraph searches
-- both.
--
-- A position whose notes are all gone (`ungrounded_at`) is left out: it has no
-- quote to show. The quote is the oldest from a live note; the theme is the
-- first the position sits under, for the link to the map.

set search_path = obsidian, public, extensions;

create or replace function obsidian.nearest_positions(
  query_embedding text,
  p_user_id uuid default null,
  match_limit int default 3,
  min_similarity double precision default 0,
  embedding_model_filter text default null
)
returns table (
  position_id uuid,
  name text,
  statement text,
  theme_id uuid,
  note_id uuid,
  path text,
  title text,
  quote text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
  with query as materialized (
    select query_embedding::extensions.vector as v
  ),
  wanted as materialized (
    select least(greatest(coalesce(match_limit, 3), 1), 20) as k
  ),
  near as (
    select p.id, p.name, p.statement, p.embedding <=> query.v as distance
      from query
     cross join obsidian.positions p
     where p.embedding is not null
       and p.ungrounded_at is null
       and (p_user_id is null or p.user_id = p_user_id)
       and (embedding_model_filter is null or p.embedding_model = embedding_model_filter)
     order by (p.embedding <=> query.v) + 0
     limit (select k + 10 from wanted)
  )
  select near.id, near.name, near.statement,
         (select tp.theme_id from obsidian.theme_positions tp
           where tp.position_id = near.id order by tp.created_at limit 1),
         src.note_id, src.path, src.title, src.quote,
         (1 - near.distance)::double precision
    from near
    join lateral (
      select s.note_id, n.path, n.title, s.quote
        from obsidian.position_sources s
        join obsidian.notes n on n.id = s.note_id
       where s.position_id = near.id
         and n.deleted_at is null
       order by s.created_at
       limit 1
    ) src on true
   where 1 - near.distance >= coalesce(min_similarity, 0)
   order by near.distance
   limit (select k from wanted)
$$;

comment on function obsidian.nearest_positions(text, uuid, int, double precision, text) is
  'Positions on the vault map nearest a query vector, closest first, each with its oldest quote from a live note (plan #1863.8).';

revoke all on function obsidian.nearest_positions(text, uuid, int, double precision, text) from public, anon;
grant execute on function obsidian.nearest_positions(text, uuid, int, double precision, text)
  to authenticated, service_role;
