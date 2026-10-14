-- Tell "no other names" apart from "not read yet" (plan #2016.1).
--
-- 0125 gave learn.area_check_articles an aliases array defaulting to empty.
-- The import reads each article's redirects once, over several calls, and
-- has to know which articles it has not reached: an article with no
-- redirects at all is an empty array, one not read yet is null. Every row is
-- unread at this point, so every row becomes null.

alter table learn.area_check_articles alter column aliases drop not null;
alter table learn.area_check_articles alter column aliases drop default;

update learn.area_check_articles set aliases = null where aliases = '{}';

-- What each call of the import reads first: the articles still to name.
create index if not exists area_check_articles_unnamed_idx
  on learn.area_check_articles (title)
  where aliases is null;

-- And the ones still to embed.
create index if not exists area_check_articles_unembedded_idx
  on learn.area_check_articles (title)
  where embedding is null;
