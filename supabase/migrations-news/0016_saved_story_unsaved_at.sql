-- A saved story can be unsaved and still be pointed at (plan #1367, under
-- #1366 "Send a newsletter story to Learn or Todo").
--
-- Sending a story to Learn or making a todo of it saves the story, and the
-- reading or the task points at the saved row rather than copying its text
-- (0017 here, and migrations-goals/0065). Until now unsaving deleted the row,
-- which would leave the reading pointing at nothing and drop the task's link.
--
-- So unsaving a story something points at sets unsaved_at instead, and the
-- Saved tab hides rows that have it. Unsaving one nothing points at still
-- deletes it, and saving a story again clears the column. news.unsave_story
-- (migrations-goals/0065, which runs once both pointers exist) makes that
-- choice in one statement.
--
-- The (id, user_id) key is what the pointers reference, so a reading or a
-- task cannot name another account's saved story; the same pattern as
-- issues_id_user_key in 0007.

alter table news.saved_stories
  add column if not exists unsaved_at timestamptz;

alter table news.saved_stories
  add constraint saved_stories_id_user_key unique (id, user_id);

comment on column news.saved_stories.unsaved_at is
  'When the person took the story off Saved while a reading or a task still '
  'pointed at it (plan #1367). Hidden from the Saved tab; the row stays so '
  'the reading or the task still opens it. Null for every story on Saved.';

notify pgrst, 'reload schema';
