-- Move the contacts the LinkedIn import added off To contact (plan #2432.5).
-- It needs job_search 0064 (the Connected status) and core 0262 (the import
-- keys), so it lives here, after both.
--
-- The import now starts each contact it adds where the export's history puts
-- it. This does the same for the ones the first run added, from the touches
-- now on each: Responded when you wrote and they wrote back, Contacted when
-- only you wrote, Connected when neither.
--
-- Only the owner's rows, only contacts the import added (created after its
-- run began, so a contact the person had before and the import joined keeps
-- its status), and only ones still at To contact, so a status the person set
-- since is left alone.

update job_search.contacts c
set status = case
    when exists (select 1 from job_search.contact_touches t where t.contact_id = c.id and t.direction = 'outbound')
     and exists (select 1 from job_search.contact_touches t where t.contact_id = c.id and t.direction = 'inbound')
      then 'responded'::job_search.contact_status
    when exists (select 1 from job_search.contact_touches t where t.contact_id = c.id and t.direction = 'outbound')
      then 'contacted'::job_search.contact_status
    else 'connected'::job_search.contact_status
  end
from core.import_keys k
join core.import_runs r on r.id = k.run_id and r.user_id = k.user_id
where k.row_id = c.id
  and k.user_id = c.user_id
  and c.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
  and k.source = 'linkedin'
  and k.kind in ('connections', 'correspondents')
  and c.created_at >= r.created_at
  and c.status = 'to_contact';
