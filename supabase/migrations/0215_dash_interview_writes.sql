-- Ask Dash adds an interview round to a role, attaches an email to a round,
-- and writes a round's prep note when asked (plan #2044):
--
--   add_interview_round  a round and its first conversation on a role.
--   link_round_email     an email attached to a round.
--   write_prep_note      the prep note for a round, as "Prepare me" writes it.
--
-- Ask's kinds are the only ones checked, as 0164 set out, so the list grows
-- by these three at once. Every kind in the live list is kept, including the
-- ones 0213 and 0214 added.
--
-- A round can now be a take-home exercise, so the interview kinds gain
-- take_home. Adding an enum value is safe inside the migration because
-- nothing here uses it.

set search_path = core, public, extensions;

alter type job_search.interview_kind add value if not exists 'take_home' after 'case';

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
    'add_interview_round', 'link_round_email', 'write_prep_note'
  ))
);

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
