-- A saved story is on the reading queue at most once (plan #1368).
--
-- Send to Learn returns the reading already there when the story has been
-- sent before. The app looks first, but two presses that land together would
-- both find nothing and both insert, so the database holds the rule: a second
-- reading for the same story fails with a unique violation, which
-- lib/learn/tracks/news.ts reads as "already there".
--
-- news_story_id alone is enough as the key: the foreign key pairs it with
-- user_id, so one story id belongs to one account. Nothing wrote the column
-- before this step, so there are no duplicates to clear.
--
-- 0017's readings_news_story_idx covers the same rows and is now redundant.
-- It is left in place: the connector holds a drop for a confirmation, and an
-- index over the handful of sent readings costs nothing worth that.

create unique index if not exists readings_news_story_key
  on learn.readings (news_story_id)
  where news_story_id is not null;

notify pgrst, 'reload schema';
