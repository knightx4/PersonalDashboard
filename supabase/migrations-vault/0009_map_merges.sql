-- Merging two themes or two positions, and undoing a merge (plan #813).
--
-- The merge passes (0007, 0008) propose pairs that are one subject or one
-- position. Every proposal applies (#814 answered C), so a merge has to be
-- undoable in full: the proposals page becomes a log, and undo (#821) is how a
-- wrong verdict is put right.
--
-- A merge repoints; it never lets a delete cascade. Deleting a theme would
-- cascade away its learn.theme_fields row, including a placement moved by
-- hand, and null learn.feed_cards.theme_id, while learn.track_offers.theme_id
-- has no foreign key and would be left pointing at nothing. So each function
-- moves every row that names the absorbed side onto the survivor, deletes a
-- moved row only where the survivor already has the same one, and deletes the
-- absorbed row last, when nothing points at it.
--
--   theme      theme_notes, theme_positions, learn.theme_fields,
--              learn.feed_cards, learn.track_offers
--   position   position_sources, theme_positions, position_edges, tensions
--
-- Every row a merge moves or deletes is copied into obsidian.map_merges as it
-- was, with both themes or positions as they were. obsidian.undo_map_merge
-- puts the absorbed row back under its own id, moves the same rows back and
-- re-inserts the ones that were deleted as duplicates. Rows written after the
-- merge stay on the survivor.
--
-- The functions are security definer because the join tables deliberately
-- carry no update grant (tests/rls-vault.test.ts) and learn.track_offers has
-- none for a signed-in person. They check the owner themselves: a signed-in
-- caller can only merge their own rows, and a caller with no user (the
-- service role, for #820's run) can merge any owner's pair, as the merge
-- passes already do.

set search_path = obsidian, public, extensions;

create table obsidian.map_merges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  kind text not null,
  -- No foreign keys: the absorbed row is gone while the merge stands, and the
  -- survivor can itself be merged away later.
  survivor_id uuid not null,
  absorbed_id uuid not null,
  -- The proposal this merge applied, when it came from one.
  proposal_id uuid references obsidian.map_merge_proposals (id) on delete set null,

  -- Both rows as they were before the merge, embedding included.
  survivor_before jsonb not null,
  absorbed jsonb not null,
  -- Per table, the rows repointed at the survivor and the rows deleted because
  -- the survivor already had them, each as it was before the merge.
  moved jsonb not null default '{}'::jsonb,
  removed jsonb not null default '{}'::jsonb,

  merged_at timestamptz not null default now(),
  undone_at timestamptz,

  constraint map_merges_kind_ck check (kind in ('theme', 'position')),
  constraint map_merges_pair_ck check (survivor_id <> absorbed_id)
);

create index map_merges_user_idx on obsidian.map_merges (user_id, merged_at desc);
create index map_merges_proposal_idx on obsidian.map_merges (proposal_id)
  where proposal_id is not null;

alter table obsidian.map_merges enable row level security;

-- The owner reads the log. Only the functions below write it.
create policy map_merges_select on obsidian.map_merges for select to authenticated
  using (user_id = (select auth.uid()));

grant select on obsidian.map_merges to authenticated;
grant select, insert, update, delete on obsidian.map_merges to service_role;
revoke all on obsidian.map_merges from anon;

-- ---------------------------------------------------------------------------
-- The owner check both merge functions share. Returns the owner of the two
-- rows, which must be one person, and refuses a signed-in caller who is not
-- that person as though the rows were not there.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_merge_owner(p_owner_a uuid, p_owner_b uuid)
returns uuid
language plpgsql
stable
set search_path = obsidian, pg_catalog
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if p_owner_a is null or p_owner_b is null or p_owner_a <> p_owner_b
     or (v_caller is not null and v_caller <> p_owner_a) then
    raise exception 'One of the two is not in the map.'
      using errcode = 'P0002';
  end if;
  return p_owner_a;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checks a proposal named by a merge: the caller's, the same kind, the same
-- pair.
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
       and m.a_id = least(p_x, p_y)
       and m.b_id = greatest(p_x, p_y)
  ) then
    raise exception 'That proposal is not about this pair.'
      using errcode = 'P0001', detail = 'proposal-mismatch';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Merge one theme into another.
--
-- `p_name` is the name the survivor carries afterwards (a proposal's
-- survivor_name); null keeps its own. The survivor keeps its `about`. A new
-- name clears its embedding through themes_clear_stale_embedding, and the map
-- sweep embeds it again.
--
-- A field placement moved by hand beats an automatic one: when both themes are
-- placed, the survivor keeps its own placement unless only the absorbed one
-- was moved by hand.
-- ---------------------------------------------------------------------------
create or replace function obsidian.merge_themes(
  p_survivor_id uuid,
  p_absorbed_id uuid,
  p_name text default null,
  p_proposal_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = obsidian, pg_catalog
as $$
declare
  v_s obsidian.themes;
  v_a obsidian.themes;
  v_user uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_moved jsonb := '{}'::jsonb;
  v_removed jsonb := '{}'::jsonb;
  v_rows jsonb;
  -- jsonb rather than the row type: learn's tables do not exist yet when a
  -- database is built from the files, vault first (scripts/db-reset.sh).
  v_sf jsonb;
  v_af jsonb;
  v_merge_id uuid;
begin
  if p_survivor_id is null or p_absorbed_id is null or p_survivor_id = p_absorbed_id then
    raise exception 'A merge needs two different themes.'
      using errcode = 'P0001', detail = 'invalid';
  end if;

  -- Both rows, locked in id order so two merges over one theme cannot deadlock.
  perform 1 from obsidian.themes
   where id in (p_survivor_id, p_absorbed_id) order by id for update;
  select * into v_s from obsidian.themes where id = p_survivor_id;
  select * into v_a from obsidian.themes where id = p_absorbed_id;
  v_user := obsidian.map_merge_owner(v_s.user_id, v_a.user_id);
  perform obsidian.map_merge_check_proposal(p_proposal_id, v_user, 'theme', v_s.id, v_a.id);

  if v_name is not null and exists (
    select 1 from obsidian.themes t
     where t.user_id = v_user and lower(t.name) = lower(v_name)
       and t.id not in (v_s.id, v_a.id)
  ) then
    raise exception 'Another theme is already called "%".', v_name
      using errcode = 'P0001', detail = 'name-taken';
  end if;

  -- Notes: the survivor already holding a note keeps its own row.
  with gone as (
    delete from obsidian.theme_notes x
     where x.theme_id = v_a.id
       and exists (select 1 from obsidian.theme_notes y
                    where y.theme_id = v_s.id and y.note_id = x.note_id)
    returning x.*
  )
  select coalesce(jsonb_agg(to_jsonb(gone)), '[]') into v_rows from gone;
  v_removed := v_removed || jsonb_build_object('theme_notes', v_rows);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows
    from obsidian.theme_notes x where x.theme_id = v_a.id;
  update obsidian.theme_notes set theme_id = v_s.id where theme_id = v_a.id;
  v_moved := v_moved || jsonb_build_object('theme_notes', v_rows);

  -- Positions filed under the theme, the same way.
  with gone as (
    delete from obsidian.theme_positions x
     where x.theme_id = v_a.id
       and exists (select 1 from obsidian.theme_positions y
                    where y.theme_id = v_s.id and y.position_id = x.position_id)
    returning x.*
  )
  select coalesce(jsonb_agg(to_jsonb(gone)), '[]') into v_rows from gone;
  v_removed := v_removed || jsonb_build_object('theme_positions', v_rows);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows
    from obsidian.theme_positions x where x.theme_id = v_a.id;
  update obsidian.theme_positions set theme_id = v_s.id where theme_id = v_a.id;
  v_moved := v_moved || jsonb_build_object('theme_positions', v_rows);

  -- Field placement: one row per theme.
  select to_jsonb(x) into v_sf from learn.theme_fields x where x.user_id = v_user and x.theme_id = v_s.id;
  select to_jsonb(x) into v_af from learn.theme_fields x where x.user_id = v_user and x.theme_id = v_a.id;
  v_rows := '[]';
  if v_af is not null and v_sf is not null then
    if (v_af ->> 'moved_by_hand')::boolean and not (v_sf ->> 'moved_by_hand')::boolean then
      delete from learn.theme_fields where id = (v_sf ->> 'id')::uuid;
      v_removed := v_removed || jsonb_build_object('theme_fields', jsonb_build_array(v_sf));
      update learn.theme_fields set theme_id = v_s.id where id = (v_af ->> 'id')::uuid;
      v_rows := jsonb_build_array(v_af);
    else
      delete from learn.theme_fields where id = (v_af ->> 'id')::uuid;
      v_removed := v_removed || jsonb_build_object('theme_fields', jsonb_build_array(v_af));
    end if;
  elsif v_af is not null then
    update learn.theme_fields set theme_id = v_s.id where id = (v_af ->> 'id')::uuid;
    v_rows := jsonb_build_array(v_af);
  end if;
  v_moved := v_moved || jsonb_build_object('theme_fields', v_rows);

  -- Feed cards and track offers keep the theme name they were written under.
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows
    from learn.feed_cards x where x.user_id = v_user and x.theme_id = v_a.id;
  update learn.feed_cards set theme_id = v_s.id where user_id = v_user and theme_id = v_a.id;
  v_moved := v_moved || jsonb_build_object('feed_cards', v_rows);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows
    from learn.track_offers x where x.user_id = v_user and x.theme_id = v_a.id;
  update learn.track_offers set theme_id = v_s.id where user_id = v_user and theme_id = v_a.id;
  v_moved := v_moved || jsonb_build_object('track_offers', v_rows);

  -- Nothing points at it now, so nothing cascades.
  delete from obsidian.themes where id = v_a.id;

  if v_name is not null and v_name is distinct from v_s.name then
    update obsidian.themes set name = v_name where id = v_s.id;
  end if;

  perform obsidian.refresh_theme_strength(array[v_s.id]);

  insert into obsidian.map_merges
    (user_id, kind, survivor_id, absorbed_id, proposal_id, survivor_before, absorbed, moved, removed)
  values
    (v_user, 'theme', v_s.id, v_a.id, p_proposal_id, to_jsonb(v_s), to_jsonb(v_a), v_moved, v_removed)
  returning id into v_merge_id;

  return obsidian.map_merge_summary(v_merge_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Merge one position into another.
--
-- `p_name` is the short name the survivor carries afterwards; its statement,
-- kind and stance stay its own. The survivor is grounded afterwards if either
-- side was. Edges and tensions that would join the survivor to itself are
-- deleted, and so is an edge or a tension the survivor already has.
-- ---------------------------------------------------------------------------
create or replace function obsidian.merge_positions(
  p_survivor_id uuid,
  p_absorbed_id uuid,
  p_name text default null,
  p_proposal_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = obsidian, pg_catalog
as $$
declare
  v_s obsidian.positions;
  v_a obsidian.positions;
  v_user uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_moved jsonb := '{}'::jsonb;
  v_removed jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_themes uuid[];
  v_merge_id uuid;
begin
  if p_survivor_id is null or p_absorbed_id is null or p_survivor_id = p_absorbed_id then
    raise exception 'A merge needs two different positions.'
      using errcode = 'P0001', detail = 'invalid';
  end if;

  perform 1 from obsidian.positions
   where id in (p_survivor_id, p_absorbed_id) order by id for update;
  select * into v_s from obsidian.positions where id = p_survivor_id;
  select * into v_a from obsidian.positions where id = p_absorbed_id;
  v_user := obsidian.map_merge_owner(v_s.user_id, v_a.user_id);
  perform obsidian.map_merge_check_proposal(p_proposal_id, v_user, 'position', v_s.id, v_a.id);

  -- Quotes: the same sentence from the same note already on the survivor.
  with gone as (
    delete from obsidian.position_sources x
     where x.position_id = v_a.id
       and exists (select 1 from obsidian.position_sources y
                    where y.position_id = v_s.id and y.note_id = x.note_id and y.quote = x.quote)
    returning x.*
  )
  select coalesce(jsonb_agg(to_jsonb(gone)), '[]') into v_rows from gone;
  v_removed := v_removed || jsonb_build_object('position_sources', v_rows);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows
    from obsidian.position_sources x where x.position_id = v_a.id;
  update obsidian.position_sources set position_id = v_s.id where position_id = v_a.id;
  v_moved := v_moved || jsonb_build_object('position_sources', v_rows);

  -- Themes the position is filed under.
  with gone as (
    delete from obsidian.theme_positions x
     where x.position_id = v_a.id
       and exists (select 1 from obsidian.theme_positions y
                    where y.position_id = v_s.id and y.theme_id = x.theme_id)
    returning x.*
  )
  select coalesce(jsonb_agg(to_jsonb(gone)), '[]') into v_rows from gone;
  v_removed := v_removed || jsonb_build_object('theme_positions', v_rows);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows
    from obsidian.theme_positions x where x.position_id = v_a.id;
  update obsidian.theme_positions set position_id = v_s.id where position_id = v_a.id;
  v_moved := v_moved || jsonb_build_object('theme_positions', v_rows);

  -- Edges. One between the two becomes a loop, and one the survivor already
  -- has with the same other end and type becomes a duplicate.
  with gone as (
    delete from obsidian.position_edges x
     where (x.from_id = v_a.id or x.to_id = v_a.id)
       and (
         x.from_id in (v_a.id, v_s.id) and x.to_id in (v_a.id, v_s.id)
         or exists (
           select 1 from obsidian.position_edges y
            where y.from_id = case when x.from_id = v_a.id then v_s.id else x.from_id end
              and y.to_id = case when x.to_id = v_a.id then v_s.id else x.to_id end
              and y.type = x.type
         )
       )
    returning x.*
  )
  select coalesce(jsonb_agg(to_jsonb(gone)), '[]') into v_rows from gone;
  v_removed := v_removed || jsonb_build_object('position_edges', v_rows);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows
    from obsidian.position_edges x where x.from_id = v_a.id or x.to_id = v_a.id;
  update obsidian.position_edges
     set from_id = case when from_id = v_a.id then v_s.id else from_id end,
         to_id = case when to_id = v_a.id then v_s.id else to_id end
   where from_id = v_a.id or to_id = v_a.id;
  v_moved := v_moved || jsonb_build_object('position_edges', v_rows);

  -- Tensions, the same way. The pair is stored smaller id first, and the
  -- tensions_pair_is_ordered trigger reorders a repointed pair.
  with gone as (
    delete from obsidian.tensions x
     where (x.left_id = v_a.id or x.right_id = v_a.id)
       and (
         x.left_id in (v_a.id, v_s.id) and x.right_id in (v_a.id, v_s.id)
         or exists (
           select 1 from obsidian.tensions y
            where y.left_id = least(v_s.id, case when x.left_id = v_a.id then x.right_id else x.left_id end)
              and y.right_id = greatest(v_s.id, case when x.left_id = v_a.id then x.right_id else x.left_id end)
         )
       )
    returning x.*
  )
  select coalesce(jsonb_agg(to_jsonb(gone)), '[]') into v_rows from gone;
  v_removed := v_removed || jsonb_build_object('tensions', v_rows);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows
    from obsidian.tensions x
   where x.left_id = v_a.id or x.right_id = v_a.id or x.resolution_id = v_a.id;
  update obsidian.tensions
     set left_id = case when left_id = v_a.id then v_s.id else left_id end,
         right_id = case when right_id = v_a.id then v_s.id else right_id end,
         resolution_id = case when resolution_id = v_a.id then v_s.id else resolution_id end
   where left_id = v_a.id or right_id = v_a.id or resolution_id = v_a.id;
  v_moved := v_moved || jsonb_build_object('tensions', v_rows);

  delete from obsidian.positions where id = v_a.id;

  update obsidian.positions
     set name = coalesce(v_name, name),
         ungrounded_at = case when v_a.ungrounded_at is null then null else ungrounded_at end
   where id = v_s.id
     and (name is distinct from coalesce(v_name, name)
          or (v_a.ungrounded_at is null and ungrounded_at is not null));

  -- A theme's strength reads the stance of its positions, per note.
  select coalesce(array_agg(distinct theme_id), '{}') into v_themes
    from obsidian.theme_positions where position_id = v_s.id;
  perform obsidian.refresh_theme_strength(v_themes);

  insert into obsidian.map_merges
    (user_id, kind, survivor_id, absorbed_id, proposal_id, survivor_before, absorbed, moved, removed)
  values
    (v_user, 'position', v_s.id, v_a.id, p_proposal_id, to_jsonb(v_s), to_jsonb(v_a), v_moved, v_removed)
  returning id into v_merge_id;

  return obsidian.map_merge_summary(v_merge_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Undo a merge.
--
-- Puts the absorbed row back under its own id, gives the survivor back its
-- name (and, for a theme, its about and embedding), moves every row the merge
-- moved back to the absorbed side and re-inserts the rows it deleted as
-- duplicates. A moved row deleted since is not brought back; a re-inserted row
-- whose note or other position has gone since is skipped.
--
-- Refused when the survivor has itself been merged away since (undo that
-- merge first), or when a theme now carries the absorbed one's name.
-- ---------------------------------------------------------------------------
create or replace function obsidian.undo_map_merge(p_merge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = obsidian, pg_catalog
as $$
declare
  v_m obsidian.map_merges;
  v_caller uuid := (select auth.uid());
  v_s uuid;
  v_a uuid;
  v_before jsonb;
  v_themes uuid[];
begin
  select * into v_m from obsidian.map_merges where id = p_merge_id for update;
  if v_m.id is null or (v_caller is not null and v_caller <> v_m.user_id) then
    raise exception 'That merge is not in the log.'
      using errcode = 'P0002';
  end if;
  if v_m.undone_at is not null then
    raise exception 'That merge has already been undone.'
      using errcode = 'P0001', detail = 'already-undone';
  end if;

  v_s := v_m.survivor_id;
  v_a := v_m.absorbed_id;
  v_before := v_m.survivor_before;

  if v_m.kind = 'theme' then
    perform 1 from obsidian.themes where id = v_s for update;
    if not found then
      raise exception 'The theme it was merged into has been merged or removed since. Undo that first.'
        using errcode = 'P0001', detail = 'survivor-gone';
    end if;
    if exists (
      select 1 from obsidian.themes t
       where t.user_id = v_m.user_id and t.id <> v_s
         and lower(t.name) in (lower(v_m.absorbed ->> 'name'), lower(v_before ->> 'name'))
    ) then
      raise exception 'Another theme now has one of the two names.'
        using errcode = 'P0001', detail = 'name-taken';
    end if;

    -- Name and about first, which clears the embedding; then the embedding
    -- the survivor had under that name, which the trigger leaves alone.
    update obsidian.themes
       set name = v_before ->> 'name', about = v_before ->> 'about'
     where id = v_s;
    update obsidian.themes t
       set embedding = r.embedding, embedding_model = r.embedding_model, embedded_at = r.embedded_at
      from jsonb_populate_record(null::obsidian.themes, v_before) r
     where t.id = v_s;

    insert into obsidian.themes
    select * from jsonb_populate_record(null::obsidian.themes, v_m.absorbed);

    update obsidian.theme_notes set theme_id = v_a
     where theme_id = v_s
       and id in (select (r ->> 'id')::uuid from jsonb_array_elements(v_m.moved -> 'theme_notes') r);
    insert into obsidian.theme_notes
    select r.* from jsonb_populate_recordset(null::obsidian.theme_notes, v_m.removed -> 'theme_notes') r
     where exists (select 1 from obsidian.notes n where n.id = r.note_id)
    on conflict do nothing;

    update obsidian.theme_positions set theme_id = v_a
     where theme_id = v_s
       and id in (select (r ->> 'id')::uuid from jsonb_array_elements(v_m.moved -> 'theme_positions') r);
    insert into obsidian.theme_positions
    select r.* from jsonb_populate_recordset(null::obsidian.theme_positions, v_m.removed -> 'theme_positions') r
     where exists (select 1 from obsidian.positions p where p.id = r.position_id)
    on conflict do nothing;

    -- The moved placement goes back first, which frees the survivor's slot
    -- for the placement the merge deleted.
    update learn.theme_fields set theme_id = v_a
     where theme_id = v_s
       and id in (select (r ->> 'id')::uuid from jsonb_array_elements(v_m.moved -> 'theme_fields') r);
    insert into learn.theme_fields
    select r.* from jsonb_populate_recordset(null::learn.theme_fields, v_m.removed -> 'theme_fields') r
    on conflict do nothing;

    update learn.feed_cards set theme_id = v_a
     where theme_id = v_s
       and id in (select (r ->> 'id')::uuid from jsonb_array_elements(v_m.moved -> 'feed_cards') r);
    update learn.track_offers set theme_id = v_a
     where theme_id = v_s
       and id in (select (r ->> 'id')::uuid from jsonb_array_elements(v_m.moved -> 'track_offers') r);

    perform obsidian.refresh_theme_strength(array[v_s, v_a]);
  else
    perform 1 from obsidian.positions where id = v_s for update;
    if not found then
      raise exception 'The position it was merged into has been merged or removed since. Undo that first.'
        using errcode = 'P0001', detail = 'survivor-gone';
    end if;

    update obsidian.positions
       set name = v_before ->> 'name',
           ungrounded_at = (v_before ->> 'ungrounded_at')::timestamptz
     where id = v_s;

    insert into obsidian.positions
    select * from jsonb_populate_record(null::obsidian.positions, v_m.absorbed);

    update obsidian.position_sources set position_id = v_a
     where position_id = v_s
       and id in (select (r ->> 'id')::uuid from jsonb_array_elements(v_m.moved -> 'position_sources') r);
    insert into obsidian.position_sources
    select r.* from jsonb_populate_recordset(null::obsidian.position_sources, v_m.removed -> 'position_sources') r
     where exists (select 1 from obsidian.notes n where n.id = r.note_id)
    on conflict do nothing;

    update obsidian.theme_positions set position_id = v_a
     where position_id = v_s
       and id in (select (r ->> 'id')::uuid from jsonb_array_elements(v_m.moved -> 'theme_positions') r);
    insert into obsidian.theme_positions
    select r.* from jsonb_populate_recordset(null::obsidian.theme_positions, v_m.removed -> 'theme_positions') r
     where exists (select 1 from obsidian.themes t where t.id = r.theme_id)
    on conflict do nothing;

    -- Only the end that was the absorbed position goes back; the other end may
    -- have been merged somewhere else since.
    update obsidian.position_edges e
       set from_id = case when r.from_id = v_a and e.from_id = v_s then v_a else e.from_id end,
           to_id = case when r.to_id = v_a and e.to_id = v_s then v_a else e.to_id end
      from jsonb_populate_recordset(null::obsidian.position_edges, v_m.moved -> 'position_edges') r
     where e.id = r.id;
    insert into obsidian.position_edges
    select r.* from jsonb_populate_recordset(null::obsidian.position_edges, v_m.removed -> 'position_edges') r
     where exists (select 1 from obsidian.positions p where p.id = r.from_id)
       and exists (select 1 from obsidian.positions p where p.id = r.to_id)
    on conflict do nothing;

    update obsidian.tensions x
       set left_id = case when (r.left_id = v_a or r.right_id = v_a) and x.left_id = v_s then v_a else x.left_id end,
           right_id = case when (r.left_id = v_a or r.right_id = v_a) and x.right_id = v_s then v_a else x.right_id end,
           resolution_id = case when r.resolution_id = v_a and x.resolution_id = v_s then v_a else x.resolution_id end
      from jsonb_populate_recordset(null::obsidian.tensions, v_m.moved -> 'tensions') r
     where x.id = r.id;
    insert into obsidian.tensions
    select r.* from jsonb_populate_recordset(null::obsidian.tensions, v_m.removed -> 'tensions') r
     where exists (select 1 from obsidian.positions p where p.id = r.left_id)
       and exists (select 1 from obsidian.positions p where p.id = r.right_id)
       and (r.resolution_id is null
            or exists (select 1 from obsidian.positions p where p.id = r.resolution_id))
    on conflict do nothing;

    select coalesce(array_agg(distinct theme_id), '{}') into v_themes
      from obsidian.theme_positions where position_id in (v_s, v_a);
    perform obsidian.refresh_theme_strength(v_themes);
  end if;

  update obsidian.map_merges set undone_at = now() where id = v_m.id;
  return obsidian.map_merge_summary(v_m.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- What a merge did, for the caller and for the log (#821): the pair, and per
-- table how many rows were moved and how many deleted as duplicates.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_merge_summary(p_merge_id uuid)
returns jsonb
language sql
stable
set search_path = obsidian, pg_catalog
as $$
  select jsonb_build_object(
    'mergeId', m.id,
    'kind', m.kind,
    'survivorId', m.survivor_id,
    'absorbedId', m.absorbed_id,
    'proposalId', m.proposal_id,
    'mergedAt', m.merged_at,
    'undoneAt', m.undone_at,
    'moved', (select coalesce(jsonb_object_agg(k, jsonb_array_length(v)), '{}')
                from jsonb_each(m.moved) as e (k, v)),
    'removed', (select coalesce(jsonb_object_agg(k, jsonb_array_length(v)), '{}')
                  from jsonb_each(m.removed) as e (k, v))
  )
  from obsidian.map_merges m
  where m.id = p_merge_id
$$;

revoke all on function obsidian.map_merge_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function obsidian.map_merge_check_proposal(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function obsidian.merge_themes(uuid, uuid, text, uuid) from public, anon;
revoke all on function obsidian.merge_positions(uuid, uuid, text, uuid) from public, anon;
revoke all on function obsidian.undo_map_merge(uuid) from public, anon;
revoke all on function obsidian.map_merge_summary(uuid) from public, anon;
grant execute on function obsidian.merge_themes(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function obsidian.merge_positions(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function obsidian.undo_map_merge(uuid) to authenticated, service_role;
grant execute on function obsidian.map_merge_summary(uuid) to authenticated, service_role;
