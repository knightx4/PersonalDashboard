-- ===========================================================================
-- A goal's number worked out from a collection (plan #1024).
--
-- A goal such as paying off student debt already has its figures in a
-- collection: every loan with its balance. Rather than typing the total as a
-- reading, the goal can name where its number comes from:
--
--   items.number_from_collection_id   the collection
--   items.number_from_field           a field of it (a number, money or percent)
--   items.number_from_how             sum     the total of that field over
--                                             every live record
--                                     latest  the value on the record whose
--                                             figures are newest
--                                     count   how many live records there
--                                             are; with a field, how many
--                                             have a value in it
--
-- Drafts found for you and archived records are left out. The three are set
-- together or not at all, and only on a goal.
--
-- The number is kept as readings like any other (0004): whenever the records
-- of that collection change, the number is worked out again and, if it
-- differs from the goal's last reading, a new reading is written. It is dated
-- by the as-of date of the records that changed (records.as_of, 0017), or
-- today when they carry none. Setting the source writes the first reading,
-- dated today.
--
-- A statement that updates several records at once writes one reading, not
-- one per record: the triggers on records are per statement.
-- ===========================================================================

alter table goals.items
  add column number_from_collection_id uuid,
  add column number_from_field text,
  add column number_from_how text;

alter table goals.items
  add constraint items_number_from_how_ck check (
    number_from_how is null or number_from_how in ('sum', 'latest', 'count')
  ),
  add constraint items_number_from_ck check (
    (number_from_how is null) = (number_from_collection_id is null)
    and (number_from_how is not null or number_from_field is null)
    and (number_from_how is null or number_from_how = 'count' or number_from_field is not null)
    and (number_from_how is null or level = 'goal')
  ),
  add constraint items_number_from_field_ck check (
    number_from_field is null or number_from_field ~ '^[a-z][a-z0-9_]{0,39}$'
  ),
  add constraint items_number_from_fk foreign key (number_from_collection_id, user_id)
    references goals.collections (id, user_id);

create index items_number_from_idx on goals.items (number_from_collection_id)
  where number_from_collection_id is not null;

-- ---------------------------------------------------------------------------
-- The field has to be one the collection has, and a number for sum or latest.
-- ---------------------------------------------------------------------------
create or replace function goals.items_number_from_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  field jsonb;
begin
  if new.number_from_how is null or new.number_from_field is null then
    return new;
  end if;
  select f.value into field
    from goals.collections c, jsonb_array_elements(c.fields) f
   where c.id = new.number_from_collection_id
     and f.value ->> 'key' = new.number_from_field
     and not coalesce((f.value ->> 'removed')::boolean, false);
  if field is null then
    raise exception 'items: the collection has no field %', new.number_from_field
      using errcode = 'check_violation', constraint = 'items_number_from_field';
  end if;
  if new.number_from_how in ('sum', 'latest')
     and field ->> 'type' not in ('number', 'money', 'percent') then
    raise exception 'items: % is not a number, so it cannot be added up', field ->> 'label'
      using errcode = 'check_violation', constraint = 'items_number_from_field';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_number_from_check() from public, anon, authenticated;

create trigger items_number_from_check
  before insert or update of number_from_collection_id, number_from_field, number_from_how
  on goals.items
  for each row execute function goals.items_number_from_check();

