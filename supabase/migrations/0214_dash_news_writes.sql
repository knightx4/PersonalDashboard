-- Ask Dash makes News changes straight away when asked, and stops a price
-- watch (plan #1894.9.4):
--
--   mark_issue_unread     a newsletter put back in the unread list.
--   save_story            a story saved to Saved, or taken off it.
--   send_story_to_learn   a story put on the From News reading list.
--   make_todo_from_story  a todo made from a story.
--   stop_watch            a running price watch stopped.
--
-- Ask's kinds are the only ones checked, as 0164 set out, so the list grows
-- by these five. Every kind in the live list is kept, as 0212 kept them,
-- including research_topic, which the live list holds from its own migration.

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
    'research_topic',
    'edit_todo', 'add_todo_item', 'link_todo', 'add_event', 'change_event',
    'change_agenda_row',
    'add_place', 'change_place',
    'save_job',
    'mark_issue_unread', 'save_story', 'send_story_to_learn', 'make_todo_from_story',
    'stop_watch'
  ))
);

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
