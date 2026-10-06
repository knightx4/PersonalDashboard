-- Resolve absorbed proposals in one query in obsidian.map_merge_absorbed_pairs.
--
-- theme_merge_candidates still took 4.5 to 5.5 s a call on 241 themes after
-- 0033, and almost all of it was this function. It called
-- obsidian.map_merge_resolve twice for every absorbed proposal, about 690
-- plpgsql calls for themes. Called on its own that cost 0.6 s. Called from
-- the candidate functions, which set plan_cache_mode = force_custom_plan, it
-- cost 3.5 s, because that setting carries into every call and replans the
-- lookup inside map_merge_resolve each time. Routines reading candidates
-- through the Supabase connector were running into its 60 s limit.
--
-- The function now follows every merge chain in one recursive query: start
-- from each side of each absorbed proposal, step to the newest standing merge
-- that absorbed it, and keep the last row reached. The step limit of 1000 and
-- the choice of the newest merge are the same as map_merge_resolve's. On the
-- live data it returns the same 345 theme pairs and 84 position pairs as
-- before, in 74 ms for themes from inside a function, against 583 ms.
--
-- The signature, the grants and map_merge_resolve itself are unchanged;
-- apply_merge_proposals and map_merge_check_proposal still call it for one
-- row at a time.

create or replace function obsidian.map_merge_absorbed_pairs(p_kind text, p_user_id uuid default null)
returns table (user_id uuid, a_id uuid, b_id uuid)
language sql
stable
security invoker
set search_path = obsidian, pg_catalog
as $$
  with recursive proposals as (
    select m.user_id, m.a_id, m.b_id
      from obsidian.map_merge_proposals m
     where m.kind = p_kind
       and m.apply_outcome = 'absorbed'
       and (p_user_id is null or m.user_id = p_user_id)
  ),
  walk (start_id, id, steps) as (
    select s.id, s.id, 0
      from (select p.a_id as id from proposals p union select p.b_id from proposals p) s
    union all
    select w.start_id, nx.survivor_id, w.steps + 1
      from walk w
      cross join lateral (
        select m.survivor_id
          from obsidian.map_merges m
         where m.absorbed_id = w.id
           and m.kind = p_kind
           and m.undone_at is null
         order by m.merged_at desc
         limit 1
      ) nx
     where w.steps < 1000
  ),
  resolved as (
    select distinct on (w.start_id) w.start_id, w.id
      from walk w
     order by w.start_id, w.steps desc
  )
  select distinct p.user_id, least(x.id, y.id), greatest(x.id, y.id)
    from proposals p
    join resolved x on x.start_id = p.a_id
    join resolved y on y.start_id = p.b_id
   where x.id <> y.id
$$;
