-- Merge two positions only while both still exist (plan #882).
--
-- 0016 stopped the apply run following a theme proposal's sides through
-- earlier merges, and left positions following them. Decision #880 answered A
-- for positions too: a proposal is applied only when both of the positions the
-- model compared are still there. 138 of the 714 position merges made so far
-- went through such a chain; undoing those is #883.
--
-- Two changes, the ones 0016 named:
--
--   obsidian.map_merge_follows_merges is false for every kind, so the apply
--   run marks a position proposal with a side absorbed since it was written
--   `absorbed` and merges nothing for it.
--
--   obsidian.position_merge_candidates offers the pair such a proposal leads
--   to today, the surviving position and the other side, as a new pair, so a
--   later tick judges the two positions as they read now.
--
-- The pairs the search finds for itself stay in obsidian.position_pairs,
-- filled by find_position_pairs (0011). The carried pairs are not written
-- there: that table is a cache of the search, and find_position_pairs deletes
-- a position's rows whenever it searches that position again. They are read
-- from obsidian.map_merge_absorbed_pairs on each call instead, as the theme
-- search does.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- No kind follows earlier merges any more. Kept as a function so the apply
-- run from 0016 needs no change.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_merge_follows_merges(p_kind text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select false
$$;

comment on function obsidian.apply_merge_proposals(text, uuid, int, int) is
  'Merges every same-subject proposal of one kind not yet applied and marks each with the outcome (plan #820). A proposal with a side absorbed since it was written is marked absorbed and not merged (plans #878 and #882).';

-- ---------------------------------------------------------------------------
-- The position candidate search from 0017, with the pairs absorbed proposals
-- lead to added. Same signature, rows and filters, except:
--
--   the carried pairs come first, since the model already judged their sides
--   one position and each is waiting to be judged again as the two stand now;
--
--   the similarity and trigram floors do not apply to them, since the floors
--   are for finding pairs and these were found already. `similarity` is the
--   cosine of their statement embeddings; `trigram` is set only when a side
--   has no embedding, so the proposal's `source` still says what the pair
--   was compared on.
--
-- A carried pair whose two positions share a note is still left out, like any
-- other pair: positions drawn from one note are separate by construction.
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
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  perform obsidian.find_position_pairs(
    100, p_user_id, p_neighbours, p_min_similarity, p_min_trigram
  );

  return query
  with found as (
    select pp.user_id, pp.a_id, pp.b_id, pp.similarity, pp.trigram, false as carried
      from obsidian.position_pairs pp
     where (p_user_id is null or pp.user_id = p_user_id)
       and (pp.similarity >= coalesce(p_min_similarity, 0.75)
            or pp.trigram >= coalesce(p_min_trigram, 0.5))
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
      from obsidian.map_merge_absorbed_pairs('position', p_user_id) c
      join obsidian.positions a on a.id = c.a_id
      join obsidian.positions b on b.id = c.b_id
  ),
  pairs as (
    select c.user_id, c.a_id, c.b_id,
           max(c.similarity) as similarity,
           max(c.trigram) as trigram,
           bool_or(c.carried) as carried
      from (
        select * from found
        union all select * from carried
      ) c
     group by c.user_id, c.a_id, c.b_id
  )
  select pp.user_id,
         a.id, a.name, a.statement, a.kind::text,
         (select count(distinct s.note_id)::int from obsidian.position_sources s where s.position_id = a.id),
         b.id, b.name, b.statement, b.kind::text,
         (select count(distinct s.note_id)::int from obsidian.position_sources s where s.position_id = b.id),
         pp.similarity,
         pp.trigram
    from pairs pp
    join obsidian.positions a on a.id = pp.a_id
    join obsidian.positions b on b.id = pp.b_id
   where not exists (
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
     and not exists (
       select 1
         from obsidian.map_merges u
        where u.user_id = pp.user_id
          and u.kind = 'position'
          and u.undone_at is not null
          and u.undo_reason is null
          and least(u.survivor_id, u.absorbed_id) = pp.a_id
          and greatest(u.survivor_id, u.absorbed_id) = pp.b_id
     )
   order by pp.user_id,
            pp.carried desc,
            greatest(coalesce(pp.similarity, 0), coalesce(pp.trigram, 0)) desc,
            pp.a_id,
            pp.b_id
   limit greatest(coalesce(p_limit, 20), 1);
end;
$$;

comment on function obsidian.position_merge_candidates(int, uuid, int, double precision, double precision) is
  'Position pairs from different notes that have no merge proposal yet: the pairs absorbed proposals lead to first (plan #882), then those kept in position_pairs after topping up 100 unsearched positions, closest first.';