-- ---------------------------------------------------------------------------
-- The number now, from the records as they stand. Null when the goal has no
-- source or nothing to work it out from.
-- ---------------------------------------------------------------------------
create or replace function goals.goal_number(goal_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case i.number_from_how
    when 'count' then (
      select count(*)::numeric
        from goals.records r
       where r.collection_id = i.number_from_collection_id
         and r.archived_at is null and not r.draft
         and (i.number_from_field is null
              or coalesce(jsonb_typeof(r.data -> i.number_from_field), 'null') <> 'null')
    )
    when 'sum' then (
      select sum((r.data ->> i.number_from_field)::numeric)
        from goals.records r
       where r.collection_id = i.number_from_collection_id
         and r.archived_at is null and not r.draft
         and jsonb_typeof(r.data -> i.number_from_field) = 'number'
    )
    when 'latest' then (
      select (r.data ->> i.number_from_field)::numeric
        from goals.records r
       where r.collection_id = i.number_from_collection_id
         and r.archived_at is null and not r.draft
         and jsonb_typeof(r.data -> i.number_from_field) = 'number'
       order by coalesce(r.as_of, r.updated_at::date) desc, r.updated_at desc
       limit 1
    )
  end
  from goals.items i
  where i.id = goal_id and i.archived_at is null;
$$;

revoke all on function goals.goal_number(uuid) from public, anon;
grant execute on function goals.goal_number(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Work the number out again and write a reading if it moved. The reading is
-- compared with the goal's last one by when it was written, so a statement
-- dated before a typed reading still counts as a change. created_at is the
-- clock rather than the transaction's start, so two readings written in one
-- transaction keep their order.
-- ---------------------------------------------------------------------------
create or replace function goals.sync_goal_number(goal_id uuid, on_day date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  goal goals.items%rowtype;
  current_value numeric;
  last_value numeric;
  source_note text;
begin
  select * into goal from goals.items i
   where i.id = goal_id and i.archived_at is null and i.number_from_how is not null;
  if not found then
    return;
  end if;
  current_value := goals.goal_number(goal_id);
  if current_value is null then
    return;
  end if;
  select r.value into last_value from goals.readings r
   where r.item_id = goal_id
   order by r.created_at desc
   limit 1;
  if last_value = current_value then
    return;
  end if;

  select 'From ' || c.name || ': ' || case goal.number_from_how
           when 'sum' then 'total ' || lower(coalesce(f.value ->> 'label', goal.number_from_field))
           when 'latest' then 'latest ' || lower(coalesce(f.value ->> 'label', goal.number_from_field))
           else 'count'
         end
    into source_note
    from goals.collections c
    left join lateral (
      select value from jsonb_array_elements(c.fields) where value ->> 'key' = goal.number_from_field
    ) f on true
   where c.id = goal.number_from_collection_id;

  insert into goals.readings (user_id, item_id, value, read_on, note, created_at)
  values (goal.user_id, goal.id, current_value, coalesce(on_day, current_date), source_note,
          clock_timestamp());
end;
$$;

revoke all on function goals.sync_goal_number(uuid, date) from public, anon;
grant execute on function goals.sync_goal_number(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Records changed: every goal counting that collection is worked out again,
-- once per statement. A record whose values or as-of date changed dates the
-- reading by its as-of date; archiving, confirming a draft or deleting one
-- is dated today.
-- ---------------------------------------------------------------------------
create or replace function goals.records_sync_goals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  g record;
begin
  if tg_op = 'INSERT' then
    for g in
      select i.id, max(coalesce(n.as_of, current_date)) as on_day
        from new_rows n
        join goals.items i on i.number_from_collection_id = n.collection_id and i.archived_at is null
       group by i.id
    loop
      perform goals.sync_goal_number(g.id, g.on_day);
    end loop;
  elsif tg_op = 'UPDATE' then
    for g in
      select i.id,
             max(case
                   when n.data is distinct from o.data or n.as_of is distinct from o.as_of
                     then coalesce(n.as_of, current_date)
                   else current_date
                 end) as on_day
        from new_rows n
        join old_rows o on o.id = n.id
        join goals.items i on i.number_from_collection_id = n.collection_id and i.archived_at is null
       group by i.id
    loop
      perform goals.sync_goal_number(g.id, g.on_day);
    end loop;
  else
    for g in
      select distinct i.id
        from old_rows o
        join goals.items i on i.number_from_collection_id = o.collection_id and i.archived_at is null
    loop
      perform goals.sync_goal_number(g.id, current_date);
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function goals.records_sync_goals() from public, anon, authenticated;

create trigger records_sync_goals_insert after insert on goals.records
  referencing new table as new_rows
  for each statement execute function goals.records_sync_goals();
create trigger records_sync_goals_update after update on goals.records
  referencing old table as old_rows new table as new_rows
  for each statement execute function goals.records_sync_goals();
create trigger records_sync_goals_delete after delete on goals.records
  referencing old table as old_rows
  for each statement execute function goals.records_sync_goals();

-- ---------------------------------------------------------------------------
-- Setting or changing where the number comes from writes the first reading.
-- ---------------------------------------------------------------------------
create or replace function goals.items_number_from_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.number_from_how is not null then
    perform goals.sync_goal_number(new.id, current_date);
  end if;
  return null;
end;
$$;

revoke all on function goals.items_number_from_sync() from public, anon, authenticated;

create trigger items_number_from_sync
  after insert or update of number_from_collection_id, number_from_field, number_from_how
  on goals.items
  for each row execute function goals.items_number_from_sync();

notify pgrst, 'reload schema';
