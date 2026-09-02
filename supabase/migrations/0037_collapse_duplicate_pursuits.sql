-- Collapse the duplicate pursuits the closed-pursuit blind spot left behind,
-- and empty the queue of questions that no longer have answers.
--
-- createInferredApplication only ever looked at pursuits that were still open.
-- A rejection closes a pursuit, so the next message about the same job matched
-- nothing, opened a second role and a second application, and that one closed
-- too. Sixteen applications at one employer, five of them carrying the
-- identical role title, each one asking to be confirmed -- and the linker then
-- reported "two applications match this message about equally well", because
-- they did: they were the same pursuit written down repeatedly. The rule is
-- fixed in lib/jobs/inbox/ingest-messages (choosePursuit now sees closed
-- pursuits, and adopts one by name); this moves what is already on the board.
--
-- Four things happen here, in order, because each depends on the last:
--
--   1. duplicate pursuits are merged, so a thread points at one application
--   2. held mail is linked to its own thread, which is now unambiguous
--   3. review flags are cleared where the pursuit they ask about is over
--   4. the rest of the held mail is offered to the fixed linker again
--
-- Nothing is discarded. Every child row is moved onto the survivor before
-- anything is deleted.

begin;

-- ---------------------------------------------------------------------------
-- 1. Merge pursuits that name the same job at the same company.
--
-- The grouping key mirrors roleIdentityKey() in lib/jobs/email/link.ts: case
-- and punctuation are forgiven, words never are. "Senior Analyst" and
-- "Analyst" are two jobs and must not collapse; "Engagement Lead, Future
-- Platforms | Housing" quoted out of two different emails is one.
--
-- Three guards, none of which fires on the current data, all of which are here
-- so this cannot misfire if it is ever re-run against a fuller board:
--
--   * a group where `attempt` varies is a deliberate re-application, which is
--     exactly what that column exists to record. Left alone.
--   * a group containing a row you created by hand is left alone: the inbox
--     folding your own entry into one of its guesses is not a cleanup.
--   * a role that is the only one of its name is not in a group at all.
-- ---------------------------------------------------------------------------
create temporary table pursuit_merge on commit drop as
with keyed as (
  select
    a.id as application_id,
    r.id as role_id,
    r.company_id,
    a.attempt,
    a.created_by,
    a.submitted_at,
    r.first_seen_at,
    r.ats_job_id,
    btrim(regexp_replace(lower(r.title), '[^a-z0-9]+', ' ', 'g')) as title_key
  from job_search.applications a
  join job_search.roles r on r.id = a.role_id
),
duplicated as (
  select company_id, title_key
  from keyed
  group by company_id, title_key
  having count(*) > 1
     and count(distinct attempt) = 1
     and max(attempt) = 1
     and count(*) filter (where created_by = 'manual') = 0
),
ranked as (
  select
    k.*,
    -- Ordered by first_seen_at -- when the mail that opened the role arrived --
    -- rather than the row's own created_at, because these were written by a
    -- backfill and inserted out of that order. Same rule as 0035.
    first_value(k.application_id) over w as survivor_app,
    first_value(k.role_id) over w as survivor_role
  from keyed k
  join duplicated d on d.company_id = k.company_id and d.title_key = k.title_key
  window w as (
    partition by k.company_id, k.title_key
    order by k.first_seen_at nulls last, k.role_id
  )
)
select * from ranked where application_id <> survivor_app;

-- The survivor inherits what the losers knew that it does not. An ATS job id
-- is the strongest linking signal there is and throwing one away here would
-- undo the very thing this migration is for.
update job_search.roles r
set ats_job_id = m.ats_job_id
from (
  select survivor_role, min(ats_job_id) as ats_job_id
  from pursuit_merge
  where ats_job_id is not null
  group by survivor_role
) m
where r.id = m.survivor_role and r.ats_job_id is null;

