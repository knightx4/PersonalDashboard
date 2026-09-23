-- Edges between positions from different notes (plan #816).
--
-- Extraction proposes edges inside one note, so after the first full sweep no
-- edge on the map crossed notes and 19% of positions had no edge at all. This
-- adds the second source of edges: each position's nearest neighbours by the
-- embedding of its statement, from other notes, judged by a model in batches
-- against the six edge types from lib/learn/graph/position-prompt.ts. What the
-- model finds is written to obsidian.position_edges like any extracted edge.
--
-- The pairs are kept, as 0011 keeps the merge pairs, so a call searches only
-- positions not yet searched as they stand and stays near a second. The
-- judgement is kept on the pair, `none` included, so a pair is paid for once.
--
-- The floor is lower than the merge search's 0.75. Two claims about one
-- subject from different notes score 0.60 to 0.80 against each other, and
-- those are the pairs that support, qualify or contradict; the pairs above
-- 0.75 are mostly the merge pass's.
--
-- Nothing here refuses a `requires` loop. 0002 left the map's edges cyclic on
-- purpose, and the candidate read leaves out any pair that already has an
-- edge in either direction, so this pass never writes the second half of a
-- two-position loop.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- Pairs found for linking, and the model's judgement once there is one.
--
-- `relation` is one of the six edge types, or `none` when the model saw no
-- relation. `from_id` is the side the edge runs from, for any relation but
-- `none`. The edge itself is in position_edges; this row is the record that
-- the pair was asked about.
-- ---------------------------------------------------------------------------
create table obsidian.position_link_pairs (
  user_id uuid not null references auth.users (id) on delete cascade,
  a_id uuid not null references obsidian.positions (id) on delete cascade,
  b_id uuid not null references obsidian.positions (id) on delete cascade,
  similarity double precision not null,
  found_at timestamptz not null default now(),

  judged_at timestamptz,
  relation text,
  from_id uuid,
  reason text,
  confidence numeric,
  model text,

  primary key (a_id, b_id),
  constraint position_link_pairs_order_ck check (a_id < b_id),
  constraint position_link_pairs_relation_ck check (
    relation in ('requires', 'supports', 'qualifies', 'contradicts', 'example_of', 'same_as', 'none')
  ),
  constraint position_link_pairs_judged_ck check (
    (judged_at is null) = (relation is null)
    and (judged_at is null) = (model is null)
  ),
  constraint position_link_pairs_from_ck check (
    case
      when relation is null or relation = 'none' then from_id is null
      else from_id in (a_id, b_id)
    end
  ),
  constraint position_link_pairs_confidence_ck check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  )
);

create index position_link_pairs_b_idx on obsidian.position_link_pairs (b_id);
create index position_link_pairs_user_idx on obsidian.position_link_pairs (user_id);
-- The candidate read's queue.
create index position_link_pairs_unjudged_idx
  on obsidian.position_link_pairs (user_id, similarity desc)
  where judged_at is null;

alter table obsidian.position_link_pairs enable row level security;

create policy position_link_pairs_all on obsidian.position_link_pairs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on obsidian.position_link_pairs to authenticated, service_role;
revoke all on obsidian.position_link_pairs from anon;

comment on table obsidian.position_link_pairs is
  'Position pairs from different notes found by statement embedding, and whether a model saw an edge between them (plan #816).';

-- ---------------------------------------------------------------------------
-- Which positions have been searched for link pairs, and with which vector. A
-- position with no row, or whose embedded_at has moved on, is searched on the
-- next top-up.
-- ---------------------------------------------------------------------------
create table obsidian.position_link_scans (
  position_id uuid primary key references obsidian.positions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  embedded_at timestamptz,
  scanned_at timestamptz not null default now()
);

create index position_link_scans_user_idx on obsidian.position_link_scans (user_id);

alter table obsidian.position_link_scans enable row level security;

create policy position_link_scans_all on obsidian.position_link_scans for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on obsidian.position_link_scans to authenticated, service_role;
revoke all on obsidian.position_link_scans from anon;

comment on table obsidian.position_link_scans is
  'The vector each position was last searched for link pairs with (plan #816).';

