-- Applying every merge the model proposes (plan #820).
--
-- Decision #814 answered C: every pair the merge passes (#811, #812) judged to
-- be one subject is merged, with no review first, and the proposals become a
-- log you can undo from (#821). This adds the run that does the merging, the
-- marks it leaves on each proposal, and the rule that keeps an undone pair
-- apart afterwards.
--
-- Proposals chain. Once A has absorbed B, a proposal that B and C are one
-- subject is about A and C: B's rows all live on A now. So each side of a
-- proposal is followed through the standing merges to the row that holds it
-- today, and the merge is made between those. Applying every `same` verdict
-- this way joins each group of proposals into one row, whatever order they
-- are applied in. When both sides already lead to one row there is nothing
-- left to do, and the proposal is marked joined.
--
-- An undone pair stays apart. The apply run skips a proposal whose two sides
-- lead to a pair that has an undone merge between them, and the candidate
-- searches leave out such a pair as well, so the passes do not pay the model
-- to judge it again. A pair undone straight from its own proposal was already
-- left out of the searches, since they skip any pair with a proposal; the
-- extra check covers a pair that was only merged through a chain.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- What the apply run did with a proposal. Null until it has been looked at.
--
--   merged   merged; obsidian.map_merges.proposal_id names this proposal
--   joined   both sides already led to one row, so nothing was merged
--   undone   the two sides lead to a pair whose merge was undone
--   gone     a side is no longer in the map
--   failed   the merge function refused; apply_detail has its message
--
-- A `different` verdict is never applied, so its row stays null.
-- ---------------------------------------------------------------------------
alter table obsidian.map_merge_proposals
  add column applied_at timestamptz,
  add column apply_outcome text,
  add column apply_detail text,
  add constraint map_merge_proposals_apply_outcome_ck check (
    apply_outcome in ('merged', 'joined', 'undone', 'gone', 'failed')
  ),
  add constraint map_merge_proposals_applied_ck check (
    (applied_at is null) = (apply_outcome is null)
  );

-- The run's queue: `same` verdicts not yet looked at.
create index map_merge_proposals_unapplied_idx
  on obsidian.map_merge_proposals (kind, user_id, confidence desc, created_at)
  where verdict = 'same' and applied_at is null;

-- Following a row through the standing merges reads by absorbed id.
create index map_merges_standing_absorbed_idx
  on obsidian.map_merges (absorbed_id)
  where undone_at is null;

-- The undone pairs, smaller id first, for the searches and the run.
create index map_merges_undone_pair_idx
  on obsidian.map_merges (
    user_id, kind, least(survivor_id, absorbed_id), greatest(survivor_id, absorbed_id)
  )
  where undone_at is not null;

-- ---------------------------------------------------------------------------
-- The row that holds a theme or position today: itself, or the survivor of
-- the standing merge that absorbed it, followed until a row that has not been
-- absorbed. A row removed some other way leads to itself, and the merge
-- function then reports it gone.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_merge_resolve(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
set search_path = obsidian, pg_catalog
as $$
declare
  v_id uuid := p_id;
  v_next uuid;
  v_steps int := 0;
begin
  loop
    select m.survivor_id into v_next
      from obsidian.map_merges m
     where m.absorbed_id = v_id and m.kind = p_kind and m.undone_at is null
     order by m.merged_at desc
     limit 1;
    -- A cycle cannot form, since an absorbed row is deleted, but a bound
    -- costs nothing.
    exit when v_next is null or v_steps >= 1000;
    v_id := v_next;
    v_steps := v_steps + 1;
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Whether a merge between these two was undone. Either order.
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
       and least(m.survivor_id, m.absorbed_id) = least(p_x, p_y)
       and greatest(m.survivor_id, m.absorbed_id) = greatest(p_x, p_y)
  )
$$;

-- ---------------------------------------------------------------------------
-- The proposal check from 0009, now accepting a proposal whose sides lead to
-- the pair being merged, so a chained merge is recorded against the proposal
-- that asked for it.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_merge_check_proposal(
  p_proposal_id uuid,
  p_user_id uuid,
  p_kind text,
  p_x uuid,
  p_y uuid
)
returns void
language plpgsql
stable
set search_path = obsidian, pg_catalog
as $$
begin
  if p_proposal_id is null then
    return;
  end if;
  if not exists (
    select 1 from obsidian.map_merge_proposals m
     where m.id = p_proposal_id
       and m.user_id = p_user_id
       and m.kind = p_kind
       and (
         (m.a_id = least(p_x, p_y) and m.b_id = greatest(p_x, p_y))
         or (
           least(obsidian.map_merge_resolve(p_kind, m.a_id), obsidian.map_merge_resolve(p_kind, m.b_id))
             = least(p_x, p_y)
           and greatest(obsidian.map_merge_resolve(p_kind, m.a_id), obsidian.map_merge_resolve(p_kind, m.b_id))
             = greatest(p_x, p_y)
         )
       )
  ) then
    raise exception 'That proposal is not about this pair.'
      using errcode = 'P0001', detail = 'proposal-mismatch';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Apply the `same` proposals of one kind that have not been looked at.
--
-- Surest first within each owner, then in the order they were judged. Each
-- proposal is merged through obsidian.merge_themes or merge_positions and
-- marked with what happened. The survivor is the side the model chose; the
-- name it suggested is used only when neither side has been merged or renamed
-- since it was judged, since it was chosen for those two names. A suggested
-- name another row already has is dropped and the survivor keeps its own.
--
-- Stops after `p_limit` proposals or `p_budget_ms` milliseconds, whichever
-- comes first, so a call through PostgREST stays inside its eight seconds; the
-- caller calls again until `remaining` is 0. `p_user_id` null means every
-- owner, for the service-role cron.
-- ---------------------------------------------------------------------------
create or replace function obsidian.apply_merge_proposals(
  p_kind text,
  p_user_id uuid default null,
  p_limit int default 500,
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
  r obsidian.map_merge_proposals;
  v_a uuid;
  v_b uuid;
  v_s uuid;
  v_x uuid;
  v_name text;
  v_label_a text;
  v_label_b text;
  v_outcome text;
  v_detail text;
  v_state text;
  v_message text;
  v_err_detail text;
  v_counts jsonb := jsonb_build_object('merged', 0, 'joined', 0, 'undone', 0, 'gone', 0, 'failed', 0);
  v_remaining int;
begin
  if p_kind is null or p_kind not in ('theme', 'position') then
    raise exception 'Apply needs a kind, theme or position.'
      using errcode = 'P0001', detail = 'invalid';
  end if;

  for r in
    select *
      from obsidian.map_merge_proposals m
     where m.kind = p_kind
       and m.verdict = 'same'
       and m.applied_at is null
       and (p_user_id is null or m.user_id = p_user_id)
     order by m.user_id, m.confidence desc, m.created_at, m.id
     limit greatest(coalesce(p_limit, 500), 1)
  loop
    exit when clock_timestamp() - v_started > v_budget;

    v_a := obsidian.map_merge_resolve(p_kind, r.a_id);
    v_b := obsidian.map_merge_resolve(p_kind, r.b_id);
    v_s := obsidian.map_merge_resolve(p_kind, r.survivor_id);
    v_x := case when v_s = v_a then v_b else v_a end;
    v_detail := null;

    if v_a = v_b then
      v_outcome := 'joined';
    elsif obsidian.map_merge_pair_undone(r.user_id, p_kind, v_a, v_b) then
      v_outcome := 'undone';
    else
      -- The suggested name, when both sides are the rows it was chosen for
      -- and still read as they did then.
      v_name := null;
      if v_a = r.a_id and v_b = r.b_id then
        if p_kind = 'theme' then
          select t.name into v_label_a from obsidian.themes t where t.id = v_a;
          select t.name into v_label_b from obsidian.themes t where t.id = v_b;
        else
          select p.statement into v_label_a from obsidian.positions p where p.id = v_a;
          select p.statement into v_label_b from obsidian.positions p where p.id = v_b;
        end if;
        if v_label_a = r.a_name and v_label_b = r.b_name then
          v_name := r.survivor_name;
        end if;
      end if;

      begin
        if p_kind = 'theme' then
          perform obsidian.merge_themes(v_s, v_x, v_name, r.id);
        else
          perform obsidian.merge_positions(v_s, v_x, v_name, r.id);
        end if;
        v_outcome := 'merged';
      exception when others then
        get stacked diagnostics
          v_state = returned_sqlstate,
          v_message = message_text,
          v_err_detail = pg_exception_detail;
        if v_name is not null and (v_err_detail = 'name-taken' or v_state = '23505') then
          begin
            if p_kind = 'theme' then
              perform obsidian.merge_themes(v_s, v_x, null, r.id);
            else
              perform obsidian.merge_positions(v_s, v_x, null, r.id);
            end if;
            v_outcome := 'merged';
            v_detail := 'Kept the surviving name: ' || v_message;
          exception when others then
            get stacked diagnostics
              v_state = returned_sqlstate,
              v_message = message_text;
            v_outcome := case when v_state = 'P0002' then 'gone' else 'failed' end;
            v_detail := v_message;
          end;
        else
          v_outcome := case when v_state = 'P0002' then 'gone' else 'failed' end;
          v_detail := v_message;
        end if;
      end;
    end if;

    update obsidian.map_merge_proposals
       set applied_at = now(), apply_outcome = v_outcome, apply_detail = v_detail
     where id = r.id;
    v_counts := jsonb_set(v_counts, array[v_outcome], to_jsonb((v_counts ->> v_outcome)::int + 1));
  end loop;

  select count(*)::int into v_remaining
    from obsidian.map_merge_proposals m
   where m.kind = p_kind
     and m.verdict = 'same'
     and m.applied_at is null
     and (p_user_id is null or m.user_id = p_user_id);

  return v_counts || jsonb_build_object('kind', p_kind, 'remaining', v_remaining);
end;
$$;

comment on function obsidian.apply_merge_proposals(text, uuid, int, int) is
  'Merges every same-subject proposal of one kind not yet applied, following each side through earlier merges, and marks each proposal with the outcome (plan #820).';

-- ---------------------------------------------------------------------------
-- The candidate searches, as 0011 and 0012 left them, with an undone pair
-- left out. Same signatures, rows and order.
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
     and not exists (
       select 1
         from obsidian.map_merges u
        where u.user_id = p.user_id
          and u.kind = 'theme'
          and u.undone_at is not null
          and least(u.survivor_id, u.absorbed_id) = p.a_id
          and greatest(u.survivor_id, u.absorbed_id) = p.b_id
     )
   order by p.user_id,
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

revoke all on function obsidian.map_merge_resolve(text, uuid) from public, anon, authenticated;
revoke all on function obsidian.map_merge_pair_undone(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function obsidian.apply_merge_proposals(text, uuid, int, int) from public, anon, authenticated;
grant execute on function obsidian.map_merge_resolve(text, uuid) to service_role;
grant execute on function obsidian.map_merge_pair_undone(uuid, text, uuid, uuid) to service_role;
grant execute on function obsidian.apply_merge_proposals(text, uuid, int, int) to service_role;
