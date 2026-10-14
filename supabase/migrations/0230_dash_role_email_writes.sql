-- Ask Dash links, turns down and unlinks a role's emails when asked
-- (plan #1894.6.5):
--
--   change_role_email  an email linked to a role, a suggested one turned
--                      down, or one taken off a role it was wrongly linked to.
--
-- Ask's kinds are the only ones checked, as 0164 set out, so the list grows
-- by this one. Every kind in the live list is kept, read from the constraint
-- as it stood.

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
    'add_concept_note', 'change_video', 'research_topic',
    'edit_todo', 'add_todo_item', 'link_todo', 'add_event', 'change_event',
    'change_agenda_row',
    'add_place', 'change_place',
    'save_job',
    'mark_issue_unread', 'save_story', 'send_story_to_learn', 'make_todo_from_story',
    'stop_watch',
    'add_interview_round', 'link_round_email', 'write_prep_note',
    'change_goal_area', 'change_goal', 'change_goal_step',
    'write_vault_note', 'edit_vault_note', 'rename_vault_note', 'file_quick_note',
    'rename_theme', 'rename_maya_question', 'change_course', 'save_transcript',
    'change_item', 'item_lists', 'add_items',
    'change_role', 'change_application',
    'change_goal_number', 'change_goal_link', 'change_goal_form',
    'change_saved_item', 'change_goals_inbox',
    'change_company', 'merge_roles',
    'add_order', 'order_item_tags', 'review_orders', 'change_recurring',
    'return_window', 'change_person',
    'change_reminder', 'change_waiting',
    'change_role_email'
  ))
);

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
