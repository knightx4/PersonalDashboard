-- ===========================================================================
-- Whether a goal is active or passive (plan #2503.1).
--
-- An active goal is one the person works on, so its open steps reach Do next,
-- Todo and the daily verdicts. A passive one is a goal they want kept in view
-- without being asked about it: its dated events can be mentioned, and
-- nothing more. This step stores the label; later steps of #2503 read it.
--
--   items.activity   active | passive. Only a goal carries it; a step's is
--                    null, which items_activity_ck holds for every writer.
--
-- The column has no default, because a step must stay null. A trigger gives a
-- new goal active when its insert names none, and the update below fills the
-- owner's existing goals. The check lets a goal be null too, and the loaders
-- read null as active, so a goal in any other account reads as active
-- without this file rewriting its row.
-- ===========================================================================

alter table goals.items
  add column activity text,
  add constraint items_activity_ck check (
    activity is null or (level = 'goal' and activity in ('active', 'passive'))
  );

update goals.items
  set activity = 'active'
  where level = 'goal'
    and user_id = core.dev_owner_id();

create or replace function goals.items_activity_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.level = 'goal' and new.activity is null then
    new.activity := 'active';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_activity_default() from public, anon, authenticated;

create trigger items_activity_default before insert on goals.items
  for each row execute function goals.items_activity_default();

comment on column goals.items.activity is
  'active or passive on a goal, null on a step (plan #2503.1). A passive goal stays out of Do next, Todo and the daily verdicts.';
