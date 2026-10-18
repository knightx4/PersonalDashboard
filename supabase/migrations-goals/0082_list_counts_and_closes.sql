-- ===========================================================================
-- A list counts towards its goal, and buying a product closes its step
-- (plan #2330.5, feature #2330).
--
-- Two things a goal's list can now do.
--
-- 1. The goal's number can count the rows of a list that hold one value of a
--    choice field: the events whose status is "Went", the groups whose status
--    is "Visited". 0028 counted every row, or every row with a value in a
--    field. One more column says which value:
--
--      items.number_from_value   the option of number_from_field a row must
--                                hold to be counted. Only with
--                                number_from_how = 'count' and a field, and
--                                only for a choice field that offers it.
--
--    goal_number counts those rows, and the reading's note says so ("From
--    Events: count where status is Went").
--
-- 2. A step of the person's that links a saved product (goals.links,
--    kind saved_item, 0079) closes when that product is bought: marked
--    purchased in Shopping or matched to an order line
--    (saved_items.purchased_order_item_id). The close carries what was seen,
--    as a close from evidence does (0050), with the new source 'shopping':
--    "You bought HOMCOM 72 inch pantry in Shopping." Only an open or blocked
--    step of the person's (kind mine) with nothing open beneath it closes,
--    the same steps the morning run may close from evidence. The update is
--    scoped to the product's own account.
--
-- Picking one row of a list rules out the rest in the app's own code
-- (lib/goals/lists-store.ts, pickListRow), since what "picked" and "ruled
-- out" are called is read from the list's own options there.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- items.number_from_value
-- ---------------------------------------------------------------------------
alter table goals.items add column number_from_value text;

alter table goals.items add constraint items_number_from_value_ck check (
  number_from_value is null or (
    number_from_how = 'count'
    and number_from_field is not null
    and btrim(number_from_value) <> ''
    and length(number_from_value) <= 200
  )
);

comment on column goals.items.number_from_value is
  'With number_from_how = count: the option of number_from_field a record must hold to be counted (plan #2330.5).';

-- The field has to be one the collection has, a number for sum or latest, and
-- a choice offering the value when a value is named (0028's, with the value).
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
  if new.number_from_value is not null
     and (field ->> 'type' <> 'choice'
          or not coalesce(field -> 'options', '[]'::jsonb) @> jsonb_build_array(new.number_from_value)) then
    raise exception 'items: % offers no option %', field ->> 'label', new.number_from_value
      using errcode = 'check_violation', constraint = 'items_number_from_value';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_number_from_check() from public, anon, authenticated;

create or replace trigger items_number_from_check
  before insert or update of number_from_collection_id, number_from_field, number_from_how, number_from_value
  on goals.items
  for each row execute function goals.items_number_from_check();

create or replace trigger items_number_from_sync
  after insert or update of number_from_collection_id, number_from_field, number_from_how, number_from_value
  on goals.items
  for each row execute function goals.items_number_from_sync();

-- The number now (0028's, counting only the rows holding the value when one
-- is named).
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
         and (i.number_from_value is null or r.data ->> i.number_from_field = i.number_from_value)
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

-- Work the number out again and write a reading if it moved (0028's, with
-- the value in the reading's note).
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

  select 'From ' || c.name || ': ' || case
           when goal.number_from_how = 'sum' then 'total ' || lower(coalesce(f.value ->> 'label', goal.number_from_field))
           when goal.number_from_how = 'latest' then 'latest ' || lower(coalesce(f.value ->> 'label', goal.number_from_field))
           when goal.number_from_value is not null then
             'count where ' || lower(coalesce(f.value ->> 'label', goal.number_from_field)) || ' is ' || goal.number_from_value
           else 'count'
         end
    into source_note
    from goals.collections c
    left join lateral (
      select value from jsonb_array_elements(c.fields) where value ->> 'key' = goal.number_from_field
    ) f on true
   where c.id = goal.number_from_collection_id;

  insert into goals.readings (user_id, item_id, value, read_on, note, created_at)
  values (goal.user_id, goal.id, current_value, coalesce(on_day, current_date), left(source_note, 500),
          clock_timestamp());
end;
$$;

revoke all on function goals.sync_goal_number(uuid, date) from public, anon;
grant execute on function goals.sync_goal_number(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- evidence_source takes 'shopping'
-- ---------------------------------------------------------------------------
alter table goals.items
  drop constraint items_evidence_ck,
  add constraint items_evidence_ck check (
    (evidence is null) = (evidence_source is null)
    and (evidence is null or (
      status = 'done'
      and level = 'step'
      and btrim(evidence) <> ''
      and length(evidence) <= 500
      and evidence_source in ('jobs', 'gmail', 'calendar', 'todo', 'shopping')
    ))
  );

comment on column goals.items.evidence_source is
  'Where the evidence was seen: jobs, gmail, calendar, todo or shopping (plans #1082, #2330.5). Set with evidence.';

-- ---------------------------------------------------------------------------
-- A saved product bought closes the steps that link it
-- ---------------------------------------------------------------------------
create or replace function goals.saved_item_bought_closes_steps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  said text;
begin
  if not (new.status = 'purchased' or new.purchased_order_item_id is not null)
     or (old.status = 'purchased' or old.purchased_order_item_id is not null) then
    return null;
  end if;

  said := left(btrim(regexp_replace(coalesce(new.title, ''), '\s+', ' ', 'g')), 200);
  if said = '' then
    said := 'the saved product';
  end if;

  update goals.items s
     set status = 'done',
         evidence = 'You bought ' || said || ' in Shopping.',
         evidence_source = 'shopping'
   where s.user_id = new.user_id
     and s.level = 'step'
     and s.kind = 'mine'
     and s.status in ('open', 'blocked')
     and s.archived_at is null
     and exists (
       select 1 from goals.links l
        where l.item_id = s.id
          and l.user_id = new.user_id
          and l.kind = 'saved_item'
          and l.target_id = new.id
          and l.archived_at is null
     )
     and not exists (
       select 1 from goals.items c
        where c.parent_id = s.id
          and c.user_id = new.user_id
          and c.archived_at is null
          and c.status not in ('done', 'dropped')
     );
  return null;
end;
$$;

revoke all on function goals.saved_item_bought_closes_steps() from public, anon, authenticated;

create or replace trigger saved_items_close_goal_steps
  after update of status, purchased_order_item_id on public.saved_items
  for each row execute function goals.saved_item_bought_closes_steps();

notify pgrst, 'reload schema';
