-- Two Dash check cases for web search (plan #2861).
--
-- Ask Dash can now search the web when the person's rows cannot answer, and
-- cites the pages it used. One case asks about something outside their data,
-- news about a library the app is built on, and expects a search and a cited
-- page. The other asks about their own spending and
-- expects no search at all. The grader reads the new `web` field of expect
-- (lib/dash/quality/grade.ts): 'cited' or 'none'.
--
-- Both are added for the owner only, once.

set search_path = core, public, extensions;

insert into core.dash_eval_cases (user_id, question, expect, origin)
select core.dev_owner_id(), q.question, q.expect, q.origin
from (values
  ('What is the newest release of Next.js, and what changed in it?',
   '{"web": "cited", "max_seconds": 90}'::jsonb,
   'plan #2861: a question outside their data, answered from the web with the pages cited'),
  ('What did I spend in October?',
   '{"web": "none", "max_lookups": 6, "max_seconds": 90}'::jsonb,
   'plan #2861: a question their rows answer, which must not search the web')
) as q(question, expect, origin)
where core.dev_owner_id() is not null
  and not exists (select 1 from core.dash_eval_cases c where c.user_id = core.dev_owner_id() and c.question = q.question);
