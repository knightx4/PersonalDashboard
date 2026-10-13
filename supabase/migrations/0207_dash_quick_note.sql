-- Ask Dash saves a quick thought as a quick note in the vault's Inbox when the
-- person asks for it (plan #1894.2; the hand-off of 12 October that Dash
-- could not do):
--
--   add_quick_note  a note written to the vault's Inbox, undone by taking
--                   its file back out of the notes repository.
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
    'add_job_lead', 'add_idea', 'change_items', 'move_roles', 'set_goal_done_when',
    'add_quick_note'
  ))
);

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s fifteen kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
