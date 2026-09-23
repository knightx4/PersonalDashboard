-- Position pairs kept, rather than rebuilt on every call (plan #836).
--
-- obsidian.position_merge_candidates (0008) searched every position on every
-- call: a trigram join over all names and a five-nearest search from every
-- embedded position. Over about 3,200 positions each half took five to six
-- seconds, and the map sweep reaches the function through PostgREST, which
-- cancels a statement at eight. The position merge pass therefore never got a
-- single pair back.
--
-- The searches are per position, so each position is searched once and what
-- it finds is kept in obsidian.position_pairs. obsidian.position_pair_scans
-- records the name and embedding a position was searched with; when either
-- changes (a rename, a new statement that clears the vector, the vector
-- arriving after the name), the position is searched again. The candidate
-- function tops up a bounded number of unsearched positions and then reads the
-- kept pairs, so a call costs about a second however large the map grows.
--
-- The one thing a per-position search loses is a neighbour found only from
-- the other side: B among A's five nearest when A is not among B's, and B
-- embedded after A was searched. Both are pairs between a crowded region and a
-- sparse one, the least likely to be one position. Trigram pairs are symmetric
-- and lose nothing.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- Pairs found so far. a_id < b_id, as the proposals store them. `similarity`
-- is the cosine between statements when the embedding search found the pair,
-- `trigram` the name similarity when the trigram search did; both when both.
-- A pair that shares a note or already has a proposal is still kept here and
-- filtered when read, because both can change after the search.
-- ---------------------------------------------------------------------------
create table obsidian.position_pairs (
  user_id uuid not null references auth.users (id) on delete cascade,
  a_id uuid not null references obsidian.positions (id) on delete cascade,
  b_id uuid not null references obsidian.positions (id) on delete cascade,
  similarity double precision,
  trigram double precision,
  found_at timestamptz not null default now(),
  primary key (a_id, b_id),
  constraint position_pairs_order_ck check (a_id < b_id),
  constraint position_pairs_score_ck check (similarity is not null or trigram is not null)
);

create index position_pairs_b_idx on obsidian.position_pairs (b_id);
create index position_pairs_user_idx on obsidian.position_pairs (user_id);

alter table obsidian.position_pairs enable row level security;

create policy position_pairs_all on obsidian.position_pairs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on obsidian.position_pairs to authenticated, service_role;

comment on table obsidian.position_pairs is
  'Position pairs found by name trigram or statement embedding, kept so the merge search reads them instead of recomputing them (plan #836).';

-- ---------------------------------------------------------------------------
-- Which positions have been searched, and with what. A position whose name or
-- embedded_at differs from its row here (or that has no row) is searched on
-- the next top-up.
-- ---------------------------------------------------------------------------
create table obsidian.position_pair_scans (
  position_id uuid primary key references obsidian.positions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  embedded_at timestamptz,
  scanned_at timestamptz not null default now()
);

create index position_pair_scans_user_idx on obsidian.position_pair_scans (user_id);

alter table obsidian.position_pair_scans enable row level security;

create policy position_pair_scans_all on obsidian.position_pair_scans for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on obsidian.position_pair_scans to authenticated, service_role;

comment on table obsidian.position_pair_scans is
  'The name and embedding each position was last searched for pairs with (plan #836).';

-- ---------------------------------------------------------------------------
-- Search up to `p_limit` positions that have not been searched as they now
-- stand, keep what they find, and return how many were searched.
--
-- The searches are 0008's, run from each position in the batch: its
-- `p_neighbours` nearest positions of the same owner by statement cosine at or
-- above `p_min_similarity`, and every name of the same owner at or above
-- `p_min_trigram`. A position searched before has its old pairs removed first,
-- since the name or vector they were found with has gone. About 11ms a
-- position on the live project, so the default 100 is about a second.
-- ---------------------------------------------------------------------------
create or replace function obsidian.find_position_pairs(
  p_limit int default 100,
  p_user_id uuid default null,
  p_neighbours int default 5,
  p_min_similarity double precision default 0.75,
  p_min_trigram double precision default 0.5
)
returns int
language plpgsql
volatile
security invoker
set search_path = obsidian, extensions, pg_temp
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
        left join obsidian.position_pair_scans s on s.position_id = p.id
       where (p_user_id is null or p.user_id = p_user_id)
         and (s.position_id is null
              or s.name is distinct from p.name
              or s.embedded_at is distinct from p.embedded_at)
       order by p.created_at, p.id
       limit greatest(coalesce(p_limit, 100), 0)
    ) x;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  if cardinality(v_rescan) > 0 then
    delete from obsidian.position_pairs pp
     where pp.a_id = any(v_rescan) or pp.b_id = any(v_rescan);
  end if;

  insert into obsidian.position_pairs as pp (user_id, a_id, b_id, similarity, trigram)
  select c.user_id, c.a_id, c.b_id, max(c.similarity), max(c.trigram)
    from (
      select p.user_id,
             least(p.id, n.id) as a_id,
             greatest(p.id, n.id) as b_id,
             (1 - n.distance)::double precision as similarity,
             null::double precision as trigram
        from obsidian.positions p
        cross join lateral (
          select o.id, o.embedding <=> p.embedding as distance
            from obsidian.positions o
           where o.user_id = p.user_id
             and o.id <> p.id
             and o.embedding is not null
           order by o.embedding <=> p.embedding
           limit least(greatest(coalesce(p_neighbours, 5), 1), 50)
        ) n
       where p.id = any(v_ids)
         and p.embedding is not null
         and 1 - n.distance >= coalesce(p_min_similarity, 0.75)
      union all
      select p.user_id,
             least(p.id, o.id),
             greatest(p.id, o.id),
             null::double precision,
             extensions.similarity(p.name, o.name)::double precision
        from obsidian.positions p
        join obsidian.positions o
          on o.user_id = p.user_id
         and o.id <> p.id
         -- `%` is what reaches positions_name_trgm_idx (0008); it keeps pairs
         -- at pg_trgm's own threshold, 0.3 by default.
         and o.name operator(extensions.%) p.name
         and extensions.similarity(p.name, o.name) >= coalesce(p_min_trigram, 0.5)
       where p.id = any(v_ids)
    ) c
   group by c.user_id, c.a_id, c.b_id
  on conflict (a_id, b_id) do update
     set similarity = greatest(pp.similarity, excluded.similarity),
         trigram = greatest(pp.trigram, excluded.trigram);

  insert into obsidian.position_pair_scans as s (position_id, user_id, name, embedded_at, scanned_at)
  select p.id, p.user_id, p.name, p.embedded_at, now()
    from obsidian.positions p
   where p.id = any(v_ids)
  on conflict (position_id) do update
     set name = excluded.name,
         embedded_at = excluded.embedded_at,
         scanned_at = excluded.scanned_at;

  return cardinality(v_ids);
