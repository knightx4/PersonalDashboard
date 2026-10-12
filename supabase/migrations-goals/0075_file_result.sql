-- Filing what Dash writes under the goal it was for (plan #1860).
--
-- When Dash does a step by writing something, a list, a draft or a note, the
-- writing is kept as a file (core.files, migrations/0105) linked from the
-- step and from its goal, so the goal page lists it beside the others. Until
-- now a run wrote the file and its two links by hand, and only when the
-- piece was long; a run that came back to the same step could as easily
-- write a second file as revise the first.
--
-- goals.file_result does the whole filing in one call, so that each step
-- has one file and working the step again makes a new version of it:
--
--   * the file is found by its origin, `goals.items:<the step>`, among the
--     live files Dash wrote. If there is one it is updated, and the trigger
--     in migrations/0105 numbers the new version and keeps the old one. If
--     there is none it is written.
--   * the file is linked from the step and from the goal above it, however
--     deep the step sits. A link that was archived is brought back.
--
-- It returns the file's id, for the step's result to link to. It runs as the
-- caller: the routine reaches it through the connector, and nothing in the
-- app calls it, so the signed-in role cannot execute it.
--
-- The files Dash has already written take their read mark from the step that
-- made them: a step marked read had its file opened (be1ed0d3 marks the step
-- read when its file is opened).

create or replace function goals.file_result(
  p_item uuid,
  p_title text,
  p_summary text,
  p_body text,
  p_change_note text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  owner uuid;
  goal_id uuid;
  found_id uuid;
  origin_ref text := 'goals.items:' || p_item;
begin
  select i.user_id into owner
    from goals.items i
   where i.id = p_item and i.archived_at is null;
  if owner is null then
    raise exception 'file_result: no live goal or step %', p_item
      using errcode = 'no_data_found';
  end if;

  -- The goal the item sits under: itself for a goal.
  with recursive up as (
    select i.id, i.parent_id, i.level, 0 as depth
      from goals.items i
     where i.id = p_item
    union all
    select p.id, p.parent_id, p.level, up.depth + 1
      from goals.items p
      join up on p.id = up.parent_id
     where up.level <> 'goal' and up.depth < 20
  )
  select up.id into goal_id from up where up.level = 'goal' limit 1;

  select f.id into found_id
    from core.files f
   where f.user_id = owner
     and f.origin = origin_ref
     and f.made_by = 'claude'
     and f.archived_at is null
   order by f.created_at desc
   limit 1
   for update;

  if found_id is null then
    insert into core.files (user_id, title, summary, body, made_by, origin)
    values (owner, p_title, p_summary, p_body, 'claude', origin_ref)
    returning id into found_id;
  else
    update core.files
       set title = p_title, summary = p_summary, body = p_body, change_note = p_change_note
     where id = found_id;
  end if;

  insert into goals.links (user_id, item_id, kind, target_id)
  select distinct owner, x.item_id, 'file'::text, found_id
    from unnest(array[p_item, goal_id]) as x(item_id)
   where x.item_id is not null
  on conflict (item_id, kind, target_id) do update
    set archived_at = null
    where goals.links.archived_at is not null;

  return found_id;
end;
$$;

revoke all on function goals.file_result(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function goals.file_result(uuid, text, text, text, text) to service_role;

comment on function goals.file_result(uuid, text, text, text, text) is
  'Files what Dash wrote for a goal or step: revises the live file whose origin is that item (a new version) or writes one, links it from the item and its goal, and returns its id.';

update core.files f
   set read_at = i.reviewed_at
  from goals.items i
 where f.origin = 'goals.items:' || i.id
   and i.user_id = f.user_id
   and i.reviewed_at is not null
   and f.read_at is null;

notify pgrst, 'reload schema';
