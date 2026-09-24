-- Level 3 articles you claimed but have not been tested on, for Learn now
-- (plan #912, under #895).
--
-- Decision #907 brings a claimed article back later, at a new angle, and
-- #911 settled the timing: a gap after your Got it that grows each time the
-- article comes back, until a right answer on it moves it to tested. The gaps
-- themselves live in the code (LEVEL3_RETURN_GAP_DAYS in
-- lib/learn/feed/level3.ts), so they can be changed without a migration, and
-- this function returns the facts the rule needs rather than applying it:
--
--   claimed_at    the first piece of evidence (a Got it or a save)
--   last_seen_at  the latest of that evidence and the latest card on the
--                 article, so a card still waiting to be read also resets
--                 the clock
--   returns       how many cards on the article were made after the first
--                 claim, which is how many times it has come back
--   earlier       the section heading of every card you have had on the
--                 article, oldest first, null for the lead, as a JSON array
--                 (postgres.js reads a null inside a text[] as "NULL"). The
--                 code turns these into card titles for the naming call, so
--                 a return asks for a different side of the article.
--
-- Only articles with evidence and none of it 'tested' are returned. Unlike
-- level3_untouched_articles, an article already on a card is not left out,
-- since a return is by definition an article you have had a card from.
-- `p_exclude` is the titles already picked in the
-- same pass. Oldest last_seen_at first, so the longest-waiting come first if
-- the limit cuts the list.
--
-- It takes the person as an argument because the picking pass runs from
-- Inngest with the service client, so it is service role only.

set search_path = learn, public, extensions;

create or replace function learn.level3_claimed_articles(
  p_user_id uuid,
  p_exclude text[] default '{}',
  p_limit integer default 500
)
returns table (
  id uuid,
  title text,
  section text,
  claimed_at timestamptz,
  last_seen_at timestamptz,
  returns integer,
  earlier jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with evidence as (
    select e.article_id,
           min(e.at) as claimed_at,
           max(e.at) as evidence_at,
           bool_or(e.kind = 'tested') as tested
      from learn.article_evidence e
     where e.user_id = p_user_id
     group by e.article_id
  ),
  claimed as (
    select a.id, a.title, a.section, ev.claimed_at, ev.evidence_at
      from evidence ev
      join learn.area_check_articles a on a.id = ev.article_id
     where not ev.tested
       and lower(a.title) not in (
         select lower(x) from unnest(coalesce(p_exclude, '{}'::text[])) as x
       )
  ),
  cards as (
    select c.id as article_id, fc.created_at, cs.heading
      from claimed c
      join learn.catalogue_items ci on lower(ci.title) = lower(c.title)
      join learn.feed_cards fc on fc.item_id = ci.id and fc.user_id = p_user_id
      left join learn.catalogue_segments cs on cs.id = fc.segment_id
  )
  select c.id,
         c.title,
         c.section,
         c.claimed_at,
         greatest(c.evidence_at, max(k.created_at)) as last_seen_at,
         (count(k.created_at) filter (where k.created_at > c.claimed_at))::integer as returns,
         coalesce(
           jsonb_agg(k.heading order by k.created_at) filter (where k.created_at is not null),
           '[]'::jsonb
         ) as earlier
    from claimed c
    left join cards k on k.article_id = c.id
   group by c.id, c.title, c.section, c.claimed_at, c.evidence_at
   order by 5 asc
   limit greatest(coalesce(p_limit, 0), 0)
$$;

comment on function learn.level3_claimed_articles(uuid, text[], integer) is
  'Level 3 articles a user claimed but has not been tested on, with what the return rule needs (plan #912).';

revoke all on function learn.level3_claimed_articles(uuid, text[], integer) from public, anon, authenticated;
grant execute on function learn.level3_claimed_articles(uuid, text[], integer) to service_role;
