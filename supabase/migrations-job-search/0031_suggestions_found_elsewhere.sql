-- Recommended people and roles from anywhere Dash finds them.
--
-- Until now only the suggestion run (lib/jobs/suggest/run.ts) wrote here, so a
-- person or an opening found by a goal step, a goal's research file or the
-- weekly goals run stayed in that note and never reached Roles or Contacts.
-- Every find now lands here as well.
--
--   found_in      a short line saying where it was found, shown on the row:
--                 'Goal step: Find Yale SOM alumni at your target companies'.
--                 Null for the suggestion run's own searches.
--   goal_item_id  the goal or step that found it, when a goals run did.
--
-- A person is recommended once, as a posting already is. Nothing guarded that
-- before because the suggestion run checks names itself; the goals runs write
-- plain SQL, so the database now keeps the rule for them.

set search_path = job_search, extensions;

alter table suggestions add column if not exists found_in text;
alter table suggestions add column if not exists goal_item_id uuid;

alter table suggestions drop constraint if exists suggestions_found_in_length_ck;
alter table suggestions add constraint suggestions_found_in_length_ck
  check (found_in is null or length(found_in) <= 300);

create unique index if not exists suggestions_user_person_key
  on suggestions (user_id, lower(btrim(person_name)))
  where kind = 'reach_out' and person_name is not null;
