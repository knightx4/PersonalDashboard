-- Keep only what undo and the merge log read in each new merge record.
--
-- A merge record (0009) kept a full copy of every row the merge repointed, and
-- both sides as they were with their embeddings. The copies were for undo, but
-- undo only reads a repointed row's id: the row never left its table, so undo
-- sets its foreign key back by id. The chained theme merges of 23 September
-- (the ones 0016 stopped) each repointed up to 4,900 theme_positions rows, and
-- copying them all put 3,278 records at 180 MB.
--
-- A record now keeps:
--
--   moved       per table, the columns undo and the log read: the id, plus
--               note_id and quote where the log shows the note or quote, and
--               the ends of an edge or tension, which undo compares to put
--               back only the end that was the absorbed row.
--   removed     unchanged. These rows were deleted, so undo re-inserts them
--               whole.
--   snapshots   survivor_before and absorbed without embedding,
--               embedding_model and embedded_at.
--
-- Without the embedding, an undone theme or position comes back unembedded
-- and the map sweep embeds it again (lib/vault/map/embed.ts). Undo used to
-- write the survivor's old vector back; it now leaves the survivor's vector
-- alone when the record has none, so a survivor that kept its name keeps its
-- vector, and a renamed one is re-embedded under the name it gets back.
--
-- A trigger slims each new record, so the merge functions stay as they are.
-- Records written before this migration keep their full copies.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- The columns of a moved row worth keeping, per table. A table not listed
-- keeps its rows whole, so a table a later merge function adds is never
-- slimmed past what its undo needs.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_merge_slim_moved(p_moved jsonb)
returns jsonb
language sql
immutable
set search_path = obsidian, pg_catalog
as $$
  select coalesce(jsonb_object_agg(e.k, case
           when k.cols is null or jsonb_typeof(e.v) <> 'array' then e.v
           else (select coalesce(jsonb_agg(
                          (select coalesce(jsonb_object_agg(c.key, c.value), '{}')
                             from jsonb_each(r.row) c
                            where c.key = any (k.cols))
                          order by r.ord), '[]')
                   from jsonb_array_elements(e.v) with ordinality r (row, ord))
         end), '{}')
    from jsonb_each(coalesce(p_moved, '{}')) e (k, v)
    left join (values
      ('theme_notes', array['id', 'note_id']),
      ('theme_positions', array['id']),
      ('theme_fields', array['id']),
      ('feed_cards', array['id']),
      ('track_offers', array['id']),
      ('position_sources', array['id', 'note_id', 'quote']),
      ('position_edges', array['id', 'from_id', 'to_id']),
      ('tensions', array['id', 'left_id', 'right_id', 'resolution_id'])
    ) k (tbl, cols) on k.tbl = e.k
$$;

-- A theme or position as it was, without its vector.
create or replace function obsidian.map_merge_slim_snapshot(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = obsidian, pg_catalog
as $$
  select p_row - array['embedding', 'embedding_model', 'embedded_at']
$$;

create or replace function obsidian.map_merges_slim()
returns trigger
language plpgsql
set search_path = obsidian, pg_catalog
as $$
begin
  new.moved := obsidian.map_merge_slim_moved(new.moved);
  new.survivor_before := obsidian.map_merge_slim_snapshot(new.survivor_before);
  new.absorbed := obsidian.map_merge_slim_snapshot(new.absorbed);
  return new;
end;
$$;

drop trigger if exists map_merges_slim on obsidian.map_merges;
create trigger map_merges_slim
  before insert on obsidian.map_merges
  for each row execute function obsidian.map_merges_slim();

revoke all on function obsidian.map_merge_slim_moved(jsonb) from public, anon, authenticated;
revoke all on function obsidian.map_merge_slim_snapshot(jsonb) from public, anon, authenticated;
revoke all on function obsidian.map_merges_slim() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Undo a merge.
--
-- Puts the absorbed row back under its own id, gives the survivor back its
-- name (and, for a theme, its about, and its embedding when the record still
-- has one), moves every row the merge moved back to the absorbed side and
-- re-inserts the rows it deleted as duplicates. A moved row deleted since is
-- not brought back; a re-inserted row whose note or other position has gone
-- since is skipped.
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

    -- Name and about first, which clears the embedding when either changes;
    -- then the embedding the survivor had under that name, which the trigger
    -- leaves alone. A record written since 0020 has none, and the map sweep
    -- embeds the survivor again if the rename cleared it.
    update obsidian.themes
       set name = v_before ->> 'name', about = v_before ->> 'about'
     where id = v_s;
    update obsidian.themes t
       set embedding = r.embedding, embedding_model = r.embedding_model, embedded_at = r.embedded_at
      from jsonb_populate_record(null::obsidian.themes, v_before) r
     where t.id = v_s
       and r.embedding is not null;

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