-- ---------------------------------------------------------------------------
-- Search up to `p_limit` embedded positions not yet searched as they stand:
-- each one's `p_neighbours` nearest positions of the same owner that share no
-- note with it, at cosine `p_min_similarity` or above. Positions with no edge
-- are searched first, since they are what the pass is for. A position searched
-- before loses its old pairs first, judged or not, since its statement has
-- changed.
-- ---------------------------------------------------------------------------
create or replace function obsidian.find_position_links(
  p_limit int default 100,
  p_user_id uuid default null,
  p_neighbours int default 5,
  p_min_similarity double precision default 0.65
)
returns int
language plpgsql
volatile
security invoker
set search_path = obsidian, extensions, pg_temp
set plan_cache_mode = force_custom_plan
as $$
declare
  v_ids uuid[];
  v_rescan uuid[];
begin
  select coalesce(array_agg(x.id), '{}'),
         coalesce(array_agg(x.id) filter (where x.searched), '{}')
    into v_ids, v_rescan
    from (
      select p.id, s.position_id is not null as searched
        from obsidian.positions p
        left join obsidian.position_link_scans s on s.position_id = p.id
       where (p_user_id is null or p.user_id = p_user_id)
         and p.embedding is not null
         and (s.position_id is null or s.embedded_at is distinct from p.embedded_at)
       order by exists (
                  select 1 from obsidian.position_edges e
                   where e.from_id = p.id or e.to_id = p.id
                ),
                p.created_at, p.id
       limit greatest(coalesce(p_limit, 100), 0)
    ) x;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  if cardinality(v_rescan) > 0 then
    delete from obsidian.position_link_pairs lp
     where lp.a_id = any(v_rescan) or lp.b_id = any(v_rescan);
  end if;

  insert into obsidian.position_link_pairs as lp (user_id, a_id, b_id, similarity)
  select p.user_id,
         least(p.id, n.id),
         greatest(p.id, n.id),
         max(1 - n.distance)::double precision
    from obsidian.positions p
    cross join lateral (
      select o.id, o.embedding <=> p.embedding as distance
        from obsidian.positions o
       where o.user_id = p.user_id
         and o.id <> p.id
         and o.embedding is not null
         and not exists (
           select 1
             from obsidian.position_sources sp
             join obsidian.position_sources so on so.note_id = sp.note_id
            where sp.position_id = p.id
              and so.position_id = o.id
         )
       order by o.embedding <=> p.embedding
       limit least(greatest(coalesce(p_neighbours, 5), 1), 50)
    ) n
   where p.id = any(v_ids)
     and 1 - n.distance >= coalesce(p_min_similarity, 0.65)
   group by p.user_id, least(p.id, n.id), greatest(p.id, n.id)
  on conflict (a_id, b_id) do nothing;

  insert into obsidian.position_link_scans as s (position_id, user_id, embedded_at, scanned_at)
  select p.id, p.user_id, p.embedded_at, now()
    from obsidian.positions p
   where p.id = any(v_ids)
  on conflict (position_id) do update
     set embedded_at = excluded.embedded_at,
         scanned_at = excluded.scanned_at;

  return cardinality(v_ids);
end;
$$;

comment on function obsidian.find_position_links(int, uuid, int, double precision) is
  'Search up to p_limit embedded positions not yet searched as they stand for link pairs from other notes, keep them in position_link_pairs, and return how many were searched.';

revoke all on function obsidian.find_position_links(int, uuid, int, double precision)
  from public, anon;
