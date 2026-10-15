-- ===========================================================================
-- Metrics on a goal (plan #2084.1).
--
-- Feature #2084 shows a chart on a goal's Overview of how many things you did
-- each week or month, such as how many jobs you applied to. A goal's own
-- number (0004, 0028) is a level read on a date and stays as it is; a metric
-- is a count of records over time. Each row says what to count:
--
--   metrics.goal_id         the goal it is shown on.
--   metrics.name            what the chart is called, "Applications".
--   metrics.collection_id   the list whose records are counted.
--   metrics.date_field      the key of a date field of that list; a record
--                           is counted in the period its date falls in, and
--                           a record with no date is not counted.
--   metrics.period          week (Monday to Sunday) or month.
--   metrics.target          how many per period you are aiming for, or null.
--   metrics.position        the order on the Overview.
--   metrics.archived_at     set when the metric is taken off the goal.
--
-- The counts are not stored: lib/goals/metrics.ts works them out from the
-- records, leaving out drafts and archived records as the goal's number does.
--
-- The date field has to be a live date field of the list, and the goal a
-- goal, checked by metrics_check. History, row level security and grants
-- follow every other goals table.
-- ===========================================================================

create table goals.metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  goal_id uuid not null,
  name text not null,
  collection_id uuid not null,
  date_field text not null,
  period text not null default 'week',
  target integer,
  position integer not null default 0,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint metrics_goal_fk foreign key (goal_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint metrics_collection_fk foreign key (collection_id, user_id)
    references goals.collections (id, user_id),

  constraint metrics_name_ck check (btrim(name) <> '' and length(name) <= 200),
  constraint metrics_date_field_ck check (date_field ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint metrics_period_ck check (period in ('week', 'month')),
  constraint metrics_target_ck check (target is null or (target > 0 and target <= 100000))
);

create index metrics_goal_idx on goals.metrics (goal_id, position) where archived_at is null;
create index metrics_collection_idx on goals.metrics (collection_id);

-- ---------------------------------------------------------------------------
-- The goal is a goal, and the field a live date field of the list.
-- ---------------------------------------------------------------------------
create or replace function goals.metrics_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  field jsonb;
begin
  if not exists (select 1 from goals.items i where i.id = new.goal_id and i.level = 'goal') then
    raise exception 'metrics: % is not a goal', new.goal_id
      using errcode = 'check_violation', constraint = 'metrics_goal_is_goal';
  end if;
  select f.value into field
    from goals.collections c, jsonb_array_elements(c.fields) f
   where c.id = new.collection_id
     and f.value ->> 'key' = new.date_field
     and not coalesce((f.value ->> 'removed')::boolean, false);
  if field is null then
    raise exception 'metrics: the list has no field %', new.date_field
      using errcode = 'check_violation', constraint = 'metrics_date_field', detail = 'date_field';
  end if;
  if field ->> 'type' <> 'date' then
    raise exception 'metrics: % is not a date, so records cannot be counted by it', field ->> 'label'
      using errcode = 'check_violation', constraint = 'metrics_date_field', detail = 'date_field';
  end if;
  return new;
end;
$$;

revoke all on function goals.metrics_check() from public, anon, authenticated;

create trigger metrics_check
  before insert or update of goal_id, collection_id, date_field on goals.metrics
  for each row execute function goals.metrics_check();

create trigger metrics_touch_updated_at before update on goals.metrics
  for each row execute function goals.touch_updated_at();

-- ---------------------------------------------------------------------------
-- History, as every goals table.
-- ---------------------------------------------------------------------------
alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions', 'collections', 'collection_goals', 'records', 'comments', 'dependencies',
    'reviews', 'context', 'answers', 'briefs', 'document_kinds', 'progress_entries', 'metrics'
  )
);

create trigger metrics_history after insert or update or delete on goals.metrics
  for each row execute function goals.record_history();

-- ---------------------------------------------------------------------------
-- Row level security and grants.
-- ---------------------------------------------------------------------------
alter table goals.metrics enable row level security;

create policy metrics_all on goals.metrics for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.metrics from anon, public;
grant select, insert, update, delete on goals.metrics to authenticated, service_role;

comment on table goals.metrics is
  'What a goal counts over time: the records of one list, by one of its date fields, per week or month, with an optional target per period (plan #2084.1). The counts are worked out in lib/goals/metrics.ts, not stored.';

notify pgrst, 'reload schema';
