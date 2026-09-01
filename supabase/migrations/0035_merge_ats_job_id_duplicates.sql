-- Merge pursuits that share an ATS job id at the same company.
--
-- The app already trusts an ATS job id match as near-certain proof of the
-- same requisition (see scoreCandidate in lib/jobs/email/link.ts: 0.9-0.97
-- confidence, comfortably above the auto-link threshold). But that scoring
-- only ever ran against applications the linker had already loaded for the
-- batch -- leads (recruiter_outreach, scheduling, interview_invite) went
-- through a separate, cruder path (choosePursuit in
-- lib/jobs/inbox/ingest-messages.ts) that matched on exact role title only,
-- never on ats_job_id. A recruiter's own address also frequently isn't the
-- company's known domain (emma@meetelise.com vs. the ashbyhq.com the company
-- record was seeded from), so even the company-name signal often couldn't
-- carry a strong enough score. The result: every follow-up email about the
-- same req spawned a fresh role and a fresh application instead of joining
-- the one already open. That root cause is fixed in code (link.ts now learns
-- a recruiter's domain the first time it matches by name); this migration
-- cleans up what it already left behind.
--
-- Only the unambiguous case is touched: roles at the same company sharing
-- the exact same non-null ats_job_id. Two different messages naming the same
-- ATS requisition number cannot be two different roles. Where titles or
-- statuses differ across the group that is expected -- a role can be
-- extracted with slightly different text each time, and the survivor's
-- status is recomputed from the union of events, not assumed.
--
-- Nothing is discarded. Every child row is moved onto the earliest
-- application (and its role) in each group before anything is deleted.

begin;

-- Ordered by first_seen_at -- when the mail that produced the role arrived --
-- rather than the row's own created_at, because these were mostly written by
-- a backfill and inserted out of that order. first_seen_at is what the app
-- itself treats as "when this pursuit started" (see ingest-messages.ts).
create temporary table ats_dup_rows on commit drop as
select
  a.id as application_id,
  r.id as role_id,
  first_value(a.id) over w as survivor_app,
  first_value(r.id) over w as survivor_role
from job_search.applications a
join job_search.roles r on r.id = a.role_id
where r.ats_job_id is not null
window w as (partition by r.company_id, r.ats_job_id order by r.first_seen_at, r.id);

create temporary table ats_dup_merge on commit drop as
select * from ats_dup_rows where application_id <> survivor_app;

-- Application-scoped rows: reassigned to the survivor application.
update job_search.interviews i
set application_id = m.survivor_app
from ats_dup_merge m
where i.application_id = m.application_id;

update job_search.application_events e
set application_id = m.survivor_app
from ats_dup_merge m
where e.application_id = m.application_id;

update job_search.application_answers x
set application_id = m.survivor_app
from ats_dup_merge m
where x.application_id = m.application_id;

update job_search.cover_letters x
set application_id = m.survivor_app
from ats_dup_merge m
where x.application_id = m.application_id;

update job_search.reminders x
set application_id = m.survivor_app
from ats_dup_merge m
where x.application_id = m.application_id;

update job_search.contact_touches x
set application_id = m.survivor_app
from ats_dup_merge m
where x.application_id = m.application_id;

-- Role- or application-scoped rows: reassigned to the survivor of whichever
-- id they actually carry.
update job_search.notes x
set application_id = m.survivor_app
from ats_dup_merge m
where x.application_id = m.application_id;

update job_search.notes x
set role_id = m.survivor_role
from ats_dup_merge m
where x.role_id = m.role_id;

update job_search.attachments x
set application_id = m.survivor_app
from ats_dup_merge m
where x.application_id = m.application_id;

update job_search.attachments x
set role_id = m.survivor_role
from ats_dup_merge m
where x.role_id = m.role_id;

-- The ledger keeps pointing at whatever the message produced, so a later
-- reprocess of the same mail lands on the survivor rather than recreating
-- the row this migration just removed.
update job_search.ingested_messages x
set resulting_application_id = m.survivor_app
from ats_dup_merge m
where x.resulting_application_id = m.application_id;

delete from job_search.applications a
using ats_dup_merge m
where a.id = m.application_id;

-- Only if nothing else hangs off it, same guard as the placeholder merge.
delete from job_search.roles r
using ats_dup_merge m
where r.id = m.role_id
  and not exists (select 1 from job_search.applications a where a.role_id = r.id)
  and not exists (select 1 from job_search.notes n where n.role_id = r.id)
  and not exists (select 1 from job_search.attachments t where t.role_id = r.id);

commit;
