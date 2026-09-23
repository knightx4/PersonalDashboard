-- Undoing merges because the rule that made them changed (plan #879).
--
-- Decision #877 answered A: undo every theme merge made so far, and apply a
-- proposal only when both of its themes still exist (0016). The merges being
-- undone here were made under the old rule, which followed a proposal's sides
-- through earlier merges, and 811 of the 1,282 were made through such a chain.
--
-- An undo the person makes keeps the pair apart for good (0013): the apply run
-- marks a proposal for that pair `undone`, and both candidate searches leave
-- the pair out. These undos are not the person's verdict on any pair, so they
-- must not do that. map_merges.undo_reason says why a merge was undone: null
-- when the person undid it through obsidian.undo_map_merge, `rule-change` when
-- it was undone here. Only a null reason keeps a pair apart.
--
-- The run is obsidian.undo_merges_for_rule, called until `remaining` is 0,
-- then obsidian.requeue_merge_proposals, which clears the apply marks so the
-- next ticks apply the proposals again under the current rule. Every merge the
-- run tries gets a row in obsidian.map_merge_resets, undone or failed, with
-- the refusal when it failed. That table is the record of what a run did, and
-- a second call skips any merge it already tried.
--
-- For #879 it was run against the live project as:
--
--   select obsidian.undo_merges_for_rule('theme', 'plan #879',
--            '2026-09-23 19:28:29+00', null, false, 2000, 60000);  -- until remaining = 0
--   select obsidian.requeue_merge_proposals('theme', 'plan #879',
--            '2026-09-23 19:28:29+00');
--
-- The cutoff is when #879 was claimed.
--
-- #883 undid the chained position merges with the same pair of calls, kind
-- 'position' and p_chained_only true, cutoff when #883 was claimed:
--
--   select obsidian.undo_merges_for_rule('position', 'plan #883',
--            '2026-09-23 20:06:41.27323+00', '<owner>', true, 300, 40000);
--   select obsidian.requeue_merge_proposals('position', 'plan #883',
--            '2026-09-23 20:06:41.27323+00', '<owner>');
--
-- Of the 138 chained merges, 128 were undone and 10 were refused with
-- survivor-gone: nine because a direct merge later absorbed the survivor,
-- and one because its survivor was absorbed by another of the ten. Those ten
-- still stand, and map_merge_resets lists them. The requeue put back 128
-- merged proposals and 72 joined ones. The 576 direct merges were left alone.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- Why a merge was undone.
-- ---------------------------------------------------------------------------
alter table obsidian.map_merges
  add column undo_reason text,
  add constraint map_merges_undo_reason_ck check (
    undo_reason is null or (undo_reason = 'rule-change' and undone_at is not null)
  );

comment on column obsidian.map_merges.undo_reason is
  'Null when the person undid the merge, which keeps the pair apart; rule-change when a reset undid it because the rule that made it changed (plan #879).';

-- The undone-pair index from 0013 now covers only the pairs kept apart.
drop index if exists obsidian.map_merges_undone_pair_idx;
create index map_merges_undone_pair_idx
  on obsidian.map_merges (
    user_id, kind, least(survivor_id, absorbed_id), greatest(survivor_id, absorbed_id)
  )
  where undone_at is not null and undo_reason is null;

-- ---------------------------------------------------------------------------
-- What a reset run did with each merge it tried.
--
--   undone   undone and marked rule-change
--   failed   obsidian.undo_map_merge refused; detail has its code and message
-- ---------------------------------------------------------------------------
create table obsidian.map_merge_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Names the run, such as 'plan #879', so a second call skips what the
  -- first one tried.
  reset text not null,
  kind text not null,
  merge_id uuid not null references obsidian.map_merges (id) on delete cascade,
  outcome text not null,
  detail text,
  tried_at timestamptz not null default now(),

  constraint map_merge_resets_kind_ck check (kind in ('theme', 'position')),
  constraint map_merge_resets_outcome_ck check (outcome in ('undone', 'failed')),
  constraint map_merge_resets_once unique (reset, merge_id)
);

create index map_merge_resets_merge_idx on obsidian.map_merge_resets (merge_id);

alter table obsidian.map_merge_resets enable row level security;

