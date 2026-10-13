-- Put the ideas already tested or declared on the review schedule (plan #1145).
--
-- Until now an idea was scheduled only when a lesson piece holding it was
-- passed, and no piece has been, so nothing ever came up for review. The app
-- now schedules an idea the first time it is tested or declared in a state
-- worth reviewing (shaky, recognised, known or sharp). This one-off update
-- does the same for the rows written before that change.
--
-- The gap matches what the app gives a new idea: 1 day for a state that
-- rests on an answer, 3 for one that rests on your word. The first due day is
-- spread over the next 14 days by a hash of the concept id, so the backlog
-- comes back a few ideas a day and not all at once tomorrow. Rows already on
-- the schedule are left alone, so running it twice changes nothing.

set search_path = learn, public, extensions;

update learn.concept_state
set review_interval_days = case when established = 'declared' then 3 else 1 end,
    review_due_on = (now() at time zone 'utc')::date + 1
      + (((hashtext(concept_id::text) % 14) + 14) % 14)
where review_due_on is null
  and state in ('shaky', 'recognised', 'known', 'sharp');
