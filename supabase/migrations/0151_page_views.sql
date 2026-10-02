-- A record of each page the person opens (plan #1481, docs/CUT-BACK-SPEC.md
-- part 1).
--
-- Nothing recorded which pages were used, so the cut-back was judged from
-- table counts. proxy.ts now writes one row here per real navigation, after
-- the response has gone, so the page never waits on it. The Usage tab in Dev
-- (#1482) and the weekly vision review (#1483) read it.
--
-- core.page_views, one row per page opened:
--   route      the page's route pattern, ids replaced: /learn/s/[id], never
--              /learn/s/6f1c... (lib/usage/page-view.ts)
--   workspace  the workspace the route belongs to (lib/modules.ts), or null
--              for pages outside every workspace: /home, /ask, /timeline
--   via        'load' for a full document request, 'navigation' for a client
--              navigation (an RSC request without the prefetch header)
--   viewed_at  when it was opened
--
-- core.page_view_days, the daily counts a row turns into once it is older
-- than 180 days, so the history is kept while the table stays small. The day
-- is the UTC date.

set search_path = core, public, extensions;

create table core.page_views (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  route text not null,
  workspace text,
  via text not null,
  viewed_at timestamptz not null default now(),

  constraint page_views_route_ck check (left(route, 1) = '/' and char_length(route) <= 300),
  constraint page_views_workspace_ck check (workspace is null or char_length(workspace) <= 40),
  constraint page_views_via_ck check (via in ('load', 'navigation'))
);

-- Opens over the last 7 and 30 days, per page and per workspace.
create index page_views_user_time_idx on core.page_views (user_id, viewed_at desc);
-- The roll-up's cut, across every account.
create index page_views_time_idx on core.page_views (viewed_at);

alter table core.page_views enable row level security;

create policy page_views_read on core.page_views for select to authenticated
  using (user_id = (select auth.uid()));
create policy page_views_write on core.page_views for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on core.page_views from anon;
revoke all on core.page_views from authenticated;
grant select, insert on core.page_views to authenticated;
grant all on core.page_views to service_role;

comment on table core.page_views is
  'One row per page the person opened, by route pattern, written by proxy.ts after the response (plan #1481).';

create table core.page_view_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  route text not null,
  workspace text,
  opens integer not null,

  primary key (user_id, day, route),
  constraint page_view_days_opens_ck check (opens > 0)
);

alter table core.page_view_days enable row level security;

create policy page_view_days_read on core.page_view_days for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.page_view_days from anon;
revoke all on core.page_view_days from authenticated;
grant select on core.page_view_days to authenticated;
grant all on core.page_view_days to service_role;

comment on table core.page_view_days is
  'Daily opens per route for page views older than 180 days, rolled up from core.page_views (plan #1481).';

-- Opens per page for the Usage tab and the vision review: the last 7 and 30
-- days, and when it was last opened, reaching into the daily counts for a
-- page not opened in the last 180 days. Read as the person (security_invoker),
-- so each account sees only its own. A page never opened has no row; the
-- full list of pages is PAGE_ROUTES in lib/usage/pages.ts.
create view core.page_opens with (security_invoker = true) as
select user_id, route, max(workspace) as workspace,
       count(*) filter (where viewed_at >= now() - interval '7 days')::integer as opens_7,
       count(*) filter (where viewed_at >= now() - interval '30 days')::integer as opens_30,
       max(viewed_at) as last_opened
from (
  select user_id, route, workspace, viewed_at from core.page_views
  union all
  -- A rolled-up day counts as opened at the end of that day; it is older
  -- than 180 days, so it only ever sets last_opened.
  select user_id, route, workspace, ((day + 1)::timestamp at time zone 'UTC') - interval '1 second'
  from core.page_view_days
) opened
group by user_id, route;

revoke all on core.page_opens from anon;
grant select on core.page_opens to authenticated, service_role;

-- Folds every page view older than `keep` into its day's count and removes
-- it, in one statement, so a row is never counted twice or lost. Returns how
-- many rows it folded. Run daily by pg_cron below.
create or replace function core.roll_up_page_views(keep interval default interval '180 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  folded integer;
begin
  with gone as (
    delete from core.page_views
    where viewed_at < now() - keep
    returning user_id, route, workspace, viewed_at
  ), counted as (
    insert into core.page_view_days (user_id, day, route, workspace, opens)
    select user_id, (viewed_at at time zone 'UTC')::date, route, max(workspace), count(*)::integer
    from gone
    group by user_id, (viewed_at at time zone 'UTC')::date, route
    on conflict (user_id, day, route)
      do update set opens = core.page_view_days.opens + excluded.opens
  )
  -- A data-modifying CTE runs whether or not it is read, so counted always
  -- lands; the count is of the rows removed.
  select count(*)::integer into folded from gone;
  return folded;
end;
$$;

revoke execute on function core.roll_up_page_views(interval) from public, anon, authenticated;
grant execute on function core.roll_up_page_views(interval) to service_role;

-- Daily at 04:19 UTC, a minute no other job here uses.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice
      'pg_cron not available here -- skipping the page view roll-up schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'page-views-roll-up'
  $unschedule$;

  execute $schedule$
    select cron.schedule('page-views-roll-up', '19 4 * * *', 'select core.roll_up_page_views()')
  $schedule$;
end;
$$;
