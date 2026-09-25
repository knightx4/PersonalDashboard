-- What Quick read learns about the stories you care for.
--
-- Quick read ranks the stories it shows rather than taking them newest
-- newsletter first (lib/news/quick/rank.ts). Part of the rank is how often you
-- open or save stories on a topic, and from a newsletter, against how many of
-- them you moved past. Until now opening an article recorded a pass and
-- nothing more, so an open and a skip looked the same.
--
-- opened_at on story_passes is set when you open a story's article from Quick
-- read. The pass row itself is still written as before, so a story you opened
-- is also one you have moved past. Rows from before this migration have no
-- opened_at and count as passes only.
--
-- news.story_interest adds up, per newsletter and topic, how many stories you
-- moved past, opened and saved. It is a view over the rows you already own:
-- security_invoker makes it read through each table's owner-only policy, so
-- it shows nobody else's. A saved story is matched to its place in the
-- newsletter by headline, the key saved_stories uses (0009). A story you saved
-- without passing still counts as saved.

set search_path = news, public, extensions;

alter table news.story_passes add column opened_at timestamptz;

create view news.story_interest with (security_invoker = true) as
select
  i.user_id,
  i.sender_id,
  -- The topic as the summariser stored it. A name no longer on NEWS_TOPICS is
  -- read as no topic by the code, the same as readTopic does for a story.
  nullif(btrim(e.story ->> 'topic'), '') as topic,
  count(p.story_index)::int as seen,
  count(p.opened_at)::int as opened,
  count(ss.id)::int as saved
from news.issues i
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(i.stories) = 'array' then i.stories else '[]'::jsonb end
) with ordinality as e(story, ord)
left join news.story_passes p
  on p.issue_id = i.id and p.story_index = e.ord - 1
left join news.saved_stories ss
  on ss.issue_id = i.id and ss.headline = btrim(e.story ->> 'headline')
where p.story_index is not null or ss.id is not null
group by i.user_id, i.sender_id, nullif(btrim(e.story ->> 'topic'), '');

revoke all on news.story_interest from anon;
grant select on news.story_interest to authenticated, service_role;

notify pgrst, 'reload schema';
