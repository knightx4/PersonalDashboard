-- Ask Dash sets a goal's done-when when the person asks for it by name
-- (notes 06d36ab2, fa2ac6fe):
--
--   set_goal_done_when  a goal's done-when written, changed or cleared, on
--                       the person's own session, so goals.items_claude_guard
--                       still refuses the change from a run deciding alone.
--
-- Ask's kinds are the only ones checked here, as 0164 set out, so the list
-- grows by this one.

set search_path = core, public, extensions;

alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
alter table core.dash_actions add constraint dash_actions_kind_ck check (
  kind ~ '^[a-z][a-z0-9_]*$'
  and (surface <> 'ask' or kind in (
    'add_todo', 'add_goal_step', 'mark_returned', 'start_watch',
    'add_goal', 'change_todo', 'close_todo', 'close_goal_step', 'add_role_note',
    'add_job_lead', 'add_idea', 'change_items', 'move_roles', 'set_goal_done_when'
  ))
);

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s fourteen kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