grant execute on function obsidian.find_position_links(int, uuid, int, double precision)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The pairs to judge next, after topping up 100 positions. Left out: a pair
-- already judged, a pair that now shares a note, a pair with an edge in either
-- direction, and a pair the merge pass judged one position, which the apply
-- run merges rather than links. Pairs where a side has no edge come first,
-- then the closest.
-- ---------------------------------------------------------------------------
create or replace function obsidian.position_link_candidates(
  p_limit int,
  p_user_id uuid default null,
  p_neighbours int default 5,
  p_min_similarity double precision default 0.65
)
returns table (
  user_id uuid,
  a_id uuid,
  a_name text,
  a_statement text,
  a_kind text,
  b_id uuid,
  b_name text,
  b_statement text,
  b_kind text,
  similarity double precision,
  unlinked int
)
language plpgsql
volatile
security invoker
set search_path = obsidian, extensions, pg_temp
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  perform obsidian.find_position_links(100, p_user_id, p_neighbours, p_min_similarity);

  return query
  with pending as (
    select lp.user_id, lp.a_id, lp.b_id, lp.similarity,
           (case when exists (select 1 from obsidian.position_edges e
                               where e.from_id = lp.a_id or e.to_id = lp.a_id)
                 then 0 else 1 end
            + case when exists (select 1 from obsidian.position_edges e
                                 where e.from_id = lp.b_id or e.to_id = lp.b_id)
                   then 0 else 1 end)::int as unlinked
      from obsidian.position_link_pairs lp
     where lp.judged_at is null
       and (p_user_id is null or lp.user_id = p_user_id)
       and lp.similarity >= coalesce(p_min_similarity, 0.65)
       and not exists (
         select 1
           from obsidian.position_sources sa
           join obsidian.position_sources sb on sb.note_id = sa.note_id
          where sa.position_id = lp.a_id
            and sb.position_id = lp.b_id
       )
       and not exists (
         select 1
           from obsidian.position_edges e
          where (e.from_id = lp.a_id and e.to_id = lp.b_id)
             or (e.from_id = lp.b_id and e.to_id = lp.a_id)
       )
       and not exists (
         select 1
           from obsidian.map_merge_proposals m
          where m.user_id = lp.user_id
            and m.kind = 'position'
            and m.a_id = lp.a_id
            and m.b_id = lp.b_id
            and m.verdict = 'same'
       )
  )
  select o.user_id,
         a.id, a.name, a.statement, a.kind::text,
         b.id, b.name, b.statement, b.kind::text,
         o.similarity,
         o.unlinked
    from pending o
    join obsidian.positions a on a.id = o.a_id
    join obsidian.positions b on b.id = o.b_id
   order by o.user_id, o.unlinked desc, o.similarity desc, o.a_id, o.b_id
   limit greatest(coalesce(p_limit, 20), 1);
end;
$$;

comment on function obsidian.position_link_candidates(int, uuid, int, double precision) is
  'Unjudged position pairs from different notes with no edge between them, after topping up 100 unsearched positions; pairs with an unlinked side first, then closest.';

revoke all on function obsidian.position_link_candidates(int, uuid, int, double precision)
  from public, anon;
grant execute on function obsidian.position_link_candidates(int, uuid, int, double precision)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Record a batch of judgements and write the edges they found, together.
--
-- `p_rows` is a JSON array of {a_id, b_id, relation, from_id, reason,
-- confidence, model}. A pair no longer in position_link_pairs (a side merged
-- away or re-embedded since it was read) or already judged is skipped, and so
-- is its edge. Returns how many pairs were recorded and how many edges were
-- written.
-- ---------------------------------------------------------------------------
create or replace function obsidian.record_position_links(p_rows jsonb)
returns table (recorded int, edges int)
language plpgsql
volatile
security invoker
set search_path = obsidian, pg_temp
as $$
declare
  v_recorded int;
  v_edges int;
begin
  with input as (
    select r.a_id, r.b_id, r.relation, r.from_id, nullif(btrim(r.reason), '') as reason,
           r.confidence, r.model
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
        a_id uuid, b_id uuid, relation text, from_id uuid, reason text,
        confidence numeric, model text
      )
  ),
  judged as (
    update obsidian.position_link_pairs lp
       set judged_at = now(),
           relation = i.relation,
           from_id = case when i.relation = 'none' then null else i.from_id end,
           reason = i.reason,
           confidence = i.confidence,
           model = i.model
      from input i
     where lp.a_id = i.a_id
       and lp.b_id = i.b_id
       and lp.judged_at is null
    returning lp.user_id, lp.a_id, lp.b_id, lp.relation, lp.from_id, lp.reason
  ),
  written as (
    insert into obsidian.position_edges (user_id, from_id, to_id, type, description)
    select j.user_id,
           j.from_id,
           case when j.from_id = j.a_id then j.b_id else j.a_id end,
           j.relation::obsidian.edge_type,
           j.reason
      from judged j
     where j.relation <> 'none'
    on conflict (from_id, to_id, type) do nothing
    returning 1
  )
  select (select count(*) from judged)::int, (select count(*) from written)::int
    into v_recorded, v_edges;

  return query select v_recorded, v_edges;
end;
$$;

comment on function obsidian.record_position_links(jsonb) is
  'Record link judgements on position_link_pairs and write the edges they found to position_edges (plan #816).';

revoke all on function obsidian.record_position_links(jsonb) from public, anon;
grant execute on function obsidian.record_position_links(jsonb) to authenticated, service_role;
