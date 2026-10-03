-- ===========================================================================
-- Learning goals become goals in a Learn area (plan #1490).
--
-- Decision 3 of docs/CUT-BACK-SPEC.md, answered 2 October 2026: Learn keeps
-- no list of goals of its own. Each learning goal is a goal on /goals, in an
-- area marked as Learn's, and the person edits it there like any other goal.
--
-- learn.aims stays. It holds what only Learn needs: the depth, the placement
-- in the area grid, the track (subject_id) and the Level 3 list marker, and
-- the feed, plans, flow and survey all read it. What changes is who owns the
-- wording: the goal does. Every aim gets `goal_id`, the goal it belongs to,
-- and the triggers below keep the aim in step with that goal:
--
--   goal title       -> aim name   (cut to the aim's 200 characters)
--   goal done-when   -> aim about  (cut to 1000; empty is no line)
--   goal open, live  -> aim active; parked, done, dropped or archived ->
--                       aim archived, and reopening the goal brings it back
--
-- A changed name or line clears the aim's placement, as rewording one on
-- Learn's own page always has, so it is placed again.
--
-- The other direction is kept too, because Learn's Goals page and the job
-- search's "start this track" still write aims until plan #1491 takes the
-- page away: a new aim gets its goal in the Learn area, and renaming or
-- archiving an aim directly is carried to its goal. That direction only runs
-- for a write made to the aim itself (trigger depth 1), so the two never
-- chase each other, and a goal title longer than an aim name is never cut
-- short by its own echo.
--
-- A goal added to the Learn area, or moved into it, gets an aim. The goal
-- page also shows Learn's progress for it through an ordinary goals.links
-- row of kind 'aim' (0005), which the copy and the triggers write.
--
-- The copy at the end is one goal per existing aim, archived aims as archived
-- goals, nothing deleted. It refuses to finish if any aim is left without a
-- goal.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The Learn area: at most one per person.
-- ---------------------------------------------------------------------------
alter table goals.areas
  add column if not exists learn boolean not null default false;

comment on column goals.areas.learn is
  'True for the area that holds the person''s learning goals (plan #1490). Each goal in it has a learn.aims row (aims.goal_id).';

create unique index if not exists areas_one_learn_uq
  on goals.areas (user_id) where learn;

-- ---------------------------------------------------------------------------
-- The link from aim to goal.
-- ---------------------------------------------------------------------------
alter table learn.aims
  add column if not exists goal_id uuid;

alter table learn.aims
  add constraint aims_goal_fk foreign key (goal_id, user_id)
    references goals.items (id, user_id) on delete set null (goal_id);

create unique index if not exists aims_goal_uq on learn.aims (goal_id)
  where goal_id is not null;

comment on column learn.aims.goal_id is
  'The goal in the Learn area this aim belongs to (goals 0066, plan #1490). The goal owns the name, the line and whether it is active.';

-- ---------------------------------------------------------------------------
-- The person's Learn area, made at the end of their areas when they have none.
-- ---------------------------------------------------------------------------
create or replace function goals.learn_area_for(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_id uuid;
begin
  select a.id into found_id
    from goals.areas a
   where a.user_id = p_user_id and a.learn;
  if found_id is not null then
    return found_id;
  end if;

  insert into goals.areas (user_id, name, position, learn)
  select p_user_id, 'Learn', coalesce(max(a.position), 0) + 10, true
    from goals.areas a
   where a.user_id = p_user_id
  returning id into found_id;
  return found_id;
end;
$$;

revoke all on function goals.learn_area_for(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A goal for an aim that has none, in the Learn area, with its link.
-- ---------------------------------------------------------------------------
create or replace function goals.goal_for_aim(p_aim_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  aim learn.aims%rowtype;
  area uuid;
  new_goal uuid;
begin
  select * into aim from learn.aims where id = p_aim_id;
  if not found then
    return null;
  end if;
  if aim.goal_id is not null then
    return aim.goal_id;
  end if;

  area := goals.learn_area_for(aim.user_id);

  -- The person wrote the aim, so the goal is theirs and approved, as one
  -- they add on /goals is.
  insert into goals.items
    (user_id, level, area_id, title, acceptance, status, approved_at, archived_at, position)
  select aim.user_id, 'goal', area, aim.name, aim.about, 'open', now(), aim.archived_at,
         coalesce(max(i.position), 0) + 10
    from goals.items i
   where i.user_id = aim.user_id and i.level = 'goal' and i.area_id = area
  returning id into new_goal;

  update learn.aims set goal_id = new_goal where id = aim.id;

  -- The link only takes an aim that is live (links_check, 0005).
  if aim.archived_at is null then
    insert into goals.links (user_id, item_id, kind, target_id)
    values (aim.user_id, new_goal, 'aim', aim.id)
    on conflict (item_id, kind, target_id) do nothing;
  end if;

  return new_goal;
end;
$$;

revoke all on function goals.goal_for_aim(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The copy: every aim without a goal gets one, oldest first.
-- ---------------------------------------------------------------------------
do $$
declare
  aim_id uuid;
  missing integer;
begin
  for aim_id in
    select a.id from learn.aims a where a.goal_id is null order by a.user_id, a.created_at
  loop
    perform goals.goal_for_aim(aim_id);
  end loop;

  select count(*) into missing from learn.aims where goal_id is null;
  if missing > 0 then
    raise exception 'learn area copy: % aims were left without a goal', missing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Goal -> aim. Runs for every write to a goal, whoever made it: the values it
-- writes are compared first, so an echo from the other direction changes
-- nothing and stops.
-- ---------------------------------------------------------------------------
create or replace function goals.items_steer_learn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  aim learn.aims%rowtype;
  in_learn boolean;
  live boolean;
  new_name text;
  new_about text;
  new_archived timestamptz;
  reworded boolean;
begin
  select coalesce(a.learn, false) into in_learn
    from goals.areas a where a.id = new.area_id;
  in_learn := coalesce(in_learn, false);
  live := new.status = 'open' and new.archived_at is null;

  select * into aim from learn.aims where goal_id = new.id;

  if not found then
    -- A goal added to the Learn area, or moved into it, becomes a learning
    -- goal. Not when this write came from an aim's own trigger, which links
    -- the aim itself once the goal exists.
    if in_learn and live and pg_trigger_depth() = 1 then
      insert into learn.aims (user_id, name, about, goal_id)
      values (new.user_id,
              left(btrim(new.title), 200),
              nullif(left(btrim(coalesce(new.acceptance, '')), 1000), ''),
              new.id);
    end if;
    return null;
  end if;

  new_name := left(btrim(new.title), 200);
  new_about := nullif(left(btrim(coalesce(new.acceptance, '')), 1000), '');
  -- Moving a goal out of the Learn area stops it steering Learn.
  if in_learn and live then
    new_archived := null;
    -- The Level 3 list is held once (aims_user_list_active_uq): an older copy
    -- of it stays archived while another is active.
    if aim.archived_at is not null and aim.list_source is not null and exists (
      select 1 from learn.aims o
       where o.user_id = aim.user_id and o.id <> aim.id
         and o.list_source = aim.list_source and o.archived_at is null
    ) then
      new_archived := aim.archived_at;
    end if;
  else
    new_archived := coalesce(aim.archived_at, now());
  end if;

  reworded := new_name is distinct from aim.name or new_about is distinct from aim.about;
  if not reworded and new_archived is not distinct from aim.archived_at then
    return null;
  end if;

  if reworded then
    update learn.aims
       set name = new_name,
           about = new_about,
           archived_at = new_archived,
           field_id = null,
           domain_id = null,
           placement_confidence = null,
           placement_basis = null,
           placement_model = null,
           placed_at = null
     where id = aim.id;
  else
    update learn.aims set archived_at = new_archived where id = aim.id;
  end if;

  -- A goal brought back takes its link back, so the goal page shows Learn's
  -- progress again.
  if new_archived is null and aim.archived_at is not null then
    insert into goals.links (user_id, item_id, kind, target_id)
    values (new.user_id, new.id, 'aim', aim.id)
    on conflict (item_id, kind, target_id) do update set archived_at = null;
  end if;

  return null;
end;
$$;

revoke all on function goals.items_steer_learn() from public, anon, authenticated;

create or replace trigger items_steer_learn
  after insert or update of title, acceptance, status, archived_at, area_id on goals.items
  for each row
  when (new.level = 'goal')
  execute function goals.items_steer_learn();

-- ---------------------------------------------------------------------------
-- Aim -> goal, for the writers that still go to learn.aims directly.
-- ---------------------------------------------------------------------------
create or replace function learn.aims_to_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  goal goals.items%rowtype;
  new_title text;
  new_acceptance text;
  new_archived timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.goal_id is null then
      perform goals.goal_for_aim(new.id);
    else
      -- An aim made for a goal (items_steer_learn) takes its link here, once
      -- the aim exists for links_check to find.
      insert into goals.links (user_id, item_id, kind, target_id)
      values (new.user_id, new.goal_id, 'aim', new.id)
      on conflict (item_id, kind, target_id) do nothing;
    end if;
    return null;
  end if;

  -- Only a write made to the aim itself. One made by the goal's trigger is
  -- already the goal's.
  if pg_trigger_depth() > 1 or new.goal_id is null then
    return null;
  end if;

  select * into goal from goals.items where id = new.goal_id and user_id = new.user_id;
  if not found then
    return null;
  end if;

  new_title := case when new.name is distinct from old.name then new.name else goal.title end;
  new_acceptance := case when new.about is distinct from old.about then new.about else goal.acceptance end;
  -- Archiving the aim archives a goal that is still open; a goal already
  -- parked or closed keeps its own state.
  new_archived := case
    when new.archived_at is not null and old.archived_at is null
         and goal.status = 'open' and goal.archived_at is null then now()
    else goal.archived_at
  end;

  if new_title is distinct from goal.title
     or new_acceptance is distinct from goal.acceptance
     or new_archived is distinct from goal.archived_at then
    update goals.items
       set title = new_title, acceptance = new_acceptance, archived_at = new_archived
     where id = goal.id;
  end if;

  return null;
end;
$$;

revoke all on function learn.aims_to_goal() from public, anon, authenticated;

create or replace trigger aims_to_goal_insert
  after insert on learn.aims
  for each row
  execute function learn.aims_to_goal();

create or replace trigger aims_to_goal_update
  after update of name, about, archived_at on learn.aims
  for each row
  when (new.name is distinct from old.name
        or new.about is distinct from old.about
        or new.archived_at is distinct from old.archived_at)
  execute function learn.aims_to_goal();
