-- Position pairs worth asking about (plan #812).
--
-- The map was extracted one note at a time, so one position turns up in
-- several notes in different words: "Transportation as means not end" has four
-- copies. The position merge pass finds candidate pairs here, asks a model
-- whether each pair is one position, and writes its answer to
-- obsidian.map_merge_proposals with kind 'position', beside the theme
-- proposals from 0007. Nothing here changes a position.
--
-- Across notes only. Two positions extracted from one note were kept apart by
-- the extraction that read them together, and the usual reason is that one is
-- a claim and the other its condition or example, which a merge would lose. A
-- pair that shares any note is left out.

set search_path = obsidian, public, extensions;

-- Trigram over position names, which the candidate search below joins on.
-- positions already carries one over the statement (0002); names are what the
-- first search compares, because two wordings of one position usually get
-- near-identical short names and statements differ more.
create index positions_name_trgm_idx
  on obsidian.positions using gin (name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Position pairs from different notes that have no merge proposal yet.
--
-- The same two searches as obsidian.theme_merge_candidates:
--
--   trigram    name pairs at or above `p_min_trigram`. On the first sweep's
--              3,014 positions, 0.5 finds 60 pairs across notes: rewordings
--              such as "Seeking meaning through extremes fails" and
--              "Searching meaning in extremes fails", along with pairs that
--              share a pattern and nothing else, such as "Communism requires
--              small scale" and "Democracy requires small scale". The model
--              tells those apart; the floor only keeps the count down.
--   embedding  each embedded position's `p_neighbours` nearest positions of
--              the same owner by cosine over the statement, kept at or above
--              `p_min_similarity`.
--
-- The 0.75 default for statements is higher than the 0.7 themes use, because
-- two sentences on one subject score closer than two short names do. On the
-- first 64 positions embedded, the closest pairs across notes scored 0.70 to
-- 0.72 and were separate claims on one subject, such as "Purposefulness
-- distinguishes from grindset mentality" and "Distinguishing authentic passion
-- from hollow achievement". Read it again once most positions have a vector.
--
-- `p_user_id` null means every owner, for the service-role cron; a signed-in
-- caller sees only their own positions through RLS either way. Ordered by
-- owner and then closest first, so a run cut off early has asked about the
-- likely merges first.
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
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
  with near as (
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
     where p.embedding is not null
       and (p_user_id is null or p.user_id = p_user_id)
       and 1 - n.distance >= coalesce(p_min_similarity, 0.75)
  ),
  spelled as (
    select a.user_id,
           a.id as a_id,
           b.id as b_id,
           null::double precision as similarity,
           extensions.similarity(a.name, b.name)::double precision as trigram
      from obsidian.positions a
      join obsidian.positions b
        on b.user_id = a.user_id
       and a.id < b.id
       -- `%` is what reaches positions_name_trgm_idx; it keeps pairs at
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
         a.id, a.name, a.statement, a.kind::text,
         (select count(distinct s.note_id)::int from obsidian.position_sources s where s.position_id = a.id),
         b.id, b.name, b.statement, b.kind::text,
         (select count(distinct s.note_id)::int from obsidian.position_sources s where s.position_id = b.id),
         p.similarity,
         p.trigram
    from pairs p
    join obsidian.positions a on a.id = p.a_id
    join obsidian.positions b on b.id = p.b_id
   where not exists (
     select 1
       from obsidian.position_sources sa
       join obsidian.position_sources sb on sb.note_id = sa.note_id
      where sa.position_id = p.a_id
        and sb.position_id = p.b_id
   )
     and not exists (
     select 1
       from obsidian.map_merge_proposals m
      where m.user_id = p.user_id
        and m.kind = 'position'
        and m.a_id = p.a_id
        and m.b_id = p.b_id
   )
   order by p.user_id,
            greatest(coalesce(p.similarity, 0), coalesce(p.trigram, 0)) desc,
            p.a_id,
            p.b_id
   limit greatest(coalesce(p_limit, 20), 1)
$$;

comment on function obsidian.position_merge_candidates(int, uuid, int, double precision, double precision) is
  'Position pairs from different notes, found by embedding neighbours or name trigram, that have no merge proposal yet, closest first.';

revoke all on function obsidian.position_merge_candidates(int, uuid, int, double precision, double precision)
  from public, anon;
grant execute on function obsidian.position_merge_candidates(int, uuid, int, double precision, double precision)
  to authenticated, service_role;
