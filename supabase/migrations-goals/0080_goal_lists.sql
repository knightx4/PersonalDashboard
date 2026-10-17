-- ===========================================================================
-- A goal's own lists, and three more field types: image, place and ref
-- (plan #2330.2).
--
-- A goal can keep a list of things that live nowhere else in the app, such
-- as pantries to compare or volunteer groups to try. Such a list is a
-- collection (0009) that belongs to the goal rather than to an information
-- step:
--
--   collections.goal_id   the goal the list belongs to. Null for every
--                         collection an information step fills.
--   collections.position  the order of a goal's lists, from 0.
--
-- A list also serves its goal, so a goal's number (0028) and its metrics
-- (0078) can be worked out from it as from any other collection: the trigger
-- below writes the collection_goals row whenever goal_id is set.
--
-- Until 0081 lands, a list's name is unique across the account, as every
-- collection's is (0009). 0081 makes it unique among its goal's live lists
-- instead, and is applied by the workflow on main, since the connector holds
-- the statement it needs for a confirmation that never comes.
--
-- -- Field types --
--
-- Three types join the ten of 0009. Each is stored in one form, which
-- lib/goals/collections.ts produces and record_value_error below checks:
--
--   image  an http or https address of a picture, up to 2000 characters
--   place  {"address": "...", "lat": 51.5, "lng": -0.12}: one line of up to
--          500 characters, with both coordinates or neither, and no other keys
--   ref    a row elsewhere in the app as schema.table:id, the form
--          lib/core/refs.ts reads. Only the form is checked here; the row can
--          go, and the page says so, as every ref does.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- collections.goal_id and position
-- ---------------------------------------------------------------------------
alter table goals.collections
  add column goal_id uuid,
  add column position integer not null default 0,
  add constraint collections_goal_fk foreign key (goal_id, user_id)
    references goals.items (id, user_id),
  add constraint collections_position_ck check (position >= 0);

create index collections_goal_idx on goals.collections (goal_id, position)
  where goal_id is not null and archived_at is null;

comment on column goals.collections.goal_id is
  'The goal this collection is a list of (plan #2330.2). Null for a collection an information step fills.';
comment on column goals.collections.position is
  'The order of a goal''s lists, from 0 (plan #2330.2).';

-- The list belongs to a goal, not to a step or an area.
create or replace function goals.collections_goal_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.goal_id is not null
     and not exists (select 1 from goals.items i where i.id = new.goal_id and i.level = 'goal') then
    raise exception 'collections: a list belongs to a goal, and % is not one', new.goal_id
      using errcode = 'check_violation', constraint = 'collections_goal_is_goal';
  end if;
  return new;
end;
$$;

revoke all on function goals.collections_goal_check() from public, anon, authenticated;

create trigger collections_goal_check before insert or update of goal_id on goals.collections
  for each row execute function goals.collections_goal_check();

-- A goal's list serves that goal. Runs as the caller, under the same row
-- level security as the collection.
create or replace function goals.collections_serve_goal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.goal_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.goal_id is not distinct from old.goal_id then
    return new;
  end if;
  insert into goals.collection_goals (user_id, collection_id, goal_id)
  values (new.user_id, new.id, new.goal_id)
  on conflict (collection_id, goal_id) do update set archived_at = null
    where goals.collection_goals.archived_at is not null;
  return new;
end;
$$;

revoke all on function goals.collections_serve_goal() from public, anon, authenticated;

create trigger collections_serve_goal after insert or update of goal_id on goals.collections
  for each row execute function goals.collections_serve_goal();

-- ---------------------------------------------------------------------------
-- The definition check, with the three new types (0017's, with image, place
-- and ref added to the list).
-- ---------------------------------------------------------------------------
create or replace function goals.collection_fields_error(fields jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  field jsonb;
  field_key text;
  field_type text;
  keys text[] := '{}';
  opt jsonb;
  id_fields integer := 0;
begin
  if jsonb_typeof(fields) is distinct from 'array' then
    return 'fields must be a list';
  end if;
  if jsonb_array_length(fields) > 60 then
    return 'a collection holds at most 60 fields';
  end if;

  for field in select value from jsonb_array_elements(fields) loop
    if jsonb_typeof(field) <> 'object' then
      return 'each field must be an object';
    end if;

    field_key := field ->> 'key';
    if field_key is null or field_key !~ '^[a-z][a-z0-9_]{0,39}$' then
      return format('field key %s must be lower case letters, digits and _', coalesce(field_key, '(missing)'));
    end if;
    if field_key = any (keys) then
      return format('field key %s is used twice', field_key);
    end if;
    keys := keys || field_key;

    if jsonb_typeof(field -> 'label') is distinct from 'string'
       or btrim(field ->> 'label') = '' or length(field ->> 'label') > 200 then
      return format('field %s needs a label of up to 200 characters', field_key);
    end if;

    field_type := field ->> 'type';
    if field_type is null or field_type not in (
      'text', 'long_text', 'number', 'money', 'percent', 'date', 'day_of_month',
      'yes_no', 'choice', 'link', 'image', 'place', 'ref'
    ) then
      return format('field %s has no type the app knows: %s', field_key, coalesce(field_type, '(missing)'));
    end if;

    if field ? 'tracked' and jsonb_typeof(field -> 'tracked') <> 'boolean' then
      return format('field %s: tracked must be true or false', field_key);
    end if;
    if coalesce((field ->> 'tracked')::boolean, false)
       and field_type not in ('number', 'money', 'percent') then
      return format('field %s: only a number, money or percent can be tracked', field_key);
    end if;

    if field ? 'removed' and jsonb_typeof(field -> 'removed') <> 'boolean' then
      return format('field %s: removed must be true or false', field_key);
    end if;

    if field ? 'id' and jsonb_typeof(field -> 'id') <> 'boolean' then
      return format('field %s: id must be true or false', field_key);
    end if;
    if coalesce((field ->> 'id')::boolean, false) then
      if field_type not in ('text', 'number') then
        return format('field %s: only a text or number field can be the ID', field_key);
      end if;
      if not coalesce((field ->> 'removed')::boolean, false) then
        id_fields := id_fields + 1;
        if id_fields > 1 then
          return 'a collection has at most one ID field';
        end if;
      end if;
    end if;

    if field_type = 'choice' then
      if jsonb_typeof(field -> 'options') is distinct from 'array'
         or jsonb_array_length(field -> 'options') = 0
         or jsonb_array_length(field -> 'options') > 100 then
        return format('choice field %s needs a list of 1 to 100 options', field_key);
      end if;
      for opt in select value from jsonb_array_elements(field -> 'options') loop
        if jsonb_typeof(opt) <> 'string' or btrim(opt #>> '{}') = '' or length(opt #>> '{}') > 200 then
          return format('choice field %s: each option must be text of up to 200 characters', field_key);
        end if;
      end loop;
      if (select count(distinct value) from jsonb_array_elements(field -> 'options'))
         <> jsonb_array_length(field -> 'options') then
        return format('choice field %s lists an option twice', field_key);
      end if;
    elsif field ? 'options' then
      return format('field %s: only a choice field has options', field_key);
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function goals.collection_fields_error(jsonb) from public, anon;
grant execute on function goals.collection_fields_error(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One value for one field (0009's, with image, place and ref added).
-- ---------------------------------------------------------------------------
create or replace function goals.record_value_error(field jsonb, val jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  kind text := jsonb_typeof(val);
  label text := field ->> 'label';
  n numeric;
  s text;
begin
  if kind = 'null' then
    return null;
  end if;

  case field ->> 'type'
    when 'text' then
      s := val #>> '{}';
      if kind <> 'string' or s ~ '[\r\n]' or length(s) > 500 then
        return format('%s must be one line of text, up to 500 characters', label);
      end if;
    when 'long_text' then
      if kind <> 'string' or length(val #>> '{}') > 20000 then
        return format('%s must be text of up to 20000 characters', label);
      end if;
    when 'number' then
      if kind <> 'number' or abs((val #>> '{}')::numeric) >= 1e12 then
        return format('%s must be a number', label);
      end if;
    when 'money' then
      if kind <> 'number' then
        return format('%s must be an amount of money', label);
      end if;
      n := (val #>> '{}')::numeric;
      if abs(n) >= 1e12 or n * 100 <> trunc(n * 100) then
        return format('%s must be an amount of money, to the cent', label);
      end if;
    when 'percent' then
      if kind <> 'number' or abs((val #>> '{}')::numeric) > 1000 then
        return format('%s must be a percentage', label);
      end if;
    when 'date' then
      s := val #>> '{}';
      if kind <> 'string' or s !~ '^\d{4}-\d{2}-\d{2}$' then
        return format('%s must be a date', label);
      end if;
      begin
        if to_char(s::date, 'YYYY-MM-DD') <> s then
          return format('%s must be a date', label);
        end if;
      exception when others then
        return format('%s must be a date', label);
      end;
    when 'day_of_month' then
      if kind <> 'number' then
        return format('%s must be a day of the month, 1 to 31', label);
      end if;
      n := (val #>> '{}')::numeric;
      if n <> trunc(n) or n < 1 or n > 31 then
        return format('%s must be a day of the month, 1 to 31', label);
      end if;
    when 'yes_no' then
      if kind <> 'boolean' then
        return format('%s must be yes or no', label);
      end if;
    when 'choice' then
      if kind <> 'string' or not (field -> 'options') @> jsonb_build_array(val) then
        return format('%s must be one of its options', label);
      end if;
    when 'link', 'image' then
      s := val #>> '{}';
      if kind <> 'string' or s !~ '^https?://\S+$' or length(s) > 2000 then
        return format('%s must be a web address starting http:// or https://', label);
      end if;
    when 'place' then
      if kind <> 'object'
         or jsonb_typeof(val -> 'address') is distinct from 'string'
         or btrim(val ->> 'address') = '' or (val ->> 'address') ~ '[\r\n]'
         or length(val ->> 'address') > 500
         or exists (select 1 from jsonb_object_keys(val) k where k not in ('address', 'lat', 'lng')) then
        return format('%s must be an address of one line, up to 500 characters', label);
      end if;
      if coalesce(jsonb_typeof(val -> 'lat'), 'null') = 'null'
         and coalesce(jsonb_typeof(val -> 'lng'), 'null') = 'null' then
        return null;
      end if;
      if jsonb_typeof(val -> 'lat') is distinct from 'number'
         or jsonb_typeof(val -> 'lng') is distinct from 'number'
         or abs((val ->> 'lat')::numeric) > 90
         or abs((val ->> 'lng')::numeric) > 180 then
        return format('%s needs both coordinates, a latitude from -90 to 90 and a longitude from -180 to 180', label);
      end if;
    when 'ref' then
      s := val #>> '{}';
      if kind <> 'string' or s !~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*:[A-Za-z0-9_-]{1,100}$' then
        return format('%s must point at a row in the app, as schema.table:id', label);
      end if;
    else
      return format('%s has a type the app does not know', label);
  end case;

  return null;
end;
$$;

revoke all on function goals.record_value_error(jsonb, jsonb) from public, anon;
grant execute on function goals.record_value_error(jsonb, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
