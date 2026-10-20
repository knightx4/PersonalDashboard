-- Take out the outreach the LinkedIn import wrote for bare connection requests
-- (plan #2432.5).
--
-- The first import made every outgoing invitation a linkedin_connect touch,
-- including the 31 sent with no note. A connection request with no note is
-- not outreach, and each showed on its contact as a reach-out with nothing
-- said. The importer now skips them; this removes the ones already written.
--
-- Only the owner's rows, only touches the import added (created after its
-- run began, so a touch the person logged by hand and the import joined is
-- kept), and only ones with no message. Their import keys go with them, so a
-- later run counts the invitation as skipped rather than as deleted by you.

with bare as (
  select t.id as touch_id, k.id as key_id
  from core.import_keys k
  join core.import_runs r on r.id = k.run_id and r.user_id = k.user_id
  join job_search.contact_touches t on t.id = k.row_id and t.user_id = k.user_id
  where k.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
    and k.source = 'linkedin'
    and k.kind = 'invitations'
    and t.channel = 'linkedin_connect'
    and t.message is null
    and t.created_at >= r.created_at
),
gone_keys as (
  delete from core.import_keys k
  using bare
  where k.id = bare.key_id and k.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
)
delete from job_search.contact_touches t
using bare
where t.id = bare.touch_id and t.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685';
