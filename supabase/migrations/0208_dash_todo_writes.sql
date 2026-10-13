-- Ask Dash makes more of the person's Todo changes straight away when asked
-- (plan #1894.9.1):
--
--   edit_todo      a todo's notes, pin, snooze or state changed.
--   add_todo_item  an item added to a todo's list.
--   link_todo      what a todo is about, set or moved.
--   add_event      an event added to their own calendar.
--   change_event   one of those events changed.
--
-- Learn's six (plan #1894.8) were offered in Ask without being added here, so
-- Ask could not keep them: the insert broke this check. They are added too.
--
-- Ask's kinds are the only ones checked, as 0164 set out, so the list grows
-- by these eleven.

set search_path = core, public, extensions;

alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
alter table core.dash_actions add constraint dash_actions_kind_ck check (
  kind ~ '^[a-z][a-z0-9_]*$'
  and (surface <> 'ask' or kind in (
    'add_todo', 'add_goal_step', 'mark_returned', 'start_watch',
    'add_goal', 'change_todo', 'close_todo', 'close_goal_step', 'add_role_note',
    'add_job_lead', 'add_idea', 'change_items', 'move_roles', 'set_goal_done_when',
    'add_quick_note',
    'change_reading', 'add_learn_track', 'add_track_reading', 'reword_concept',
    'add_concept_note', 'change_video',
    'edit_todo', 'add_todo_item', 'link_todo', 'add_event', 'change_event'
  ))
);

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s twenty-six kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
