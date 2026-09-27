-- Networking suggestions: people you have not met, found with a web search.
--
-- The first version of "Who to contact" chose from the pipeline and the
-- contact list, which in practice meant follow-ups on applications that had
-- already gone quiet. It now searches for new people who fit the career goals
-- (lib/jobs/suggest/model.ts, findPeople), so a suggestion names someone who
-- is not a contact yet:
--
--   person_name, person_title  who they are, as the source states it; null
--                              for a suggestion that is an event or a group
--                              rather than one person
--   source_url                 where Dash found them: a team page, a talk,
--                              an article, a public profile
--   search_query               the LinkedIn people search that finds them or
--                              people like them
--
-- Pressing Sent on one makes the person a contact (relationship cold) and logs
-- the touch against them.

set search_path = job_search, extensions;

alter table suggestions add column if not exists person_name text;
alter table suggestions add column if not exists person_title text;
alter table suggestions add column if not exists source_url text;
alter table suggestions add column if not exists search_query text;

alter table suggestions drop constraint if exists suggestions_person_length_ck;
alter table suggestions add constraint suggestions_person_length_ck check (
  (person_name is null or length(person_name) <= 200)
  and (person_title is null or length(person_title) <= 300)
  and (search_query is null or length(search_query) <= 300)
);
