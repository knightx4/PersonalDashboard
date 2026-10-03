-- Ask Dash makes the changes it is asked for straight away (plan #1440).
--
-- Until now an Ask action was one of four kinds, each kept as a proposal the
-- person confirmed. #1439 settled that Dash makes a change when asked and the
-- answer carries an Undo, so Ask writes its actions as 'done' from the start
-- and gains five kinds:
--
--   add_goal         a new goal under one of the person's areas.
--   change_todo      a todo renamed or moved to another day.
--   close_todo       a todo ticked off, with the items on its list.
--   close_goal_step  a step under a goal marked done.
--   add_role_note    a note on a role in Jobs.
--
-- The kinds other surfaces write are unchecked here, as before; only Ask's
-- list is named, since lib/ask/changes.ts words and undoes each one.

set search_path = core, public, extensions;

alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
alter table core.dash_actions add constraint dash_actions_kind_ck check (
  kind ~ '^[a-z][a-z0-9_]*$'
  and (surface <> 'ask' or kind in (
    'add_todo', 'add_goal_step', 'mark_returned', 'start_watch',
    'add_goal', 'change_todo', 'close_todo', 'close_goal_step', 'add_role_note'
  ))
);

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s nine kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
