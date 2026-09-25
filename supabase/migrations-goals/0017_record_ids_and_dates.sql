-- ===========================================================================
-- Matching records by an ID field, and dating them by the document they were
-- read from (plan #985).
--
-- Reading a newer statement into a list should update the loans already
-- there rather than add a second copy of each, and a balance chart should
-- date each point by the statement rather than by the day it was uploaded.
-- Two additions make that possible:
--
--   fields[].id      one field of a collection may carry "id": true. Its
--                    value names the record, so a read row whose ID matches a
--                    live record updates that record. Text and number fields
--                    only, and at most one field that is not removed.
--   records.as_of    the date the values were current, as the document gives
--                    it: a statement date or the date an export was
--                    requested. Null for values typed in, which are current
--                    on the day they are saved.
--
-- The readings a tracked field writes (0009) take read_on from as_of when it
-- is set, and today otherwise. A reading is still never overwritten, so a
-- second read of the same statement writes nothing new for a value that has
-- not changed.
--
-- The match itself happens in the app (lib/goals/extract.ts, matchRows),
-- before anything is written; the database only holds the definition to at
-- most one ID field.
-- ===========================================================================

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
      'yes_no', 'choice', 'link'
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
-- records.as_of
-- ---------------------------------------------------------------------------
alter table goals.records
  add column as_of date,
  add constraint records_as_of_ck check (as_of is null or as_of >= date '1900-01-01');

-- ---------------------------------------------------------------------------
-- Readings from tracked fields, dated by as_of when the record has one.
-- ---------------------------------------------------------------------------
create or replace function goals.records_track()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  field jsonb;
  field_key text;
  val jsonb;
begin
  for field in
    select f.value
      from goals.collections c, jsonb_array_elements(c.fields) f
     where c.id = new.collection_id
       and coalesce((f.value ->> 'tracked')::boolean, false)
       and not coalesce((f.value ->> 'removed')::boolean, false)
  loop
    field_key := field ->> 'key';
    val := new.data -> field_key;
    if val is null or jsonb_typeof(val) <> 'number' then
      continue;
    end if;
    if tg_op = 'UPDATE' and (old.data -> field_key) is not distinct from val then
      continue;
    end if;
    insert into goals.readings (user_id, record_id, field, value, read_on)
    values (new.user_id, new.id, field_key, (val #>> '{}')::numeric, coalesce(new.as_of, current_date));
  end loop;
  return new;
end;
$$;

revoke all on function goals.records_track() from public, anon, authenticated;

notify pgrst, 'reload schema';
