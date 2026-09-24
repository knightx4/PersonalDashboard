-- Score each position's centrality (plan #817).
--
-- obsidian.positions.centrality has been 0 on every row since 0002, because
-- nothing computed it. This is the function that does: PageRank over
-- obsidian.position_edges, written to the column, so the theme page (which
-- already sorts on it) lists the positions most of your thinking hangs off
-- first.
--
-- Which way an edge counts. The link pass writes `from` as the side that does
-- the supporting, qualifying, exemplifying or requiring ("from B with supports
-- means B is part of why A is true"), so rank flows from `from` to `to` and a
-- claim many others lean on scores high. `contradicts` and `same_as` say
-- nothing about which side is load-bearing, so they count both ways.
--
-- The scale. The stored value is the PageRank times the number of positions
-- in the owner's graph, rounded to two places, so the average connected
-- position scores 1 and none scores below 0.15, the damping floor. Every
-- position with an edge is therefore above zero. A position with no edge is
-- outside the graph and scores 0.
--
-- It is recomputed from the live tables every time, because merges and their
-- undos change position ids. The map sweep calls it after the merge and link
-- passes each tick (inngest/vault/map-sweep.ts). The PageRank over 4,934
-- positions and 10,635 edges takes about a second; writing is the slow part,
-- so only rows whose rounded score changed are written, biggest change first,
-- inside a time budget, and the caller calls again while any remain.

set search_path = obsidian, public, extensions;

-- The first version of this migration took no budget.
drop function if exists obsidian.score_position_centrality(uuid, float8, int, float8);

create or replace function obsidian.score_position_centrality(
  p_user_id uuid default null,
  p_budget_ms int default 4000,
  p_damping float8 default 0.85,
  p_max_iterations int default 100,
  p_tolerance float8 default 1e-9
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = obsidian, pg_catalog
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_budget interval := make_interval(secs => greatest(coalesce(p_budget_ms, 4000), 100) / 1000.0);
  v_user uuid;
  v_ids uuid[];
  v_src int[];
  v_dst int[];
  v_out float8[];
  v_rank float8[];
  v_next float8[];
  v_change_ids uuid[];
  v_change_scores numeric[];
  v_n int;
  v_total int;
  v_at int;
  v_iter int := 0;
  v_delta float8;
  v_dangling float8;
  v_users int := 0;
  v_scored int := 0;
  v_written int := 0;
  v_remaining int := 0;
  v_rows int;
begin
  for v_user in
    select e.user_id from obsidian.position_edges e
    where p_user_id is null or e.user_id = p_user_id
    union
    select p.user_id from obsidian.positions p
    where p.centrality <> 0 and (p_user_id is null or p.user_id = p_user_id)
  loop
    v_users := v_users + 1;

    -- Every position in the owner's graph, numbered 1..n in id order.
    select coalesce(array_agg(id order by id), '{}')
    into v_ids
    from (
      select from_id as id from obsidian.position_edges where user_id = v_user
      union
      select to_id from obsidian.position_edges where user_id = v_user
    ) n;
    v_n := coalesce(array_length(v_ids, 1), 0);
    v_rank := '{}';

    if v_n > 0 then
      -- Distinct directed links as index pairs, both ways for the two
      -- symmetric types.
      with idx as (
        select id, i from unnest(v_ids) with ordinality as u(id, i)
      ),
      links as (
        select distinct fs.i::int as s, ts.i::int as d
        from obsidian.position_edges e
        cross join lateral (
          select e.from_id as a, e.to_id as b
          union all
          select e.to_id, e.from_id where e.type in ('contradicts', 'same_as')
        ) l
        join idx fs on fs.id = l.a
        join idx ts on ts.id = l.b
        where e.user_id = v_user
      )
      select array_agg(s), array_agg(d) into v_src, v_dst from links;

      select array_agg(coalesce(o.c, 0)::float8 order by g.i)
      into v_out
      from generate_series(1, v_n) g(i)
      left join (select s, count(*) as c from unnest(v_src) s group by s) o on o.s = g.i;

      v_rank := array_fill(1.0::float8 / v_n, array[v_n]);
      v_iter := 0;
      loop
        v_iter := v_iter + 1;

        -- Rank held by positions with no outgoing link is spread evenly, the
        -- usual fix, so the total stays 1.
        select coalesce(sum(r), 0) into v_dangling
        from unnest(v_rank, v_out) as t(r, o)
        where o = 0;

        select array_agg(
                 (1 - p_damping) / v_n
                 + p_damping * (v_dangling / v_n + coalesce(f.inflow, 0))
                 order by g.i)
        into v_next
        from generate_series(1, v_n) g(i)
        left join (
          select l.d, sum(v_rank[l.s] / v_out[l.s]) as inflow
          from unnest(v_src, v_dst) as l(s, d)
          group by l.d
        ) f on f.d = g.i;

        select coalesce(sum(abs(a - b)), 0) into v_delta
        from unnest(v_next, v_rank) as t(a, b);
        v_rank := v_next;

        exit when v_delta < p_tolerance or v_iter >= p_max_iterations;
      end loop;
      v_scored := v_scored + v_n;
    end if;

    -- The rows whose stored score is wrong, biggest change first: positions
    -- in the graph at their new score, and positions that lost their last
    -- edge to a merge or an undo back at 0.
    with scores as (
      select u.id, round((u.r * v_n)::numeric, 2) as score
      from unnest(v_ids, v_rank) as u(id, r)
    ),
    changes as (
      select p.id, coalesce(s.score, 0) as score,
             abs(coalesce(s.score, 0) - p.centrality) as moved
      from obsidian.positions p
      left join scores s on s.id = p.id
      where p.user_id = v_user
        and p.centrality <> coalesce(s.score, 0)
    )
    select coalesce(array_agg(id order by moved desc, id), '{}'),
           coalesce(array_agg(score order by moved desc, id), '{}')
    into v_change_ids, v_change_scores
    from changes;
    v_total := coalesce(array_length(v_change_ids, 1), 0);

    -- Written a chunk at a time until the budget is spent. Each row costs a
    -- few milliseconds, most of it the embedding index, so a first run over a
    -- few thousand rows finishes over several calls.
    v_at := 1;
    while v_at <= v_total and clock_timestamp() - v_started < v_budget loop
      update obsidian.positions p
      set centrality = c.score
      from unnest(v_change_ids[v_at:v_at + 199], v_change_scores[v_at:v_at + 199]) as c(id, score)
      where p.id = c.id
        and p.user_id = v_user;
      get diagnostics v_rows = row_count;
      v_written := v_written + v_rows;
      v_at := v_at + 200;
    end loop;
    v_remaining := v_remaining + greatest(v_total - (v_at - 1), 0);
  end loop;

  return jsonb_build_object(
    'owners', v_users,
    'scored', v_scored,
    'written', v_written,
    'remaining', v_remaining,
    'iterations', v_iter,
    'ms', round(extract(epoch from clock_timestamp() - v_started) * 1000)
  );
end;
$$;

-- Nothing reads positions in centrality order through this index; the theme
-- page sorts a theme's few positions itself. While centrality is indexed,
-- every rescore is a non-HOT update that also inserts into the HNSW index on
-- the embedding, about 3ms a row. Without it a rescore can stay on the page.
drop index if exists obsidian.positions_user_centrality_idx;

comment on function obsidian.score_position_centrality(uuid, int, float8, int, float8) is
  'PageRank over position_edges written to positions.centrality to two places, scaled so the average connected position scores 1; positions with no edge score 0 (plan #817). Writes the biggest changes first until p_budget_ms is spent and returns how many are left. Null user means every owner.';

revoke all on function obsidian.score_position_centrality(uuid, int, float8, int, float8) from public, anon, authenticated;
grant execute on function obsidian.score_position_centrality(uuid, int, float8, int, float8) to service_role;
