-- Page views and model spend per day, and the 7- and 30-day figures over the
-- same days, for the Usage tab in Dev (plan #2036.2).
--
-- The tab opens with two charts of the last 30 days, one bar per day in the
-- person's timezone. The figures beneath them came from core.page_opens and
-- core.function_spend, whose windows run back exactly 30 days from now, which
-- reaches part-way into a 31st day. Summed per day, the bars then fell short
-- of the figures under them by whatever happened in that part-day. So the tab
-- now reads every figure from one window: midnight at the start of the first
-- day, in the person's timezone, worked out by the app (lib/usage/per-day.ts)
-- and passed in. The views stay as they are for their other readers.
--
-- Functions rather than rows sent back to be summed in the app: a month of
-- the spend ledger holds tens of thousands of rows, more than one PostgREST
-- request returns, and a sum cut short by the row cap would be a wrong number
-- shown as a right one. Security invoker, so each table's own RLS keeps a
-- signed-in caller to their rows.

-- Views per day, the day being the date in p_timezone. Days with no views are
-- left out; the app fills them.
create or replace function core.page_views_per_day(p_timezone text, p_since timestamptz)
returns table (day date, views integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select (v.viewed_at at time zone p_timezone)::date as day, count(*)::integer as views
  from core.page_views v
  where v.viewed_at >= p_since
  group by 1;
$$;

-- Spend per day in micro-dollars, with the calls and the calls no rate priced.
-- An unpriced call adds nothing to `spend` and is counted in `unpriced`.
create or replace function core.model_spend_per_day(p_timezone text, p_since timestamptz)
returns table (day date, spend bigint, calls integer, unpriced integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select (s.created_at at time zone p_timezone)::date as day,
         coalesce(sum(s.cost_micros), 0)::bigint as spend,
         count(*)::integer as calls,
         count(*) filter (where s.cost_micros is null)::integer as unpriced
  from core.model_spend s
  where s.created_at >= p_since
  group by 1;
$$;

-- core.page_opens with the two windows passed in. A rolled-up day counts as
-- opened at the end of that day, as in the view; it is older than 180 days,
-- so it only ever sets last_opened.
create or replace function core.page_opens_since(p_since7 timestamptz, p_since30 timestamptz)
returns table (route text, workspace text, opens_7 integer, opens_30 integer, last_opened timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.route, max(o.workspace) as workspace,
         count(*) filter (where o.viewed_at >= p_since7)::integer as opens_7,
         count(*) filter (where o.viewed_at >= p_since30)::integer as opens_30,
         max(o.viewed_at) as last_opened
  from (
    select v.route, v.workspace, v.viewed_at from core.page_views v
    union all
    select d.route, d.workspace, ((d.day + 1)::timestamp at time zone 'UTC') - interval '1 second'
    from core.page_view_days d
  ) o
  group by o.route;
$$;

-- core.function_spend with the two windows passed in.
create or replace function core.function_spend_since(p_since7 timestamptz, p_since30 timestamptz)
returns table (module text, operation text, spend_7 bigint, spend_30 bigint, calls_30 integer, unpriced_30 integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.module, s.operation,
         coalesce(sum(s.cost_micros) filter (where s.created_at >= p_since7), 0)::bigint as spend_7,
         coalesce(sum(s.cost_micros), 0)::bigint as spend_30,
         count(*)::integer as calls_30,
         count(*) filter (where s.cost_micros is null)::integer as unpriced_30
  from core.model_spend s
  where s.created_at >= p_since30
  group by s.module, s.operation;
$$;

revoke all on function core.page_views_per_day(text, timestamptz) from public, anon;
revoke all on function core.model_spend_per_day(text, timestamptz) from public, anon;
revoke all on function core.page_opens_since(timestamptz, timestamptz) from public, anon;
revoke all on function core.function_spend_since(timestamptz, timestamptz) from public, anon;
grant execute on function core.page_views_per_day(text, timestamptz) to authenticated, service_role;
grant execute on function core.model_spend_per_day(text, timestamptz) to authenticated, service_role;
grant execute on function core.page_opens_since(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function core.function_spend_since(timestamptz, timestamptz) to authenticated, service_role;

comment on function core.page_views_per_day(text, timestamptz) is
  'Page views per day in the given timezone since an instant, for the Usage charts (plan #2036.2).';
comment on function core.model_spend_per_day(text, timestamptz) is
  'Model spend, calls and unpriced calls per day in the given timezone since an instant (plan #2036.2).';
comment on function core.page_opens_since(timestamptz, timestamptz) is
  'Opens per page since two instants, the Usage tab''s 7- and 30-day windows (plan #2036.2).';
comment on function core.function_spend_since(timestamptz, timestamptz) is
  'Model spend per function since two instants, the Usage tab''s 7- and 30-day windows (plan #2036.2).';
