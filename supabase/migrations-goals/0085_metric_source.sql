-- ===========================================================================
-- What a metric counts (plan #2397.1).
--
-- A metric (0078) counted the records of one list by one of its date fields.
-- Feature #2397 lets it count two more things on its goal instead:
--
--   metrics.source   list   the records of collection_id, by date_field, as
--                           before. Every metric made before this is one.
--                    steps  the goal's steps closed in each period.
--                    files  the files Dash wrote under the goal.
--
-- collection_id and date_field are set for a list and empty otherwise, which
-- metrics_source_ck holds. metrics_check reads the list only for a list, and
-- now runs when source changes too. The counts are still worked out in
-- lib/goals/metrics.ts, not stored.
--
-- The column's default fills the existing rows with list, so no row is
-- rewritten by a statement here.
-- ===========================================================================

alter table goals.metrics
  add column source text not null default 'list',
  add constraint metrics_source_ck check (source in ('list', 'steps', 'files')),
  alter column collection_id drop not null,
  alter column date_field drop not null,
  add constraint metrics_source_list_ck check (
    case when source = 'list'
      then collection_id is not null and date_field is not null
      else collection_id is null and date_field is null
    end
  );

-- ---------------------------------------------------------------------------
-- The goal is a goal, and for a list the field a live date field of it.
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
  -- Steps and files read no list, and a list metric missing its list or date
  -- is left for metrics_source_list_ck to refuse.
  if new.source <> 'list' or new.collection_id is null or new.date_field is null then
    return new;
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

create or replace trigger metrics_check
  before insert or update of goal_id, source, collection_id, date_field on goals.metrics
  for each row execute function goals.metrics_check();

comment on column goals.metrics.source is
  'What the metric counts: list (the records of collection_id by date_field), steps (the goal''s steps closed) or files (the files Dash wrote under the goal). Plan #2397.1.';

comment on table goals.metrics is
  'What a goal counts over time, per week or month, with an optional target per period: the records of one list by one of its date fields, the goal''s closed steps, or the files Dash wrote under it (plans #2084.1, #2397.1). The counts are worked out in lib/goals/metrics.ts, not stored.';

notify pgrst, 'reload schema';
