-- The merge searches planned with their arguments in hand (plan #836).
--
-- obsidian.theme_merge_candidates (0007) is a SQL function, and Postgres 17
-- plans the body of one with its arguments as unknowns. With the neighbour
-- count unknown, the planner does not use themes_embedding_idx for the
-- nearest-neighbour search: it reads and sorts every theme once per theme.
-- Over 1,064 themes that took 10.5s a call, against 1.3s for the same query
-- with the arguments written in, so the theme pass was cancelled at
-- PostgREST's eight seconds on every tick. The position pass runs only after
-- the theme pass returns, so it never ran either, whatever 0011 did for it.
--
-- The theme function becomes PL/pgSQL with plan_cache_mode set to
-- force_custom_plan, so each call is planned with its own arguments and the
-- index is used. Same signature, same rows, same order. The two position
-- functions from 0011 are PL/pgSQL already, but a pooled PostgREST connection
-- would move them to a generic plan after five calls, and the neighbour search
-- in find_position_pairs has the same parameterised limit, so they get the
-- setting too.

set search_path = obsidian, public, extensions;

alter function obsidian.find_position_pairs(int, uuid, int, double precision, double precision)
  set plan_cache_mode = force_custom_plan;

alter function obsidian.position_merge_candidates(int, uuid, int, double precision, double precision)
  set plan_cache_mode = force_custom_plan;

-- Replacing a SQL function with a PL/pgSQL one of the same signature keeps
-- its grants and comment.
create or replace function obsidian.theme_merge_candidates(
  p_limit int,
  p_user_id uuid default null,
  p_neighbours int default 5,
  p_min_similarity double precision default 0.7,
  p_min_trigram double precision default 0.5
)
returns table (
  user_id uuid,
  a_id uuid,
  a_name text,
  a_about text,
  a_notes int,
  b_id uuid,
  b_name text,
  b_about text,
  b_notes int,
  similarity double precision,
  trigram double precision
)
language plpgsql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  return query
  with near as (
    select t.user_id,
           least(t.id, n.id) as a_id,
           greatest(t.id, n.id) as b_id,
           (1 - n.distance)::double precision as similarity,
           null::double precision as trigram
      from obsidian.themes t
      cross join lateral (
        select o.id, o.embedding <=> t.embedding as distance
          from obsidian.themes o
         where o.user_id = t.user_id
           and o.id <> t.id
           and o.embedding is not null
         order by o.embedding <=> t.embedding
         limit least(greatest(coalesce(p_neighbours, 5), 1), 50)
      ) n
     where t.embedding is not null
       and (p_user_id is null or t.user_id = p_user_id)
       and 1 - n.distance >= coalesce(p_min_similarity, 0.7)
  ),
  spelled as (
    select a.user_id,
           a.id as a_id,
           b.id as b_id,
           null::double precision as similarity,
           extensions.similarity(a.name, b.name)::double precision as trigram
      from obsidian.themes a
      join obsidian.themes b
        on b.user_id = a.user_id
       and a.id < b.id
       -- `%` is what reaches themes_name_trgm_idx; it keeps pairs at
       -- pg_trgm's own threshold (0.3 by default), so a floor below that is
       -- read as that.
       and b.name operator(extensions.%) a.name
       and extensions.similarity(a.name, b.name) >= coalesce(p_min_trigram, 0.5)
     where p_user_id is null or a.user_id = p_user_id
  ),
  pairs as (
    select c.user_id, c.a_id, c.b_id, max(c.similarity) as similarity, max(c.trigram) as trigram
      from (select * from near union all select * from spelled) c
     group by c.user_id, c.a_id, c.b_id
  )
  select p.user_id,
         a.id, a.name, a.about,
         (select count(*)::int from obsidian.theme_notes tn where tn.theme_id = a.id),
         b.id, b.name, b.about,
         (select count(*)::int from obsidian.theme_notes tn where tn.theme_id = b.id),
         p.similarity,
         p.trigram
    from pairs p
    join obsidian.themes a on a.id = p.a_id
    join obsidian.themes b on b.id = p.b_id
   where not exists (
     select 1
       from obsidian.map_merge_proposals m
      where m.user_id = p.user_id
        and m.kind = 'theme'
        and m.a_id = p.a_id
        and m.b_id = p.b_id
   )
   order by p.user_id,
            greatest(coalesce(p.similarity, 0), coalesce(p.trigram, 0)) desc,
            p.a_id,
            p.b_id
   limit greatest(coalesce(p_limit, 20), 1);
end;
$$;
