-- Level 4 beside Level 3 in the article list (plan #2016.1).
--
-- learn.area_check_articles held Wikipedia's 1,001 Level 3 vital articles.
-- It now holds the Level 4 list as well, about 10,000 articles, which become
-- the topics Idea Space frames what you know with (feature #2016). Three
-- things are added to each row:
--
--   level      3 or 4: the lowest level the article is listed at. Level 4
--              includes every Level 3 article, and the import leaves an
--              existing row alone, so a Level 3 article keeps 3.
--   aliases    the other names Wikipedia redirects to the article from
--              ("LBO" for Leveraged buyout), for matching your text by name.
--   embedding  the title, embedded with voyage-4-lite at 512 dimensions to
--              keep ten thousand rows small. Filled by the daily embedding
--              stage; embedding_model names what made it, null while none.
--
-- The default level is 3 so the Level 3 loader in /api/cron/area-check, and
-- every row already here, read as before. Everything that reads the list as
-- "the Level 3 list" is narrowed to level 3 below, so adding ten thousand
-- rows does not change a Level 3 count, offer a Level 4 article as a Level 3
-- card, or send Level 4 articles to the model that places Level 3 ones.

set search_path = learn, public, extensions;

alter table learn.area_check_articles
  add column if not exists level smallint not null default 3;
alter table learn.area_check_articles
  add column if not exists aliases text[] not null default '{}';
alter table learn.area_check_articles
  add column if not exists embedding extensions.vector(512);
alter table learn.area_check_articles
  add column if not exists embedding_model text;

alter table learn.area_check_articles drop constraint if exists area_check_articles_level_ck;
alter table learn.area_check_articles add constraint area_check_articles_level_ck
  check (level in (3, 4));

alter table learn.area_check_articles drop constraint if exists area_check_articles_embedding_ck;
alter table learn.area_check_articles add constraint area_check_articles_embedding_ck
  check ((embedding is null) = (embedding_model is null));

create index if not exists area_check_articles_level_idx
  on learn.area_check_articles (level);

-- Nearest topics for an idea or another topic (#2016.2 onwards).
create index if not exists area_check_articles_embedding_idx
  on learn.area_check_articles using hnsw (embedding extensions.vector_cosine_ops);

-- The evidence view matches Level 3 articles only, so every count and draw
-- built on it stays a Level 3 one.
create or replace view learn.article_evidence with (security_invoker = true) as
select
  fc.user_id,
  a.id as article_id,
  a.title as article_title,
  'got_it'::text as kind,
  coalesce(fc.acted_at, fc.updated_at) as at,
  fc.id as source_id
from learn.feed_cards fc
join learn.catalogue_items ci on ci.id = fc.item_id
join learn.area_check_articles a on lower(a.title) = lower(ci.title) and a.level = 3
where fc.status = 'known'

union all

select
  fc.user_id,
  a.id,
  a.title,
  'saved'::text,
  coalesce(fc.acted_at, fc.updated_at),
  fc.id
from learn.feed_cards fc
join learn.catalogue_items ci on ci.id = fc.item_id
join learn.area_check_articles a on lower(a.title) = lower(ci.title) and a.level = 3
where fc.saved_reading_id is not null

union all

select
  cs.user_id,
  a.id,
  a.title,
  'tested'::text,
  cs.tested_at,
  c.id
from learn.concept_state cs
join learn.concepts c on c.id = cs.concept_id
join learn.subjects s
  on s.user_id = cs.user_id
 and (
   s.id = c.subject_id
   or exists (
     select 1 from learn.concept_subjects x
     where x.concept_id = c.id and x.subject_id = s.id
   )
 )
join learn.area_check_articles a on lower(a.title) = lower(s.name) and a.level = 3
where cs.established = 'tested'
  and cs.state in ('recognised', 'known', 'sharp');

create or replace function learn.level3_evidence_counts()
returns table (claimed bigint, tested bigint, total bigint)
language sql
stable
security invoker
set search_path = learn, public, pg_temp
as $$
  select
    (select count(distinct e.article_id)
       from learn.article_evidence e
      where e.user_id = (select auth.uid())) as claimed,
    (select count(distinct e.article_id)
       from learn.article_evidence e
      where e.user_id = (select auth.uid()) and e.kind = 'tested') as tested,
    (select count(*) from learn.area_check_articles where level = 3) as total;
$$;

create or replace function learn.level3_untouched_articles(
  p_user_id uuid,
  p_count integer,
  p_exclude text[] default '{}'
)
returns table (id uuid, title text, section text)
language sql
volatile
security invoker
set search_path = ''
as $$
  with held as (
    select e.article_id as id
      from learn.article_evidence e
     where e.user_id = p_user_id
  ),
  carded as (
    select lower(ci.title) as title
      from learn.feed_cards fc
      join learn.catalogue_items ci on ci.id = fc.item_id
     where fc.user_id = p_user_id
    union
    select lower(fc.named_article)
      from learn.feed_cards fc
     where fc.user_id = p_user_id and fc.named_article is not null
    union
    select lower(x) from unnest(coalesce(p_exclude, '{}'::text[])) as x
  )
  select a.id, a.title, a.section
    from learn.area_check_articles a
   where a.level = 3
     and not exists (select 1 from held h where h.id = a.id)
     and not exists (select 1 from carded c where c.title = lower(a.title))
   order by random()
   limit greatest(coalesce(p_count, 0), 0)
$$;
