-- How far through each goal and feature was, day by day (plan #1836).
--
-- core.scope_days holds one row per scope per day: total is the steps under
-- the scope that existed by the end of that day, and done is how many of those
-- had been finished. The step counts a goal or feature earns on a day are what
-- a progress chart and a goal's pace are drawn from (#1837).
--
--   ref     the scope, as 'goals.items:<id>' for an open goal or
--           'public.plan_items:<id>' for an open top-level plan item
--   day     the date in the person's own zone (core.account_settings.timezone)
--
-- Steps are counted at the leaves: a step with live steps beneath it is not
-- counted itself, its children are. Dropped and dismissed steps are left out,
-- and so is everything beneath them. A step is created on its created_at and
-- done on its closed_at (goals) or completed_at (plan), or its created_at where
-- a done step has no finish time recorded.
--
-- core.refresh_scope_days() is a stage of the daily cron. It writes today's row
-- for every open scope. With p_backfill it also writes every earlier day back
-- to the scope's creation, from the same timestamps, and never replaces a day
-- already stored; the call at the end of this file is the one-time fill.
--
-- Owner-only: the person reads their own rows, the cron writes them.

set search_path = core, goals, public, extensions;

create table core.scope_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ref text not null,
  day date not null,
  total integer not null,
  done integer not null,
  created_at timestamptz not null default now(),

  constraint scope_days_ref_day_uq unique (ref, day),
  constraint scope_days_ref_ck check (ref ~ '^(goals\.items|public\.plan_items):[0-9a-f-]{36}$'),
  constraint scope_days_counts_ck check (total >= 0 and done >= 0 and done <= total)
);

create index scope_days_user_day_idx on core.scope_days (user_id, day desc);

alter table core.scope_days enable row level security;

create policy scope_days_select on core.scope_days for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.scope_days from public, anon, authenticated;
grant select on core.scope_days to authenticated;
grant all on core.scope_days to service_role;

comment on table core.scope_days is
  'Steps under each open goal or feature at the end of each day: total existing, done so far (plan #1836).';
comment on column core.scope_days.ref is
  'The scope: goals.items:<id> or public.plan_items:<id>.';

-- Every open scope's day counts, today's only or all the way back.
create function core.scope_day_series(p_backfill boolean)
returns table (user_id uuid, ref text, day date, total integer, done integer, is_today boolean)
language plpgsql
stable
set search_path = core, goals, public, extensions
as $fn$
begin
  return query
  with recursive
  goal_tree as (
    select g.user_id, g.id as root_id, g.id, g.created_at as root_created
      from goals.items g
     where g.level = 'goal' and g.status = 'open'
    union all
    select t.user_id, t.root_id, i.id, t.root_created
      from goal_tree t
      join goals.items i on i.parent_id = t.id and i.user_id = t.user_id
     where i.status <> 'dropped' and i.dismissed_at is null
  ),
  plan_tree as (
    select p.user_id, p.id as root_id, p.id, p.created_at as root_created
      from public.plan_items p
     where p.parent_id is null and p.status not in ('done', 'dropped') and p.dismissed_at is null
    union all
    select t.user_id, t.root_id, i.id, t.root_created
      from plan_tree t
      join public.plan_items i on i.parent_id = t.id and i.user_id = t.user_id
     where i.status <> 'dropped' and i.dismissed_at is null
  ),
  scopes as (
    select t.user_id, 'goals.items:' || t.root_id as ref, min(t.root_created) as started
      from goal_tree t group by t.user_id, t.root_id
    union all
    select t.user_id, 'public.plan_items:' || t.root_id, min(t.root_created)
      from plan_tree t group by t.user_id, t.root_id
  ),
  leaves as (
    select t.user_id, 'goals.items:' || t.root_id as ref, i.created_at as made,
           case when i.status = 'done' then coalesce(i.closed_at, i.created_at) end as finished
      from goal_tree t
      join goals.items i on i.id = t.id and i.user_id = t.user_id
     where t.id <> t.root_id
       and not exists (
         select 1 from goals.items c
          where c.parent_id = i.id and c.user_id = i.user_id
            and c.status <> 'dropped' and c.dismissed_at is null)
    union all
    select t.user_id, 'public.plan_items:' || t.root_id, i.created_at,
           case when i.status = 'done' then coalesce(i.completed_at, i.created_at) end
      from plan_tree t
      join public.plan_items i on i.id = t.id and i.user_id = t.user_id
     where t.id <> t.root_id
       and not exists (
         select 1 from public.plan_items c
          where c.parent_id = i.id and c.user_id = i.user_id
            and c.status <> 'dropped' and c.dismissed_at is null)
  ),
  zoned as (
    select s.user_id, s.ref,
           coalesce(a.timezone, 'UTC') as tz,
           s.started
      from scopes s
      left join core.account_settings a on a.user_id = s.user_id
  ),
  bounds as (
    select z.user_id, z.ref, z.tz,
           (now() at time zone z.tz)::date as today,
           case when p_backfill
                then least((z.started at time zone z.tz)::date, (now() at time zone z.tz)::date)
                else (now() at time zone z.tz)::date end as first_day
      from zoned z
  ),
  days as (
    select b.user_id, b.ref, b.tz, b.today, d::date as day
      from bounds b
     cross join lateral generate_series(b.first_day, b.today, interval '1 day') d
  )
  select d.user_id, d.ref, d.day,
         (select count(*) from leaves l
           where l.ref = d.ref and (l.made at time zone d.tz)::date <= d.day)::integer,
         (select count(*) from leaves l
           where l.ref = d.ref and l.finished is not null
             and greatest((l.finished at time zone d.tz)::date, (l.made at time zone d.tz)::date) <= d.day)::integer,
         d.day = d.today
    from days d;
end;
$fn$;

-- The cron stage, and the one-time fill. Returns the rows written.
create function core.refresh_scope_days(p_backfill boolean default false)
returns integer
language plpgsql
set search_path = core, goals, public, extensions
as $fn$
declare
  written integer := 0;
  n integer;
begin
  create temporary table scope_series on commit drop as
    select * from core.scope_day_series(p_backfill);

  -- Earlier days are filled once and never replaced.
  insert into core.scope_days (user_id, ref, day, total, done)
  select s.user_id, s.ref, s.day, s.total, s.done
    from scope_series s
   where not s.is_today
  on conflict (ref, day) do nothing;
  get diagnostics n = row_count;
  written := written + n;

  -- Today is rewritten by every run, so a step added this afternoon counts.
  insert into core.scope_days (user_id, ref, day, total, done)
  select s.user_id, s.ref, s.day, s.total, s.done
    from scope_series s
   where s.is_today
  on conflict (ref, day) do update set total = excluded.total, done = excluded.done;
  get diagnostics n = row_count;
  written := written + n;

  return written;
end;
$fn$;

revoke all on function core.scope_day_series(boolean) from public, anon, authenticated;
revoke all on function core.refresh_scope_days(boolean) from public, anon, authenticated;
grant execute on function core.scope_day_series(boolean) to service_role;
grant execute on function core.refresh_scope_days(boolean) to service_role;

-- The one-time fill of past days.
select core.refresh_scope_days(true);
