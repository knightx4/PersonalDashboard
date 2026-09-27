-- Changing a learning goal's outline from its plan page (plan #1144).
--
-- Units were written once and never changed (0038). A goal's plan now lets
-- the person move a unit, remove one they do not need, and add one by name.
-- Each is a function here rather than an update or delete granted on the
-- table, for two reasons:
--
--   1. Ordinals are unique per track and the constraint is checked row by row,
--      so moving a unit means shifting every unit past the rest first. That
--      has to happen in one transaction, which one supabase-js call cannot
--      give across several rows.
--   2. A unit with a passed piece can be moved but not removed. A delete
--      granted on the table would let the rule be skipped; a function cannot
--      be.
--
-- The table keeps its grants: a signed-in user still reads and inserts units
-- and changes them only through these. Each function is security definer,
-- checks the unit or track belongs to auth.uid() before touching anything,
-- and locks the track's row so two edits to one outline run one after the
-- other.
--
-- Removing a unit takes its pieces with it (the cascade from 0073), and any
-- goal still open under it is marked abandoned, so its chain is not laid out
-- or taught as part of the plan. The goal's ideas and what the person showed
-- about them stay: those belong to the track, not to the unit.
--
-- After every change the ordinals run 1, 2, 3 with no gaps, which is what the
-- plan page numbers the units by.

set search_path = learn, public, extensions;

-- Renumber a track's units in the order given by `ids`, which must be every
-- unit of the track. Internal: called by the three functions below, never
-- granted.
create or replace function learn.renumber_curriculum_units(p_subject_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  shift integer;
begin
  select coalesce(max(ordinal), 0) + coalesce(array_length(p_ids, 1), 0) + 1
    into shift
    from learn.curriculum_units
   where subject_id = p_subject_id;

  -- Past every ordinal in use first, so no row lands on one still taken.
  update learn.curriculum_units
     set ordinal = ordinal + shift
   where subject_id = p_subject_id;

  update learn.curriculum_units u
     set ordinal = o.position
    from unnest(p_ids) with ordinality as o (id, position)
   where u.id = o.id
     and u.subject_id = p_subject_id;
end;
$$;

revoke all on function learn.renumber_curriculum_units(uuid, uuid[]) from public, anon, authenticated;

-- Move one unit to place `p_to` (from 1) in its track. A place past the end
-- is the end.
create or replace function learn.move_curriculum_unit(p_unit_id uuid, p_to integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  track uuid;
  ids uuid[];
  place integer;
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select subject_id into track
    from learn.curriculum_units
   where id = p_unit_id and user_id = me;
  if track is null then
    raise exception 'No unit of yours has that id.' using errcode = 'P0002';
  end if;

  perform 1 from learn.subjects where id = track and user_id = me for update;

  select coalesce(array_agg(id order by ordinal), '{}') into ids
    from learn.curriculum_units
   where subject_id = track and id <> p_unit_id;

  place := greatest(1, least(coalesce(p_to, 1), coalesce(array_length(ids, 1), 0) + 1));
  ids := ids[1:place - 1] || p_unit_id || ids[place:];

  perform learn.renumber_curriculum_units(track, ids);
end;
$$;

-- Remove one unit that has no passed piece, and close up the numbering.
create or replace function learn.remove_curriculum_unit(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  track uuid;
  ids uuid[];
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select subject_id into track
    from learn.curriculum_units
   where id = p_unit_id and user_id = me;
  if track is null then
    raise exception 'No unit of yours has that id.' using errcode = 'P0002';
  end if;

  perform 1 from learn.subjects where id = track and user_id = me for update;

  if exists (
    select 1 from learn.plan_pieces
     where unit_id = p_unit_id and user_id = me and passed_at is not null
  ) then
    raise exception 'This unit has a passed piece, so it can be moved but not removed.'
      using errcode = 'P0001', hint = 'unit_has_passed_pieces';
  end if;

  update learn.goals
     set status = 'abandoned', updated_at = now()
   where unit_id = p_unit_id
     and user_id = me
     and status in ('proposed', 'active');

  delete from learn.curriculum_units where id = p_unit_id and user_id = me;

  select coalesce(array_agg(id order by ordinal), '{}') into ids
    from learn.curriculum_units
   where subject_id = track;

  perform learn.renumber_curriculum_units(track, ids);
end;
$$;

-- Add a unit at the end of a track and return its id. `p_write_model` names
-- the model that wrote its covers and outcome, or is null when they are the
-- person's title alone.
create or replace function learn.add_curriculum_unit(
  p_subject_id uuid,
  p_title text,
  p_covers text,
  p_outcome text,
  p_write_model text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  next_place integer;
  added uuid;
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  perform 1 from learn.subjects where id = p_subject_id and user_id = me for update;
  if not found then
    raise exception 'No track of yours has that id.' using errcode = 'P0002';
  end if;

  select coalesce(max(ordinal), 0) + 1 into next_place
    from learn.curriculum_units
   where subject_id = p_subject_id;

  insert into learn.curriculum_units (user_id, subject_id, ordinal, title, covers, outcome, write_model)
  values (me, p_subject_id, next_place, btrim(p_title), coalesce(p_covers, ''), coalesce(p_outcome, ''), p_write_model)
  returning id into added;

  return added;
end;
$$;

revoke all on function learn.move_curriculum_unit(uuid, integer) from public, anon;
revoke all on function learn.remove_curriculum_unit(uuid) from public, anon;
revoke all on function learn.add_curriculum_unit(uuid, text, text, text, text) from public, anon;
grant execute on function learn.move_curriculum_unit(uuid, integer) to authenticated;
grant execute on function learn.remove_curriculum_unit(uuid) to authenticated;
grant execute on function learn.add_curriculum_unit(uuid, text, text, text, text) to authenticated;
