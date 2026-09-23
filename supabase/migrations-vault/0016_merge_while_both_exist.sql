-- Merge two themes only while both still exist (plan #878).
--
-- 0013 followed each side of a proposal through the standing merges to the
-- row that holds it now, and merged whatever it landed on. A theme could then
-- grow by being pulled along: once A had absorbed B, a proposal that B and C
-- were one subject merged C into A, although nobody had compared A with C.
-- That is how 634 notes ended up under one theme. Decision #877 answered A:
-- apply a proposal only when both of the themes the model compared are still
-- there.
--
-- So a theme proposal with a side absorbed since it was written is now marked
-- `absorbed` and left alone. The pair it leads to today, the survivor and the
-- other side, is handed to the theme candidate search, which offers it to the
-- next tick as a new pair to judge. The model then compares the two themes as
-- they read now, and a `same` verdict merges them directly.
--
-- Positions keep following earlier merges for now. Decision #880 answered A
-- for them too; that is #882, which needs only to change
-- obsidian.map_merge_follows_merges below and add
-- obsidian.map_merge_absorbed_pairs to position_merge_candidates.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- The new outcome.
--
--   absorbed  a side was merged into another row after the proposal was
--             written, so the two rows the model compared are not both there;
--             nothing was merged
-- ---------------------------------------------------------------------------
alter table obsidian.map_merge_proposals
  drop constraint map_merge_proposals_apply_outcome_ck,
  add constraint map_merge_proposals_apply_outcome_ck check (
    apply_outcome in ('merged', 'joined', 'undone', 'gone', 'failed', 'absorbed')
  );

-- The candidate search reads the absorbed proposals on every tick.
create index if not exists map_merge_proposals_absorbed_idx
  on obsidian.map_merge_proposals (kind, user_id)
  where apply_outcome = 'absorbed';

-- ---------------------------------------------------------------------------
-- Whether the apply run follows a proposal's sides through earlier merges.
-- True only for positions, until #882 applies the same rule to them.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_merge_follows_merges(p_kind text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_kind = 'position'
$$;

-- ---------------------------------------------------------------------------
-- The pairs that absorbed proposals lead to today: for each proposal marked
-- `absorbed`, the row that holds each side now, smaller id first. A proposal
-- whose sides now lead to one row gives no pair. The caller joins the result
-- to the live rows and leaves out pairs already judged or undone.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_merge_absorbed_pairs(p_kind text, p_user_id uuid default null)
returns table (user_id uuid, a_id uuid, b_id uuid)
language sql
stable
security invoker
set search_path = obsidian, pg_catalog
as $$
  select distinct r.user_id, least(r.x, r.y), greatest(r.x, r.y)
    from (
      select m.user_id,
             obsidian.map_merge_resolve(p_kind, m.a_id) as x,
             obsidian.map_merge_resolve(p_kind, m.b_id) as y
        from obsidian.map_merge_proposals m
       where m.kind = p_kind
         and m.apply_outcome = 'absorbed'
         and (p_user_id is null or m.user_id = p_user_id)
    ) r
   where r.x <> r.y
$$;

-- ---------------------------------------------------------------------------
-- The apply run from 0013. The one change is the `absorbed` branch: for a
-- kind that does not follow merges, a proposal with either side no longer
-- itself is marked and skipped before anything else is tried.
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
  v_follows boolean;
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
  v_counts jsonb := jsonb_build_object(
    'merged', 0, 'joined', 0, 'undone', 0, 'gone', 0, 'failed', 0, 'absorbed', 0
  );
  v_remaining int;
begin
  if p_kind is null or p_kind not in ('theme', 'position') then
    raise exception 'Apply needs a kind, theme or position.'
      using errcode = 'P0001', detail = 'invalid';
  end if;
  v_follows := obsidian.map_merge_follows_merges(p_kind);

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

    if not v_follows and (v_a <> r.a_id or v_b <> r.b_id) then
      v_outcome := 'absorbed';
    elsif v_a = v_b then
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
  'Merges every same-subject proposal of one kind not yet applied and marks each with the outcome (plan #820). A theme proposal with a side absorbed since it was written is marked absorbed and not merged (plan #878).';

-- ---------------------------------------------------------------------------
-- The theme candidate search from 0013, with the pairs absorbed proposals
-- lead to added. Same signature, rows and order, except that those pairs come
-- first: the model already judged their sides one subject, and each is
-- waiting on this search to be judged again as the two themes stand now.
--
-- They are offered whatever their similarity, since the floors are for
-- finding pairs and these were found already. `similarity` is their
-- embedding similarity; `trigram` is set only when a side has no embedding,
-- so the proposal's `source` still says what the pair was compared on.
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

-- theme_merge_candidates is granted to authenticated as well as service_role
-- (0007) and runs as its caller, so the caller needs these two as well.
-- map_merge_resolve reads map_merges, which RLS already limits to the
-- caller's own rows.
revoke all on function obsidian.map_merge_follows_merges(text) from public, anon;
revoke all on function obsidian.map_merge_absorbed_pairs(text, uuid) from public, anon;
grant execute on function obsidian.map_merge_follows_merges(text) to authenticated, service_role;
grant execute on function obsidian.map_merge_absorbed_pairs(text, uuid) to authenticated, service_role;
grant execute on function obsidian.map_merge_resolve(text, uuid) to authenticated;
