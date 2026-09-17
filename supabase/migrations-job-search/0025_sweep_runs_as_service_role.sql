-- The nightly ghost sweep could not be called by the thing that calls it.
--
-- 0005 locked down the SECURITY DEFINER helpers so PostgREST could not reach
-- them as anon or authenticated, which is right. But it revoked from `public`,
-- and `service_role` held EXECUTE on these functions only *through* PUBLIC --
-- nothing had ever granted it directly. So the revoke took the privilege away
-- from the background job too.
--
-- The effect was invisible and total. inngest/jobs/cron/sweep.ts calls
-- sweep_ghosted_applications() with the service key; every night since, that
-- RPC came back permission denied, runJobSweep threw, and /api/cron/daily
-- recorded `jobs-sweep` as a failed stage and moved on. Ghosting is the one
-- rule that cannot be driven by a trigger -- an application goes quiet
-- precisely by nothing happening to it -- so with the sweep dead, nothing was
-- ever ghosted again. Applications sat at `acknowledged` forty-five days after
-- their last contact, on a board whose threshold said thirty.
--
-- The grant is to service_role alone. anon and authenticated stay revoked:
-- the advisor's point in 0005 still stands, and a browser must not be able to
-- re-derive everybody's pipeline. sync_application_state() needs no grant of
-- its own -- the sweep is SECURITY DEFINER owned by postgres, so the call it
-- makes inside runs as the owner.

set search_path = job_search, extensions;

grant execute on function job_search.sweep_ghosted_applications(uuid) to service_role;