create policy map_merge_resets_select on obsidian.map_merge_resets for select to authenticated
  using (user_id = (select auth.uid()));

grant select on obsidian.map_merge_resets to authenticated;
grant select, insert, update, delete on obsidian.map_merge_resets to service_role;
revoke all on obsidian.map_merge_resets from anon;

-- ---------------------------------------------------------------------------
-- Undo the standing merges of one kind made before `p_before` from a
-- proposal, marking each rule-change. Merges made by hand, with no proposal,
-- are left alone.
--
-- Newest first, since undo_map_merge refuses a merge whose survivor was merged
-- away later. One apply call merges many proposals in one transaction, so
-- they share a merged_at; within it the apply run's own order (surest first,
-- then oldest proposal) is the order they were made, and this runs it
-- backwards. That order also puts a survivor's names back one merge at a
-- time, ending on the name it had before its first merge.
--
-- `p_chained_only` limits the run to merges whose pair differs from the pair
-- its proposal named, which is what #883 undoes for positions.
--
-- Each undo runs in its own subtransaction, so a refusal is recorded in
-- map_merge_resets and the run goes on. Stops after `p_limit` merges or
-- `p_budget_ms` milliseconds; call again until `remaining` is 0.
-- ---------------------------------------------------------------------------
create or replace function obsidian.undo_merges_for_rule(
  p_kind text,
  p_reset text,
  p_before timestamptz,
  p_user_id uuid default null,
  p_chained_only boolean default false,
  p_limit int default 200,
  p_budget_ms int default 4000
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
  r record;
  v_state text;
  v_message text;
  v_detail text;
  v_undone int := 0;
  v_failed int := 0;
  v_remaining int;
begin
  if p_kind is null or p_kind not in ('theme', 'position') then
    raise exception 'A reset needs a kind, theme or position.'
      using errcode = 'P0001', detail = 'invalid';
  end if;
  if nullif(btrim(coalesce(p_reset, '')), '') is null or p_before is null then
    raise exception 'A reset needs a name and a cutoff.'
      using errcode = 'P0001', detail = 'invalid';
  end if;

  for r in
    select m.id, m.user_id
      from obsidian.map_merges m
      join obsidian.map_merge_proposals p on p.id = m.proposal_id
     where m.kind = p_kind
       and m.undone_at is null
       and m.merged_at < p_before
       and (p_user_id is null or m.user_id = p_user_id)
       and (not coalesce(p_chained_only, false)
            or least(m.survivor_id, m.absorbed_id) <> p.a_id
            or greatest(m.survivor_id, m.absorbed_id) <> p.b_id)
       and not exists (
         select 1 from obsidian.map_merge_resets x
          where x.reset = p_reset and x.merge_id = m.id
       )
     order by m.merged_at desc, p.confidence asc, p.created_at desc, p.id desc
     limit greatest(coalesce(p_limit, 200), 1)
  loop
    exit when clock_timestamp() - v_started > v_budget;

    begin
      perform obsidian.undo_map_merge(r.id);
      update obsidian.map_merges set undo_reason = 'rule-change' where id = r.id;
      insert into obsidian.map_merge_resets (user_id, reset, kind, merge_id, outcome)
      values (r.user_id, p_reset, p_kind, r.id, 'undone');
      v_undone := v_undone + 1;
    exception when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text,
        v_detail = pg_exception_detail;
      insert into obsidian.map_merge_resets (user_id, reset, kind, merge_id, outcome, detail)
      values (r.user_id, p_reset, p_kind, r.id, 'failed',
              coalesce(nullif(v_detail, ''), v_state) || ': ' || v_message);
      v_failed := v_failed + 1;
    end;
  end loop;

  select count(*)::int into v_remaining
    from obsidian.map_merges m
    join obsidian.map_merge_proposals p on p.id = m.proposal_id
   where m.kind = p_kind
     and m.undone_at is null
     and m.merged_at < p_before
     and (p_user_id is null or m.user_id = p_user_id)
     and (not coalesce(p_chained_only, false)
          or least(m.survivor_id, m.absorbed_id) <> p.a_id
          or greatest(m.survivor_id, m.absorbed_id) <> p.b_id)
     and not exists (
       select 1 from obsidian.map_merge_resets x
        where x.reset = p_reset and x.merge_id = m.id
     );

  return jsonb_build_object(
    'kind', p_kind, 'undone', v_undone, 'failed', v_failed, 'remaining', v_remaining
  );
end;
$$;

comment on function obsidian.undo_merges_for_rule(text, text, timestamptz, uuid, boolean, int, int) is
  'Undoes the standing merges of one kind made from proposals before a cutoff, newest first, marking each rule-change so the pair is not kept apart, and records each in map_merge_resets (plan #879).';

-- ---------------------------------------------------------------------------
-- After a reset, clear the apply marks so the apply run takes the proposals
-- again under the current rule:
--
--   merged     whose merge this reset undid
--   joined     looked at before the cutoff; nothing was merged for them
--   absorbed   the same
--
-- A proposal whose merge the reset could not undo keeps its mark, since that
-- merge still stands. Call it once the reset's `remaining` is 0: a proposal
-- put back earlier could be merged again before the merges under it are
-- undone.
-- ---------------------------------------------------------------------------
create or replace function obsidian.requeue_merge_proposals(
  p_kind text,
  p_reset text,
  p_before timestamptz,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = obsidian, pg_catalog
as $$
declare
  v_merged int;
  v_other int;
begin
  if p_kind is null or p_kind not in ('theme', 'position') or p_reset is null or p_before is null then
    raise exception 'A requeue needs a kind, the reset and its cutoff.'
      using errcode = 'P0001', detail = 'invalid';
  end if;

  update obsidian.map_merge_proposals p
     set applied_at = null, apply_outcome = null, apply_detail = null
    from obsidian.map_merges m
    join obsidian.map_merge_resets x on x.merge_id = m.id
   where m.proposal_id = p.id
     and x.reset = p_reset
     and x.outcome = 'undone'
     and p.kind = p_kind
     and p.apply_outcome = 'merged'
     and (p_user_id is null or p.user_id = p_user_id);
  get diagnostics v_merged = row_count;

  update obsidian.map_merge_proposals p
     set applied_at = null, apply_outcome = null, apply_detail = null
   where p.kind = p_kind
     and p.verdict = 'same'
     and p.apply_outcome in ('joined', 'absorbed')
     and p.applied_at < p_before
     and (p_user_id is null or p.user_id = p_user_id);
  get diagnostics v_other = row_count;

  return jsonb_build_object('kind', p_kind, 'merged', v_merged, 'joinedOrAbsorbed', v_other);
end;
$$;

comment on function obsidian.requeue_merge_proposals(text, text, timestamptz, uuid) is
  'Clears the apply marks on the proposals a reset undid or that were joined or absorbed before its cutoff, so the apply run takes them again (plan #879).';

-- ---------------------------------------------------------------------------
-- Only a merge the person undid keeps its pair apart. The run's check, and
-- both candidate searches, redefined with that one change.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_merge_pair_undone(
  p_user_id uuid,
  p_kind text,
  p_x uuid,
  p_y uuid
)
returns boolean
language sql
stable
set search_path = obsidian, pg_catalog
as $$
  select exists (
    select 1
      from obsidian.map_merges m
     where m.user_id = p_user_id
       and m.kind = p_kind
       and m.undone_at is not null
       and m.undo_reason is null
       and least(m.survivor_id, m.absorbed_id) = least(p_x, p_y)
       and greatest(m.survivor_id, m.absorbed_id) = greatest(p_x, p_y)
  )
$$;

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
           null::double precision as trigram,
           false as carried
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
$$;

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
            greatest(coalesce(pp.similarity, 0), coalesce(pp.trigram, 0)) desc,
            pp.a_id,
            pp.b_id
   limit greatest(coalesce(p_limit, 20), 1);
end;
$$;

revoke all on function obsidian.undo_merges_for_rule(text, text, timestamptz, uuid, boolean, int, int)
  from public, anon, authenticated;
revoke all on function obsidian.requeue_merge_proposals(text, text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function obsidian.undo_merges_for_rule(text, text, timestamptz, uuid, boolean, int, int)
  to service_role;
grant execute on function obsidian.requeue_merge_proposals(text, text, timestamptz, uuid)
  to service_role;
