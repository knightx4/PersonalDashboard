-- Merge proposals for the map (plan #811).
--
-- The map was built one note at a time, so one subject often sits under two
-- theme names, and 540 of the first sweep's 685 themes cover a single note.
-- The merge pass finds candidate pairs, asks a model whether each pair is one
-- subject, and writes its answer here. Writing a proposal changes no theme:
-- applying a `same` verdict is #820's job, through the merge functions #813
-- adds, and every applied merge is listed from these rows with an undo (#821).
--
-- One table for both kinds, because the position pass (#812) writes into it
-- too. `a_id` and `b_id` name two themes or two positions, per `kind`, so they
-- carry no foreign key; the names are copied in at the time of judging, so a
-- proposal still reads correctly after a merge has renamed or removed a side.
--
-- A pair is judged once. The unique key is what a run checks before asking the
-- model, which keeps a rerun from paying for the same verdict twice, and it is
-- where #820 marks a pair you undid so later runs leave it alone.

set search_path = obsidian, public, extensions;

create table obsidian.map_merge_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  kind text not null,
  -- The pair, smaller id first, so one pair has one row whichever side the
  -- candidate search found it from.
  a_id uuid not null,
  b_id uuid not null,
  -- Theme names, or position statements, as they were when judged.
  a_name text not null,
  b_name text not null,

  -- How the pair was found: embedding neighbours, trigram over the names, or
  -- both. `similarity` is cosine similarity between the two embeddings and
  -- `trigram` the name similarity; each is null when that search did not find
  -- the pair.
  source text not null,
  similarity double precision,
  trigram double precision,

  -- The model's answer. For `same`, which side survives and the name it
  -- should carry; for `different`, neither.
  verdict text not null,
  survivor_id uuid,
  survivor_name text,
  reason text not null,
  confidence numeric not null,
  model text not null,

  created_at timestamptz not null default now(),

  constraint map_merge_proposals_kind_ck check (kind in ('theme', 'position')),
  constraint map_merge_proposals_pair_ck check (a_id < b_id),
  constraint map_merge_proposals_source_ck check (source in ('embedding', 'trigram', 'both')),
  constraint map_merge_proposals_verdict_ck check (verdict in ('same', 'different')),
  constraint map_merge_proposals_survivor_ck check (
    case verdict
      when 'same' then survivor_id in (a_id, b_id) and coalesce(survivor_name, '') <> ''
      else survivor_id is null and survivor_name is null
    end
  ),
  constraint map_merge_proposals_reason_ck check (reason <> ''),
  constraint map_merge_proposals_confidence_ck check (confidence >= 0 and confidence <= 1),
  constraint map_merge_proposals_pair_uq unique (user_id, kind, a_id, b_id)
);

create index map_merge_proposals_user_idx
  on obsidian.map_merge_proposals (user_id, kind, created_at desc);

alter table obsidian.map_merge_proposals enable row level security;

-- The owner reads their proposals, and #820 and #821 update them (applied,
-- undone). The pass itself writes through the service role.
create policy map_merge_proposals_all on obsidian.map_merge_proposals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on obsidian.map_merge_proposals to authenticated, service_role;
revoke all on obsidian.map_merge_proposals from anon;

-- ---------------------------------------------------------------------------
-- Theme pairs worth asking about, and not yet asked.
--
-- Two searches, joined:
--
--   embedding  each embedded theme's `p_neighbours` nearest themes of the same
--              owner by cosine, kept when similarity is at least
--              `p_min_similarity`. The cap is applied to the index scan and
--              the floor afterwards, as in learn.nearest_catalogue_segments.
--   trigram    name pairs at or above `p_min_trigram`, for close spellings a
--              theme with no vector yet would otherwise miss.
--
-- Both floors are parameters because they are properties of the embedding
-- model and of this vault's naming. Every pair returned costs a share of one
-- model call. The 0.7 default was read off the first 192 themes embedded with
-- voyage-4-lite: "Urban design and travel patterns" and "15-minute cities"
-- score 0.80, pairs around 0.72 are about half related, and pairs around 0.65
-- are mostly unrelated.
--
-- `p_user_id` null means every owner, for the service-role cron; a signed-in
-- caller sees only their own themes through RLS either way. Ordered by owner
-- and then closest first, so a run that is cut off has asked about the likely
-- merges before the unlikely ones.
-- ---------------------------------------------------------------------------
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
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
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
   limit greatest(coalesce(p_limit, 20), 1)
$$;

comment on function obsidian.theme_merge_candidates(int, uuid, int, double precision, double precision) is
  'Theme pairs found by embedding neighbours or name trigram that have no merge proposal yet, closest first.';

revoke all on function obsidian.theme_merge_candidates(int, uuid, int, double precision, double precision)
  from public, anon;
grant execute on function obsidian.theme_merge_candidates(int, uuid, int, double precision, double precision)
  to authenticated, service_role;
