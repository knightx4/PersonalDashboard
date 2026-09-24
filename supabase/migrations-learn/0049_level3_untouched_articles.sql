-- Level 3 articles you have shown no sign of knowing, for Learn now (plan
-- #910, under #895).
--
-- The Level 3 goal's cards come straight from its list rather than from the
-- naming call. Decision #907 settled the order: untouched articles first, then
-- claimed but untested ones coming back after a gap (#912). This function is
-- the first half: a random handful of articles on the list that
--
--   * have no row in article_evidence for the person (no Got it, no save, no
--     right answer on a Test me track), and
--   * have never been on a card of theirs at all, whatever became of it. A
--     card still waiting to be read, one marked "need to work on this", and
--     one turned down are each a reason not to offer the article again as if
--     it were new. Matched by the fetched article's title, as the evidence
--     view matches, and by the title the card was picked under.
--
-- `p_exclude` is the titles already picked in the same pass, so a second draw
-- for the goal in one call does not repeat the first.
--
-- It takes the person as an argument because the picking pass runs from
-- Inngest with the service client, where auth.uid() is null. So it is service
-- role only, like feed_field_tests.

set search_path = learn, public, extensions;

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
   where not exists (select 1 from held h where h.id = a.id)
     and not exists (select 1 from carded c where c.title = lower(a.title))
   order by random()
   limit greatest(coalesce(p_count, 0), 0)
$$;

comment on function learn.level3_untouched_articles(uuid, integer, text[]) is
  'A random handful of Level 3 articles with no evidence and no card for the person (plan #910).';

revoke all on function learn.level3_untouched_articles(uuid, integer, text[]) from public, anon, authenticated;
grant execute on function learn.level3_untouched_articles(uuid, integer, text[]) to service_role;
