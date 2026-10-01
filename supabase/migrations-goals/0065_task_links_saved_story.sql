-- ===========================================================================
-- A task can be about a story saved in News (plan #1367, under #1366).
--
-- "Make a todo" (#1369) adds a task titled with a newsletter story's headline.
-- The story's text stays in news.saved_stories and the task links to it, the
-- fifteenth target of todo.task_links: a column, the exactly-one check
-- rewritten to count it, and an arm in the ownership trigger.
--
-- It lives in migrations-goals for the reason 0064 gives: 0062 and 0064 here
-- own the check and the trigger, and scripts/db-reset.sh applies goals last.
--
-- The key cascades like the other targets, so deleting the saved row removes
-- the link and leaves the task. A saved row with a link is not deleted when
-- the person unsaves it, though: news.unsave_story, at the end of this file,
-- sets unsaved_at instead (migrations-news/0016), so the task keeps working.
-- ===========================================================================

alter table todo.task_links
  add column if not exists saved_story_id uuid
    references news.saved_stories (id) on delete cascade;

alter table todo.task_links drop constraint if exists task_links_exactly_one_ck;
alter table todo.task_links add constraint task_links_exactly_one_ck check (
  num_nonnulls(application_id, role_id, company_id, contact_id, interview_id,
               note_id, order_id, inventory_item_id, saved_item_id, reading_id,
               track_id, subject_id, goal_id, feed_id, saved_story_id) = 1
);

-- The reverse read, "which tasks are about this story", which unsave_story
-- and the story's Make a todo button both make, and the cascade.
create index if not exists task_links_saved_story_idx
  on todo.task_links (saved_story_id) where saved_story_id is not null;

-- ---------------------------------------------------------------------------
-- The ownership check, over fifteen targets. Unchanged from 0064 but for the
-- saved story arm and news on the search path: the key to saved_stories is
-- satisfied by any account's row, because referential integrity bypasses
-- row level security.
-- ---------------------------------------------------------------------------
create or replace function todo.task_link_target_is_owned()
returns trigger
language plpgsql
security definer
set search_path = todo, job_search, obsidian, learn, goals, news, public
as $$
declare
  owner uuid;
  task_owner uuid;
begin
  -- Let the check constraint speak when the row points at nothing, or at more
  -- than one thing.
  if num_nonnulls(new.application_id, new.role_id, new.company_id,
                  new.contact_id, new.interview_id, new.note_id,
                  new.order_id, new.inventory_item_id, new.saved_item_id,
                  new.reading_id, new.track_id, new.subject_id,
                  new.goal_id, new.feed_id, new.saved_story_id) <> 1 then
    return new;
  end if;

  select user_id into task_owner from todo.tasks where id = new.task_id;

  select case
    when new.application_id is not null then
      (select user_id from job_search.applications where id = new.application_id)
    when new.role_id is not null then
      (select user_id from job_search.roles where id = new.role_id)
    when new.company_id is not null then
      (select user_id from job_search.companies where id = new.company_id)
    when new.contact_id is not null then
      (select user_id from job_search.contacts where id = new.contact_id)
    when new.interview_id is not null then
      (select user_id from job_search.interviews where id = new.interview_id)
    when new.note_id is not null then
      (select user_id from obsidian.notes where id = new.note_id)
    when new.order_id is not null then
      (select user_id from public.orders where id = new.order_id)
    when new.inventory_item_id is not null then
      (select user_id from public.inventory_items where id = new.inventory_item_id)
    when new.saved_item_id is not null then
      (select user_id from public.saved_items where id = new.saved_item_id)
    when new.reading_id is not null then
      (select user_id from learn.readings where id = new.reading_id)
    when new.track_id is not null then
      (select user_id from learn.tracks where id = new.track_id)
    when new.subject_id is not null then
      (select user_id from learn.subjects where id = new.subject_id)
    when new.goal_id is not null then
      (select user_id from goals.items where id = new.goal_id)
    when new.feed_id is not null then
      (select user_id from todo.calendar_feeds where id = new.feed_id)
    when new.saved_story_id is not null then
      (select user_id from news.saved_stories where id = new.saved_story_id)
  end into owner;

  if owner is null or task_owner is null or owner <> task_owner then
    raise exception 'a task link must point at something the task''s owner owns';
  end if;

  return new;
end;
$$;

revoke all on function todo.task_link_target_is_owned() from public, anon, authenticated;

comment on column todo.task_links.saved_story_id is
  'The saved newsletter story a task is about, when it was made from News '
  '(plan #1367). The text stays in news.saved_stories.';

-- ---------------------------------------------------------------------------
-- Take a story off Saved without breaking what points at it.
--
-- When a reading (learn.readings.news_story_id) or a task link points at the
-- row, it stays and unsaved_at is set, which hides it from the Saved tab. When
-- nothing does, the row is deleted as before. Returns the issue the story came
-- from, so the caller can refresh that newsletter's page, or null when the row
-- was not there or its newsletter is gone.
--
-- Security invoker: the person's own row level security decides which
-- readings and links it can see, and every pointer to their story is theirs
-- (the key carries user_id on readings, the trigger above checks links).
-- ---------------------------------------------------------------------------
create or replace function news.unsave_story(story_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  kept boolean;
  issue uuid;
begin
  select exists (select 1 from learn.readings r where r.news_story_id = story_id)
      or exists (select 1 from todo.task_links l where l.saved_story_id = story_id)
    into kept;

  if kept then
    update news.saved_stories s
       set unsaved_at = coalesce(s.unsaved_at, now())
     where s.id = story_id
    returning s.issue_id into issue;
  else
    delete from news.saved_stories s
     where s.id = story_id
    returning s.issue_id into issue;
  end if;

  return issue;
end;
$$;

revoke all on function news.unsave_story(uuid) from public, anon;
grant execute on function news.unsave_story(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
