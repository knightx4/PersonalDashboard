-- A reading in Learn can be a story saved in News (plan #1367).
--
-- "Send to Learn" (#1368) puts a newsletter story on the reading queue. The
-- story's text stays in news.saved_stories and the reading points at it, so
-- nothing is copied and the reading opens the story where it lives.
--
-- This lives in migrations-news although it alters learn.readings, because
-- scripts/db-reset.sh applies learn before news: a learn migration naming
-- news.saved_stories would fail on every local reset.
--
-- Ownership by the key, as concept_id does in migrations-learn/0006: the pair
-- (news_story_id, user_id) references saved_stories (id, user_id), so a
-- reading cannot reach another account's story. `set null (news_story_id)`
-- clears only the pointer when the saved row is deleted, which happens only
-- when nothing points at it (news.unsave_story) or the account goes; a bare
-- `set null` would try to null user_id too and fail.

alter table learn.readings
  add column if not exists news_story_id uuid;

alter table learn.readings
  add constraint readings_news_story_fk
  foreign key (news_story_id, user_id) references news.saved_stories (id, user_id)
  on delete set null (news_story_id);

-- "Is this story already on the reading queue", which sending twice asks, and
-- whether unsaving may delete the row. A few rows out of a growing queue.
create index if not exists readings_news_story_idx
  on learn.readings (news_story_id)
  where news_story_id is not null;

comment on column learn.readings.news_story_id is
  'The saved newsletter story this reading is, when it was sent from News '
  '(plan #1367). The text stays in news.saved_stories; the reading opens it '
  'there. Null for every other reading.';

notify pgrst, 'reload schema';