update job_search.applications a
set submitted_at = least(coalesce(a.submitted_at, m.submitted_at), m.submitted_at)
from (
  select survivor_app, min(submitted_at) as submitted_at
  from pursuit_merge
  where submitted_at is not null
  group by survivor_app
) m
where a.id = m.survivor_app;

-- Calendar invites collide: the same meeting ingested against two duplicate
-- rows carries the same ics_uid, and (application_id, ics_uid) is unique. The
-- survivor's copy is the one that stays.
delete from job_search.interviews i
using pursuit_merge m
where i.application_id = m.application_id
  and i.ics_uid is not null
  and exists (
    select 1 from job_search.interviews keep
    where keep.application_id = m.survivor_app and keep.ics_uid = i.ics_uid
  );

update job_search.interviews i
set application_id = m.survivor_app
from pursuit_merge m
where i.application_id = m.application_id;

-- Moving the events re-fires application_events_sync_state, so the survivor's
-- status is recomputed from the enlarged log rather than assumed.
update job_search.application_events e
set application_id = m.survivor_app
from pursuit_merge m
where e.application_id = m.application_id;

update job_search.application_answers x
set application_id = m.survivor_app
from pursuit_merge m
where x.application_id = m.application_id;

update job_search.cover_letters x
set application_id = m.survivor_app
from pursuit_merge m
where x.application_id = m.application_id;

update job_search.reminders x
set application_id = m.survivor_app
from pursuit_merge m
where x.application_id = m.application_id;

update job_search.contact_touches x
set application_id = m.survivor_app
from pursuit_merge m
where x.application_id = m.application_id;

-- Both dismissal tables are unique on the pair they record, so a dismissal the
-- survivor already carries is dropped rather than moved. A dismissal is a
-- "stop offering me this", and it stays true either way.
delete from job_search.message_link_dismissals d
using pursuit_merge m
where d.application_id = m.application_id
  and exists (
    select 1 from job_search.message_link_dismissals keep
    where keep.application_id = m.survivor_app and keep.message_id = d.message_id
  );

update job_search.message_link_dismissals d
set application_id = m.survivor_app
from pursuit_merge m
where d.application_id = m.application_id;

delete from job_search.quiet_dismissals q
using pursuit_merge m
where q.application_id = m.application_id
  and exists (
    select 1 from job_search.quiet_dismissals keep
    where keep.application_id = m.survivor_app and keep.user_id = q.user_id
  );

update job_search.quiet_dismissals q
set application_id = m.survivor_app
from pursuit_merge m
where q.application_id = m.application_id;

-- Role- or application-scoped rows: reassigned to the survivor of whichever id
-- they actually carry.
update job_search.notes x
set application_id = m.survivor_app
from pursuit_merge m
where x.application_id = m.application_id;

update job_search.notes x
set role_id = m.survivor_role
from pursuit_merge m
where x.role_id = m.role_id;

update job_search.attachments x
set application_id = m.survivor_app
from pursuit_merge m
where x.application_id = m.application_id;

update job_search.attachments x
set role_id = m.survivor_role
from pursuit_merge m
where x.role_id = m.role_id;

-- The ledger keeps pointing at whatever the message produced, so a later
-- reprocess of the same mail lands on the survivor rather than recreating the
-- row this migration just removed.
update job_search.ingested_messages x
set resulting_application_id = m.survivor_app
from pursuit_merge m
where x.resulting_application_id = m.application_id;

delete from job_search.applications a
using pursuit_merge m
where a.id = m.application_id;

-- Only if nothing else hangs off it, same guard as 0033 and 0035.
delete from job_search.roles r
using pursuit_merge m
where r.id = m.role_id
  and not exists (select 1 from job_search.applications a where a.role_id = r.id)
  and not exists (select 1 from job_search.notes n where n.role_id = r.id)
  and not exists (select 1 from job_search.attachments t where t.role_id = r.id);

