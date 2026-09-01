-- Merge the "Role from email" duplicates the old dedupe left behind.
--
-- createInferredApplication matched an existing pursuit by exact title, and a
-- title the model could not read never matches one it could -- so a company
-- ended up with "Finance Manager" and "Role from email" open beside each
-- other, both inferred, both in process, both from the same conversation. The
-- rule is fixed in lib/jobs/inbox/ingest-messages (choosePursuit); this moves
-- what is already on the board.
--
-- Only the unambiguous case is touched: exactly one open placeholder and
-- exactly one open named pursuit at the same company. Where a company has
-- several of either, which mail belongs to which role is a guess, and a wrong
-- merge cannot be undone -- those are left alone deliberately.
--
-- Nothing is discarded. Events, interviews and the mail that produced them are
-- moved onto the surviving pursuit first; only then is the placeholder row
-- deleted. Moving the events re-fires application_events_sync_state, so the
-- survivor's status is recomputed from the enlarged log rather than assumed.

begin;

create temporary table placeholder_merge on commit drop as
with open_apps as (
  select r.company_id, r.id as role_id, r.title, a.id as application_id
  from job_search.roles r
  join job_search.applications a on a.role_id = r.id
  where a.status not in ('rejected', 'withdrawn', 'role_closed', 'ghosted')
)
select
  company_id,
  (array_agg(application_id) filter (where title = 'Role from email'))[1] as placeholder_app,
  (array_agg(role_id)        filter (where title = 'Role from email'))[1] as placeholder_role,
  (array_agg(application_id) filter (where title <> 'Role from email'))[1] as surviving_app
from open_apps
group by company_id
having count(*) filter (where title = 'Role from email') = 1
   and count(*) filter (where title <> 'Role from email') = 1;

update job_search.interviews i
set application_id = m.surviving_app
from placeholder_merge m
where i.application_id = m.placeholder_app;

update job_search.application_events e
set application_id = m.surviving_app
from placeholder_merge m
where e.application_id = m.placeholder_app;

update job_search.application_answers x
set application_id = m.surviving_app
from placeholder_merge m
where x.application_id = m.placeholder_app;

update job_search.attachments x
set application_id = m.surviving_app
from placeholder_merge m
where x.application_id = m.placeholder_app;

update job_search.notes x
set application_id = m.surviving_app
from placeholder_merge m
where x.application_id = m.placeholder_app;

update job_search.reminders x
set application_id = m.surviving_app
from placeholder_merge m
where x.application_id = m.placeholder_app;

update job_search.contact_touches x
set application_id = m.surviving_app
from placeholder_merge m
where x.application_id = m.placeholder_app;

-- The ledger keeps pointing at whatever the message produced, so a later
-- reprocess of the same mail lands on the survivor rather than recreating the
-- row this migration just removed.
update job_search.ingested_messages x
set resulting_application_id = m.surviving_app
from placeholder_merge m
where x.resulting_application_id = m.placeholder_app;

delete from job_search.applications a
using placeholder_merge m
where a.id = m.placeholder_app;

-- Only if nothing else hangs off it. A placeholder role with a second
-- application under it is not the case this migration is about.
delete from job_search.roles r
using placeholder_merge m
where r.id = m.placeholder_role
  and not exists (select 1 from job_search.applications a where a.role_id = r.id);

commit;