end;
$$;

comment on function obsidian.find_position_pairs(int, uuid, int, double precision, double precision) is
  'Search up to p_limit positions not yet searched as they stand for merge pairs, keep them in position_pairs, and return how many were searched.';

revoke all on function obsidian.find_position_pairs(int, uuid, int, double precision, double precision)
  from public, anon;
grant execute on function obsidian.find_position_pairs(int, uuid, int, double precision, double precision)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The candidate function, same signature and rows as 0008, now reading the
-- kept pairs. Each call first tops up 100 positions, so new and re-embedded
-- positions join the pairs as the sweep goes; the floors are applied again
-- on read, so raising one takes effect at once (lowering one only reaches
-- positions searched afterwards). Volatile now, since the top-up writes.
-- ---------------------------------------------------------------------------
create or replace function obsidian.position_merge_candidates(
  p_limit int,
  p_user_id uuid default null,
  p_neighbours int default 5,
  p_min_similarity double precision default 0.75,
  p_min_trigram double precision default 0.5
)
returns table (
  user_id uuid,
  a_id uuid,
  a_name text,
  a_statement text,
  a_kind text,
  a_notes int,
  b_id uuid,
  b_name text,
  b_statement text,
  b_kind text,
  b_notes int,
  similarity double precision,
  trigram double precision
)
language plpgsql
volatile
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
#variable_conflict use_column
begin
  perform obsidian.find_position_pairs(
    100, p_user_id, p_neighbours, p_min_similarity, p_min_trigram
  );

  return query
  select pp.user_id,
         a.id, a.name, a.statement, a.kind::text,
         (select count(distinct s.note_id)::int from obsidian.position_sources s where s.position_id = a.id),
         b.id, b.name, b.statement, b.kind::text,
         (select count(distinct s.note_id)::int from obsidian.position_sources s where s.position_id = b.id),
         pp.similarity,
         pp.trigram
    from obsidian.position_pairs pp
    join obsidian.positions a on a.id = pp.a_id
    join obsidian.positions b on b.id = pp.b_id
   where (p_user_id is null or pp.user_id = p_user_id)
     and (pp.similarity >= coalesce(p_min_similarity, 0.75)
          or pp.trigram >= coalesce(p_min_trigram, 0.5))
     and not exists (
       select 1
         from obsidian.position_sources sa
         join obsidian.position_sources sb on sb.note_id = sa.note_id
        where sa.position_id = pp.a_id
          and sb.position_id = pp.b_id
     )
     and not exists (
       select 1
         from obsidian.map_merge_proposals m
        where m.user_id = pp.user_id
          and m.kind = 'position'
          and m.a_id = pp.a_id
          and m.b_id = pp.b_id
     )
   order by pp.user_id,
            greatest(coalesce(pp.similarity, 0), coalesce(pp.trigram, 0)) desc,
            pp.a_id,
            pp.b_id
   limit greatest(coalesce(p_limit, 20), 1);
end;
$$;

comment on function obsidian.position_merge_candidates(int, uuid, int, double precision, double precision) is
  'Position pairs from different notes, kept in position_pairs after topping up 100 unsearched positions, that have no merge proposal yet, closest first.';

revoke all on function obsidian.position_merge_candidates(int, uuid, int, double precision, double precision)
  from public, anon;
grant execute on function obsidian.position_merge_candidates(int, uuid, int, double precision, double precision)
  to authenticated, service_role;
