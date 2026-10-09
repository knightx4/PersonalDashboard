-- Ask Dash changes many shopping items at once when asked (plan #1656):
--
--   change_items  owned items marked for sale or to return, taken off
--                 either, or grouped as one item. One record for the whole
--                 change, with every item it moved kept in `undo.rows`, so
--                 one Undo puts them all back.
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
    'add_job_lead', 'add_idea', 'change_items'
  ))
);

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s twelve kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