-- ---------------------------------------------------------------------------
-- 2. Link held mail to its own thread.
--
-- Thread continuity is the most precise signal the linker has -- scoreCandidate
-- returns confidence 1 for it and short-circuits everything else -- and a
-- message held before its application existed never got a second look with it.
-- Only threads that now resolve to exactly one application are touched; the
-- merge above is what makes most of them do so.
--
-- No timeline event is written. What kind of event a message implies is a
-- judgement the classifier makes from the body, and bodies are not stored, so
-- inventing one here would be guessing at a pursuit's history. The message is
-- attached to the right pursuit and stops asking to be filed, which is what it
-- was in the queue for.
-- ---------------------------------------------------------------------------
with linked_threads as (
  select m.thread_id, min(v.resulting_application_id::text)::uuid as application_id
  from job_search.ingested_messages v
  join core.ingested_messages m on m.id = v.id
  where v.resulting_application_id is not null
    and m.thread_id is not null
  group by m.thread_id
  having count(distinct v.resulting_application_id) = 1
)
update job_search.ingested_messages v
set resulting_application_id = t.application_id,
    parse_status = 'parsed',
    link_method = 'thread',
    link_confidence = 1,
    error = null
from core.ingested_messages m
join linked_threads t on t.thread_id = m.thread_id
where v.id = m.id
  and v.parse_status = 'needs_review'
  and v.resulting_application_id is null;

-- ---------------------------------------------------------------------------
-- 3. Stop asking about pursuits that are over.
--
-- The flag on an inferred application asks one question: is this a real
-- pursuit, or did the inbox invent it? Once the pursuit has been rejected,
-- withdrawn, closed or ghosted, that question has no consequence -- the answer
-- changes nothing about the board either way, and a queue full of questions
-- that change nothing is a queue nobody opens. Every one of the flagged
-- applications here was closed.
--
-- A trigger rather than a one-off update, so it stays true. BEFORE, so it edits
-- the row on its way in rather than writing it twice; it cannot recurse, and
-- the existing applications_sync_state trigger fires only on two override
-- columns, neither of which this touches.
-- ---------------------------------------------------------------------------
create or replace function job_search.clear_review_flag_when_closed()
returns trigger
language plpgsql
as $$
begin
  if new.needs_review and job_search.is_terminal_application_status(new.status) then
    new.needs_review := false;
  end if;
  return new;
end;
$$;

comment on function job_search.clear_review_flag_when_closed() is
  'Clears needs_review once a pursuit closes. See lib/jobs/review/flagging.ts: the flag asks whether a pursuit is real, and that question stops mattering once it is over.';

drop trigger if exists applications_clear_review_flag on job_search.applications;
create trigger applications_clear_review_flag
  before insert or update on job_search.applications
  for each row execute function job_search.clear_review_flag_when_closed();

-- The backlog the trigger was not there for.
update job_search.applications
set needs_review = false
where needs_review
  and job_search.is_terminal_application_status(status);

-- The same argument for a conflicting event. It is flagged because it could not
-- be applied to a closed pursuit -- but inboundMayMove has since decided that a
-- ghosting is an assumption made by a clock rather than a fact, so mail landing
-- afterwards is the thing that assumption was waiting for and moves the pursuit
-- normally. These are the ones written before that rule existed. The events
-- stay on the timeline; only the flag clears.
update job_search.application_events e
set needs_review = false
where e.needs_review
  and exists (
    select 1 from job_search.applications a
    where a.id = e.application_id and a.status = 'ghosted'
  );

-- ---------------------------------------------------------------------------
-- 4. Offer everything still held to the fixed linker again.
--
-- relink_attempts is what stops a message that will never resolve being re-read
-- and re-paid for on every sync. The rules it was tried against have changed,
-- so the attempts it has spent were spent against a linker that no longer
-- exists. This is exactly the case resetRelinkAttempts() exists for.
-- ---------------------------------------------------------------------------
update job_search.ingested_messages
set relink_attempts = 0
where parse_status = 'needs_review'
  and relink_attempts > 0;

commit;
