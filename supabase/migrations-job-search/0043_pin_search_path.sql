-- Pin search_path on the four job_search functions that never set one.
--
-- The security advisor flags each as "role mutable search_path": with no
-- setting of its own, a function resolves names through whatever search_path
-- the calling role has. None of these is security definer, so the exposure is
-- small, but pinning it is free and clears the advisor.
--
-- An empty path is safe for all four. Three compare their argument with
-- string literals, which take the argument's enum type without a lookup, and
-- the trigger already calls job_search.is_terminal_application_status by its
-- full name. Nothing indexes or checks on these functions, so losing SQL
-- inlining (which a SET clause prevents) costs nothing measurable: they are
-- called from plpgsql in sync_application_state, sync_company_status and the
-- trigger.

alter function job_search.application_status_rank(job_search.application_status)
  set search_path = '';
alter function job_search.is_terminal_application_status(job_search.application_status)
  set search_path = '';
alter function job_search.unapplied_event_needs_review(job_search.application_event_kind)
  set search_path = '';

-- clear_review_flag_when_closed was created on the live project by a
-- migration that is not in this folder, so the local test database does not
-- have it. Pin it only where it exists.
do $$
begin
  if to_regprocedure('job_search.clear_review_flag_when_closed()') is not null then
    alter function job_search.clear_review_flag_when_closed() set search_path = '';
  end if;
end
$$;
