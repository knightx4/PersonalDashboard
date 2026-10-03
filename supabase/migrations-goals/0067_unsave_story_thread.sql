-- ===========================================================================
-- Unsaving a story keeps it while a thread sits under it (plan #1468).
--
-- A discussion of a newsletter story is now a row thread in core.conversations
-- under the saved story, `news.saved_stories:<id>` (migrations/0165). Unsaving
-- a story nothing pointed at used to delete its row, which would leave that
-- thread under nothing and lose it from Quick read. So a thread counts as a
-- pointer here, the same as a reading in Learn or a task in Todo: the row is
-- kept with unsaved_at set and the Saved tab hides it (migrations-news/0016).
--
-- It lives in migrations-goals because 0065 here owns news.unsave_story, and
-- scripts/db-reset.sh applies goals last, after core, learn and todo. The
-- function is 0065's with the thread added to the test.
-- ===========================================================================

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
      or exists (
        select 1 from core.conversations c
        where c.subject_kind = 'row' and c.subject_ref = 'news.saved_stories:' || story_id::text
      )
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
