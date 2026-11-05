-- A Dash check case can be asked with Think it through on (plan #2937.6).
--
-- The monthly check asked every question as an ordinary Ask answer, so a long
-- considered answer on Opus could fail in production without the check
-- noticing (the 4 November question about mentors reaching out came back
-- empty). A case with think on is asked as the person asks it with the switch
-- pressed: Opus at high effort, with web search, the code and the mockup. The
-- runner (inngest/core/dash-quality.ts) passes the column through, and a
-- case's expect may now name min_chars, the length the answer must reach
-- (lib/dash/quality/grade.ts).
--
--   think   true to ask with Think it through on; false asks as before.
--
-- Three cases are added for the owner: the 4 November question with think on,
-- and two everyday questions whose answers run past a few paragraphs.

set search_path = core, public, extensions;

alter table core.dash_eval_cases
  add column think boolean not null default false;

comment on column core.dash_eval_cases.think is
  'True asks the question with Think it through on (Opus, high effort, web search, the code); false asks as Ask Dash ordinarily answers (plan #2937.6).';

insert into core.dash_eval_cases (user_id, question, expect, origin, think)
select core.dev_owner_id(),
  $q$i want to add a feature on the chat bots. within editing for them, i should be able to describe what they reach out to me about, and how often. I want to be able to put this in plain words, then it will automatically set it up behind the scenes, with feedback that says set up. I want you to think deep on this one to figure out how to set this up in the best manner that allows me to just type it in in plain english and it will get it all set up to do it for me. For example, i might have the hiring manager set to tell me when it finds new jobs that it thinks would be a good fit. It might tell me what my updates are on my activity, like if i got rejected from a few, if I got any word back from anyone. It can suggest pointed things like someone i should reach out to but never bugging me with it, just once in a while and not saying the same thing over and over again. Others might be more general. Like Jerywn the elder might summarize wise person advice that comes up, like things from my insights, new notes i put down etc. but not that often. The builder (which i think is still in the process of being added) will give me highlights on what has been built, some ideas it came up with which are particularly good, and what i need to do. And so on$q$,
  '{"min_chars": 1500, "mentions_all": ["edit", "form"], "max_seconds": 280, "allow_failed_lookups": true}'::jsonb,
  'plan #2937.6: the 4 November question that came back empty on Opus with Think it through on',
  true
where core.dev_owner_id() is not null
  and not exists (select 1 from core.dash_eval_cases where user_id = core.dev_owner_id() and origin like 'plan #2937.6:%' and think);

insert into core.dash_eval_cases (user_id, question, expect, origin)
select core.dev_owner_id(), q.question, q.expect, q.origin
from (values
  ('give me a full picture of where my job search stands: every company, what stage each is at, what is waiting on me, and what I should do this week, in as much detail as you can',
   '{"min_chars": 1500, "max_lookups": 12, "max_seconds": 200}'::jsonb,
   'plan #2937.6: a long everyday answer on Sonnet'),
  ('walk me through everything I have written and saved about my goals and where each one stands, area by area, with what is next for each',
   '{"min_chars": 1500, "max_lookups": 12, "max_seconds": 200}'::jsonb,
   'plan #2937.6: a long everyday answer on Sonnet')
) as q(question, expect, origin)
where core.dev_owner_id() is not null
  and not exists (select 1 from core.dash_eval_cases c where c.user_id = core.dev_owner_id() and c.question = q.question);

notify pgrst, 'reload schema';
