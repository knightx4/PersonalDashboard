-- Read each theme's embedding once in obsidian.theme_merge_candidates.
--
-- The function took 3.6 s a call (3,369 calls, 12,083 s in all) and returned
-- no rows on 241 themes. Its first step finds each theme's nearest neighbours
-- with a lateral scan of obsidian.themes per theme. The embeddings are
-- vector(1024) kept out of line (storage `e`, about 4 kB each), so every
-- distance read both vectors back from TOAST: 241 scans of 240 rows, 387,000
-- buffer reads and about 0.7 s for that step alone.
--
-- The step now reads the embeddings once into a materialized set, copied with
-- subvector so the set holds the vectors themselves rather than pointers into
-- TOAST, and runs the same lateral nearest-neighbour search over that set.
-- On the live data the step returns the same 290 pairs in 69 ms. Everything
-- else, including the signature, the other two steps and the filters on what
-- is returned, is as 0017 left it.
--
-- The `carried` step still costs about 0.6 s, inside
-- obsidian.map_merge_absorbed_pairs, which follows each proposal through
-- obsidian.map_merge_resolve one row at a time. Both are shared with the
-- position search and are left as they are here.
--
-- position_merge_candidates reads obsidian.position_pairs, which
-- find_position_pairs keeps, and score_position_centrality reads edges only,
-- so neither repeats this scan.

create or replace function obsidian.theme_merge_candidates(
  p_limit integer,
  p_user_id uuid default null::uuid,
  p_neighbours integer default 5,
  p_min_similarity double precision default 0.7,
  p_min_trigram double precision default 0.5
)
returns table(
  user_id uuid,
  a_id uuid,
  a_name text,
  a_about text,
  a_notes integer,
  b_id uuid,
  b_name text,
  b_about text,
  b_notes integer,
  similarity double precision,
  trigram double precision
)
language plpgsql
stable
set search_path to 'obsidian', 'extensions', 'pg_temp'
set plan_cache_mode to 'force_custom_plan'
as $function$
#variable_conflict use_column
begin
  return query
  with embedded as materialized (
    -- subvector copies the vector out of TOAST, so the search below reads
    -- memory rather than fetching each embedding again for every distance.
    select t.id,
           t.user_id,
           extensions.subvector(t.embedding, 1, extensions.vector_dims(t.embedding)) as embedding
      from obsidian.themes t
     where t.embedding is not null
       and (p_user_id is null or t.user_id = p_user_id)
  ),
  near as (
    select t.user_id,
           least(t.id, n.id) as a_id,
           greatest(t.id, n.id) as b_id,
           (1 - n.distance)::double precision as similarity,
           null::double precision as trigram,
           false as carried
      from embedded t
      cross join lateral (
        select o.id, o.embedding <=> t.embedding as distance
          from embedded o
         where o.user_id = t.user_id
           and o.id <> t.id
         order by o.embedding <=> t.embedding
         limit least(greatest(coalesce(p_neighbours, 5), 1), 50)
      ) n
     where 1 - n.distance >= coalesce(p_min_similarity, 0.7)
  ),
  spelled as (
    select a.user_id,
           a.id as a_id,
           b.id as b_id,
           null::double precision as similarity,
           extensions.similarity(a.name, b.name)::double precision as trigram,
           false as carried
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
  carried as (
    select c.user_id,
           c.a_id,
           c.b_id,
           (1 - (a.embedding <=> b.embedding))::double precision as similarity,
           case
             when a.embedding is null or b.embedding is null
               then extensions.similarity(a.name, b.name)::double precision
           end as trigram,
           true as carried
      from obsidian.map_merge_absorbed_pairs('theme', p_user_id) c
      join obsidian.themes a on a.id = c.a_id
      join obsidian.themes b on b.id = c.b_id
  ),
  pairs as (
    select c.user_id, c.a_id, c.b_id,
           max(c.similarity) as similarity,
           max(c.trigram) as trigram,
           bool_or(c.carried) as carried
      from (
        select * from near
        union all select * from spelled
        union all select * from carried
      ) c
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
     and not exists (
       select 1
         from obsidian.map_merges u
        where u.user_id = p.user_id
          and u.kind = 'theme'
          and u.undone_at is not null
          and u.undo_reason is null
          and least(u.survivor_id, u.absorbed_id) = p.a_id
          and greatest(u.survivor_id, u.absorbed_id) = p.b_id
     )
   order by p.user_id,
            p.carried desc,
            greatest(coalesce(p.similarity, 0), coalesce(p.trigram, 0)) desc,
            p.a_id,
            p.b_id
   limit greatest(coalesce(p_limit, 20), 1);
end;
$function$;
