-- Lock down SECURITY DEFINER helpers.
--
-- These exist for triggers and for trusted server code. They must not be
-- callable via PostgREST RPC as anon or authenticated -- that is what the
-- Supabase security advisor flags.
--
-- EXECUTE is checked when a trigger is *created*, not when it fires, so
-- revoking after the fact does not break inserts.

set search_path = job_search, extensions;

alter function job_search.touch_updated_at() set search_path = job_search;

revoke all on function job_search.touch_updated_at() from public, anon, authenticated;
revoke all on function job_search.handle_new_user() from public, anon, authenticated;
revoke all on function job_search.sync_application_state(uuid) from public, anon, authenticated;
revoke all on function job_search.sync_application_state_from_event() from public, anon, authenticated;
revoke all on function job_search.sync_application_state_self() from public, anon, authenticated;
revoke all on function job_search.sweep_ghosted_applications(uuid) from public, anon, authenticated;
revoke all on function job_search.sync_company_status(uuid) from public, anon, authenticated;
revoke all on function job_search.sync_company_status_from_application() from public, anon, authenticated;
revoke all on function job_search.assert_parents_same_owner() from public, anon, authenticated;
revoke all on function job_search.assert_interview_participant_same_owner() from public, anon, authenticated;
revoke all on function job_search.touch_question_seen(uuid) from public, anon, authenticated;

-- These two are pure and safe to call, and the app reads them for display.
grant execute on function job_search.application_status_rank(application_status) to authenticated;
grant execute on function job_search.is_terminal_application_status(application_status) to authenticated;
