-- Ask Dash saves a job to the person's leads and files an idea on the ideas
-- page when asked (notes 10fff3f5 and ef07e37f). Both were handed to the
-- backup routine because no tool could do them.
--
--   add_job_lead  a role, its company and a lead application, from a posting
--                 link or a title and company.
--   add_idea      an idea on the ideas page in Dev, filed as the person's.
--
-- Ask's kinds are the only ones checked here, as 0164 set out, so the list
-- grows by these two.

set search_path = core, public, extensions;

alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
alter table core.dash_actions add constraint dash_actions_kind_ck check (
  kind ~ '^[a-z][a-z0-9_]*$'
  and (surface <> 'ask' or kind in (
    'add_todo', 'add_goal_step', 'mark_returned', 'start_watch',
    'add_goal', 'change_todo', 'close_todo', 'close_goal_step', 'add_role_note',
    'add_job_lead', 'add_idea'
  ))
);

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s eleven kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
