-- Every sign you know a Level 3 article (plan #904, under #895).
--
-- One row per piece of evidence: whose it is, which article on the Level 3
-- list it is about, what kind of evidence it is, and when it happened. #901
-- settled that everything that shows you know something counts, and that more
-- kinds may be added later, so each kind is one arm of the view. A new kind is
-- one more arm, and whatever reads the view keeps working.
--
-- The kinds today:
--
--   got_it  a Learn now card from the article swiped as Got it
--           (feed_cards.status = 'known'), dated when you acted on it.
--   saved   a card from the article saved to your reading list
--           (feed_cards.saved_reading_id set). Status is not read here:
--           Test me moves a saved card to 'tested', and it is still saved.
--   tested  one idea on the article's Test me track that you have answered
--           right: concept_state established by testing and at recognised or
--           above. A right multiple-choice answer lands at recognised
--           (0019_recognised_backfill.sql), an applied one at known.
--
-- Left out on purpose: a card marked 'review' means "need to work on this",
-- which is the opposite of evidence; a dismissed card says nothing either way.
--
-- A card's article is the catalogue item it was cut from, matched to the list
-- by title. named_article is only the model's spelling before the fetch.
-- Test me files its ideas under a subject named after the article
-- (lib/learn/feed/test-me.ts), matched case-insensitively as saveChain does,
-- so the tested arm matches subject names the same way, and counts an idea
-- whose home subject is the article or that is cross-listed there.
--
-- security_invoker, so the view is read with the caller's own RLS: you see
-- your own cards and concept states and nobody else's.

set search_path = learn, public, extensions;

create index if not exists area_check_articles_title_lower_idx
  on learn.area_check_articles (lower(title));

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
join learn.area_check_articles a on lower(a.title) = lower(ci.title)
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
join learn.area_check_articles a on lower(a.title) = lower(ci.title)
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
join learn.area_check_articles a on lower(a.title) = lower(s.name)
where cs.established = 'tested'
  and cs.state in ('recognised', 'known', 'sharp');

comment on view learn.article_evidence is
  'One row per sign a user knows a Level 3 article: got_it, saved or tested (plan #904).';

grant select on learn.article_evidence to authenticated;
grant select on learn.article_evidence to service_role;
revoke all on learn.article_evidence from anon;
