-- ===========================================================================
-- The week's focus.
--
-- Fifteen goals were open at once, a hundred steps of the person's were open
-- under them, and in ten days they closed eleven. Everything was on the home
-- and on Todo every day, so nothing stood out. Each week the person now picks
-- the two or three goals they are pushing, and the rest wait:
--
--   items.focus             on a goal, that it is one of this week's focus
--                           goals. Home's Do next and Todo show only focus
--                           goals' steps (questions, flags and dated errands
--                           from any goal still come through), and Dash works
--                           its own steps on focus goals first. When no goal
--                           has it, every goal counts, as before.
--   visits.planned_week     the Monday of the last week the person planned:
--                           chose the focus on the Plan your week card. The
--                           home asks again once a new week starts.
--
-- Choosing what you work on is the person's, so Dash may not set or clear
-- focus (items_focus_guard). History is the table's own trigger, so every
-- choice of focus is kept. visits has no history, as before.
-- ===========================================================================

alter table goals.items add column focus boolean not null default false;
alter table goals.items add constraint items_focus_goal_ck check (
  not focus or level = 'goal'
);

comment on column goals.items.focus is
  'On a goal, that it is one of this week''s focus goals. Home and Todo show only focus goals'' steps while any goal has it, and Dash works focus goals first. Written by the person only.';

alter table goals.visits add column planned_week date;

comment on column goals.visits.planned_week is
  'The Monday of the last week the person planned on the Plan your week card. The home asks again once a newer week starts.';

create or replace function goals.items_focus_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.focus)
     or (tg_op = 'UPDATE' and new.focus is distinct from old.focus) then
    raise exception 'Claude may not choose the week''s focus: only the person picks which goals they are pushing.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_focus_guard() from public, anon, authenticated;

create trigger items_focus_guard before insert or update on goals.items
  for each row execute function goals.items_focus_guard();

notify pgrst, 'reload schema';
