-- Say how close each pair is from the older note's side as well
-- (plan #1115, under #1110).
--
-- Trying the weekly connections against the live vault (the 64 notes written
-- in the week of 19 September 2026) showed what 0025 alone gives: a few older
-- notes are near everything. Financial Markets Problem Set 1 was the nearest
-- older note to seven different course notes, from corporate finance to
-- leading small firms, at 0.70 to 0.85, and ML Economic Problem Set 4 and the
-- note called Yale did the same. Grouped by older note, those three filled
-- every slot, and none of them says anything: a problem set full of formulas
-- sits near any note with numbers in it.
--
-- The usual fix for such hub notes is to ask the question from both ends. A
-- pair counts when the recent note is also among the older note's own nearest
-- notes. So recent_note_neighbours now returns mutual_rank: where the recent
-- note falls among every eligible note ordered by closeness to the older one,
-- 1 being the nearest. On that week the pairs worth reading came out at 1 to
-- 5 (World Financial History and Money Changes Everything at 1, the
-- smart-cities course and the note on Songdo at 1, the operations course and
-- The Goal at 5), and the problem-set pairs at 10 to 27. The cut is made in
-- lib/vault/notes/connections.ts, not here.
--
-- The rank is counted only for pairs that clear p_min_similarity, against the
-- same eligible notes as the rest of the function. A new column changes the
-- return type, so the function is dropped and made again.

set search_path = obsidian, public, extensions;

drop function if exists obsidian.recent_note_neighbours(uuid, timestamptz, int, double precision);

create function obsidian.recent_note_neighbours(
  p_user_id uuid,
  p_since timestamptz,
  p_per_note int default 5,
  p_min_similarity double precision default 0.55
)
returns table (
  recent_id uuid,
  recent_path text,
  recent_title text,
  recent_chars int,
  older_id uuid,
  older_path text,
  older_title text,
  older_chars int,
  similarity double precision,
  mutual_rank int
)
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
  with eligible as materialized (
    select n.id, n.path, n.title, n.written_at,
           obsidian.note_prose_chars(n.body) as chars,
           e.embedding, e.embedding_model
      from obsidian.notes n
      join obsidian.note_embeddings e on e.note_id = n.id
     where n.user_id = p_user_id
       and n.deleted_at is null
       and n.path !~* '(^|/)templates/'
       and n.path !~* '(^|/)(claude|agents)\.md$'
  ),
  kept as materialized (
    select * from eligible where chars >= 20
  ),
  recent as (
    select * from kept where written_at >= p_since
  ),
  older as (
    select * from kept where written_at < p_since
  ),
  pairs as materialized (
    select r.id as r_id, r.path as r_path, r.title as r_title, r.chars as r_chars,
           r.embedding_model as model,
           o.id as o_id, o.path as o_path, o.title as o_title, o.chars as o_chars,
           o.embedding as o_embedding, o.distance
      from recent r
     cross join lateral (
       select older.id, older.path, older.title, older.chars, older.embedding,
              older.embedding <=> r.embedding as distance
         from older
        where older.embedding_model = r.embedding_model
        order by older.embedding <=> r.embedding
        limit least(greatest(coalesce(p_per_note, 5), 1), 20)
     ) o
     where 1 - o.distance >= coalesce(p_min_similarity, 0)
  )
  select p.r_id, p.r_path, p.r_title, p.r_chars,
         p.o_id, p.o_path, p.o_title, p.o_chars,
         (1 - p.distance)::double precision,
         (
           select count(*)::int + 1
             from kept x
            where x.id <> p.o_id
              and x.embedding_model = p.model
              and (x.embedding <=> p.o_embedding) < p.distance
         )
    from pairs p
   order by p.r_path, p.distance
$$;

comment on function obsidian.recent_note_neighbours(uuid, timestamptz, int, double precision) is
  'Each note written in since p_since, with its nearest older notes above p_min_similarity and where it ranks among each older note''s own neighbours (plan #1115).';

revoke all on function obsidian.recent_note_neighbours(uuid, timestamptz, int, double precision)
  from public, anon;
grant execute on function obsidian.recent_note_neighbours(uuid, timestamptz, int, double precision)
  to authenticated, service_role;
