-- Page opens per workspace since a given time, for the weekly vision review
-- (plan #1483, docs/CUT-BACK-SPEC.md part 1).
--
-- core.page_opens counts fixed 7 and 30 day windows. The review's window is
-- "since this workspace was last reviewed", which can be any length, so it
-- counts here instead: the single rows in core.page_views, and the daily
-- counts in core.page_view_days for any part of the window older than 180
-- days. A rolled-up day counts when its date falls on or after the window's
-- start date, so the first day of a long window can be counted whole.
--
-- workspace is null for pages outside every workspace (/home, /ask). A
-- workspace with no opens in the window has no row.
--
-- Read as the caller (security invoker): signed in, RLS keeps it to the
-- person's own rows; the service role passes the account it reviews for.

create or replace function core.workspace_opens(p_user_id uuid, p_since timestamptz)
returns table (workspace text, opens integer, pages integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select opened.workspace, sum(opened.n)::integer, count(distinct opened.route)::integer
  from (
    select v.workspace, v.route, 1 as n
    from core.page_views v
    where v.user_id = p_user_id and v.viewed_at >= p_since
    union all
    select d.workspace, d.route, d.opens
    from core.page_view_days d
    where d.user_id = p_user_id and d.day >= (p_since at time zone 'UTC')::date
  ) opened
  group by opened.workspace
$$;

revoke execute on function core.workspace_opens(uuid, timestamptz) from public, anon;
grant execute on function core.workspace_opens(uuid, timestamptz) to authenticated, service_role;

comment on function core.workspace_opens(uuid, timestamptz) is
  'Page opens and distinct pages opened per workspace since a time, for the vision review (plan #1483).';
