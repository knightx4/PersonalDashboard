-- ===========================================================================
-- Collections and records: the facts a goal needs, each value checked
-- against a definition before it is kept (plan #953).
--
-- docs/GOALS-SPEC.md, "Information steps and collections". A step such as
-- "List your loan balances, rates and minimum payments" needs somewhere to
-- put them. A collection is the definition (loans: name, servicer, balance,
-- rate, minimum, due day), and a record is one filled-in set of values. Every
-- collection's records live in the one records table as JSON, so Claude can
-- define a new collection without a migration.
--
--   collections       name, fields, one record or a list, version
--   collection_goals  the goals a collection serves; one can serve several
--   records           the values, where they came from, archived not deleted
--
-- -- Fields --
--
-- collections.fields is a JSON array, one object per field:
--
--   {"key": "balance", "label": "Balance", "type": "money", "tracked": true}
--
-- key is the name the value is stored under in records.data and never
-- changes. type is one of the ten the app can draw and check: text,
-- long_text, number, money, percent, date, day_of_month, yes_no, choice, link.
-- A choice field carries "options", a list of strings. tracked is allowed on
-- number, money and percent.
--
-- A field is never taken out of the array. Removing one sets "removed": true,
-- which hides it and keeps its values in every record that has them. A field
-- keeps its type for good, so a value that was valid when written stays
-- valid; a field that needs another type is a new field. Any change to the
-- fields raises version by one, and the database sets version, not the
-- writer.
--
-- -- Values --
--
-- records.data is an object keyed by field key. Each value is stored in one
-- form, which lib/goals/collections.ts produces from what a person types and
-- the trigger below checks:
--
--   text          a string of one line, up to 500 characters
--   long_text     a string up to 20000 characters
--   number        a JSON number
--   money         a JSON number with at most two decimal places
--   percent       a JSON number, 6.8 for 6.8%, between -1000 and 1000
--   date          "YYYY-MM-DD"
--   day_of_month  a whole number from 1 to 31
--   yes_no        true or false
--   choice        one of the field's options, exactly
--   link          an http or https address, up to 2000 characters
--
-- null, or a missing key, is an empty value, allowed for every field. Only
-- the values a write changes are checked, so a record written before an
-- option was taken off a choice field keeps its old answer. A value for a
-- key the definition does not have, or for a removed field, is refused
-- unless it is the value the record already held.
--
-- A value that breaks its definition is refused with errcode check_violation,
-- constraint records_values, the field's label in the message and its key in
-- the detail, so the form can put the error next to the field.
--
-- -- Tracked fields --
--
-- When a tracked field gets a value it did not have, a row goes into
-- goals.readings with the record, the field key and the value. readings
-- therefore now holds two kinds of series: a goal's own number (item_id, as
-- in 0004), and a record's tracked field (record_id and field). Exactly one of
-- the two is set.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The definition check, shared by the collections trigger. Returns what is
-- wrong with a fields array, or null when nothing is.
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

-- This and goals.record_value_error are pure functions called from triggers
-- that run as the signed-in person, who therefore needs to execute them.
revoke all on function goals.collection_fields_error(jsonb) from public, anon;
grant execute on function goals.collection_fields_error(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- collections
-- ---------------------------------------------------------------------------
create table goals.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  shape text not null default 'list',
  fields jsonb not null default '[]'::jsonb,
  version integer not null default 1,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint collections_id_user_key unique (id, user_id),
  constraint collections_name_ck check (btrim(name) <> '' and length(name) <= 200),
  constraint collections_shape_ck check (shape in ('one', 'list')),
  constraint collections_version_ck check (version >= 1)
);

-- One live collection of a name per account, so "loans" means one thing.
create unique index collections_user_name_key on goals.collections (user_id, lower(btrim(name)))
  where archived_at is null;

create or replace function goals.collections_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  problem text;
  old_field jsonb;
  new_field jsonb;
begin
  problem := goals.collection_fields_error(new.fields);
  if problem is not null then
    raise exception 'collections: %', problem
      using errcode = 'check_violation', constraint = 'collections_fields';
  end if;

  if tg_op = 'INSERT' then
    new.version := 1;
    return new;
  end if;

  -- Every field the definition had is still there, with the same type.
  for old_field in select value from jsonb_array_elements(old.fields) loop
    select f.value into new_field
      from jsonb_array_elements(new.fields) f
     where f.value ->> 'key' = old_field ->> 'key';
    if new_field is null then
      raise exception 'collections: field % cannot be taken out; mark it removed', old_field ->> 'key'
        using errcode = 'check_violation', constraint = 'collections_fields_kept';
    end if;
    if new_field ->> 'type' <> old_field ->> 'type' then
      raise exception 'collections: field % stays a %; add a new field for another type',
        old_field ->> 'key', old_field ->> 'type'
        using errcode = 'check_violation', constraint = 'collections_fields_kept';
    end if;
  end loop;

  if new.shape = 'one' and old.shape = 'list' and (
    select count(*) from goals.records r
     where r.collection_id = new.id and r.archived_at is null
  ) > 1 then
    raise exception 'collections: % holds more than one record, so it stays a list', new.name
      using errcode = 'check_violation', constraint = 'collections_shape_one';
  end if;

  if new.fields is distinct from old.fields then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

revoke all on function goals.collections_check() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- collection_goals -- the goals a collection serves. A budget can be read by
-- the debt goal and a savings goal. Archived rather than deleted, like
-- item_goals.
-- ---------------------------------------------------------------------------
create table goals.collection_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  collection_id uuid not null,
  goal_id uuid not null,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint collection_goals_id_user_key unique (id, user_id),
  constraint collection_goals_pair_key unique (collection_id, goal_id),
  constraint collection_goals_collection_fk foreign key (collection_id, user_id)
    references goals.collections (id, user_id),
  constraint collection_goals_goal_fk foreign key (goal_id, user_id)
    references goals.items (id, user_id)
);

create index collection_goals_goal_idx on goals.collection_goals (goal_id) where archived_at is null;

create or replace function goals.collection_goals_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from goals.items i where i.id = new.goal_id and i.level = 'goal') then
    raise exception 'collection_goals: % is not a goal', new.goal_id
      using errcode = 'check_violation', constraint = 'collection_goals_goal_is_goal';
  end if;
  return new;
end;
$$;

revoke all on function goals.collection_goals_check() from public, anon, authenticated;

create trigger collection_goals_check before insert or update of goal_id on goals.collection_goals
  for each row execute function goals.collection_goals_check();

-- ---------------------------------------------------------------------------
-- records
--
-- source says how the values arrived; source_ref points at where: an email's
-- id for gmail, a storage path for document, a comment or capture id. version
-- is the collection's version the values were last written against, set by
-- the trigger.
-- ---------------------------------------------------------------------------
create table goals.records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  collection_id uuid not null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  position integer not null default 0,

  source text not null default 'typed',
  source_ref text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint records_id_user_key unique (id, user_id),
  -- No action: a collection with records cannot be hard-deleted by mistake.
  constraint records_collection_fk foreign key (collection_id, user_id)
    references goals.collections (id, user_id),
  constraint records_data_object_ck check (jsonb_typeof(data) = 'object'),
  constraint records_data_size_ck check (pg_column_size(data) <= 200000),
  constraint records_source_ck check (
    source in ('typed', 'pasted', 'document', 'gmail', 'comment', 'capture')
  ),
  constraint records_source_ref_ck check (
    source_ref is null or (btrim(source_ref) <> '' and length(source_ref) <= 2000)
  )
);

create index records_collection_idx on goals.records (collection_id, position)
  where archived_at is null;

-- What is wrong with one value for one field, or null when it is fine.
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
    when 'link' then
      s := val #>> '{}';
      if kind <> 'string' or s !~ '^https?://\S+$' or length(s) > 2000 then
        return format('%s must be a web address starting http:// or https://', label);
      end if;
    else
      return format('%s has a type the app does not know', label);
  end case;

  return null;
end;
$$;

revoke all on function goals.record_value_error(jsonb, jsonb) from public, anon;
grant execute on function goals.record_value_error(jsonb, jsonb) to authenticated, service_role;

create or replace function goals.records_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  coll goals.collections%rowtype;
  field_key text;
  val jsonb;
  field jsonb;
  problem text;
begin
  if tg_op = 'UPDATE' and new.collection_id <> old.collection_id then
    raise exception 'records: a record stays in its collection'
      using errcode = 'check_violation', constraint = 'records_collection_kept';
  end if;

  select * into coll from goals.collections c where c.id = new.collection_id;
  if not found then
    -- The foreign key reports this one.
    return new;
  end if;

  if new.archived_at is null and coll.archived_at is not null
     and (tg_op = 'INSERT' or new.data is distinct from old.data or old.archived_at is not null) then
    raise exception 'records: % is archived', coll.name
      using errcode = 'check_violation', constraint = 'records_collection_live';
  end if;

  if jsonb_typeof(new.data) <> 'object' then
    -- The check constraint reports this one.
    return new;
  end if;

  for field_key, val in select key, value from jsonb_each(new.data) loop
    if tg_op = 'UPDATE' and (old.data -> field_key) is not distinct from val then
      continue;
    end if;

    select f.value into field
      from jsonb_array_elements(coll.fields) f
     where f.value ->> 'key' = field_key;

    if field is null or coalesce((field ->> 'removed')::boolean, false) then
      if jsonb_typeof(val) = 'null' then
        continue;
      end if;
      raise exception 'records: % has no field %', coll.name, field_key
        using errcode = 'check_violation', constraint = 'records_values', detail = field_key;
    end if;

    problem := goals.record_value_error(field, val);
    if problem is not null then
      raise exception 'records: %', problem
        using errcode = 'check_violation', constraint = 'records_values', detail = field_key;
    end if;
  end loop;

  if coll.shape = 'one' and new.archived_at is null
     and (tg_op = 'INSERT' or old.archived_at is not null)
     and exists (
       select 1 from goals.records r
        where r.collection_id = new.collection_id and r.archived_at is null and r.id <> new.id
     ) then
    raise exception 'records: % holds one record, and it already has it', coll.name
      using errcode = 'check_violation', constraint = 'records_shape_one';
  end if;

  if tg_op = 'INSERT' or new.data is distinct from old.data then
    new.version := coll.version;
  else
    new.version := old.version;
  end if;

  return new;
end;
$$;

revoke all on function goals.records_check() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- readings from tracked fields
-- ---------------------------------------------------------------------------
alter table goals.readings
  alter column item_id drop not null,
  add column record_id uuid,
  add column field text,
  add constraint readings_record_fk foreign key (record_id, user_id)
    references goals.records (id, user_id) on delete cascade,
  add constraint readings_series_ck check (
    (item_id is null) <> (record_id is null)
    and (record_id is null) = (field is null)
  ),
  add constraint readings_field_ck check (field is null or field ~ '^[a-z][a-z0-9_]{0,39}$');

create index readings_record_field_idx on goals.readings (record_id, field, read_on desc)
  where record_id is not null;

-- A reading keeps the series it belongs to, as it keeps its value and date.
create or replace function goals.readings_keep_value()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.value is distinct from old.value
     or new.read_on is distinct from old.read_on
     or new.item_id is distinct from old.item_id
     or new.record_id is distinct from old.record_id
     or new.field is distinct from old.field then
    raise exception 'readings: a reading is never overwritten; add a new one'
      using errcode = 'check_violation', constraint = 'readings_keep_value';
  end if;
  return new;
end;
$$;

-- Runs as the caller: the reading is the record owner's, written under the
-- same row level security as the record itself.
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
    insert into goals.readings (user_id, record_id, field, value)
    values (new.user_id, new.id, field_key, (val #>> '{}')::numeric);
  end loop;
  return new;
end;
$$;

revoke all on function goals.records_track() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers, history, row level security
-- ---------------------------------------------------------------------------
create trigger collections_check before insert or update on goals.collections
  for each row execute function goals.collections_check();
create trigger records_check before insert or update on goals.records
  for each row execute function goals.records_check();
create trigger records_track after insert or update of data on goals.records
  for each row execute function goals.records_track();

create trigger collections_touch_updated_at before update on goals.collections
  for each row execute function goals.touch_updated_at();
create trigger collection_goals_touch_updated_at before update on goals.collection_goals
  for each row execute function goals.touch_updated_at();
create trigger records_touch_updated_at before update on goals.records
  for each row execute function goals.touch_updated_at();

alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions', 'collections', 'collection_goals', 'records'
  )
);

create trigger collections_history after insert or update or delete on goals.collections
  for each row execute function goals.record_history();
create trigger collection_goals_history after insert or update or delete on goals.collection_goals
  for each row execute function goals.record_history();
create trigger records_history after insert or update or delete on goals.records
  for each row execute function goals.record_history();

alter table goals.collections enable row level security;
alter table goals.collection_goals enable row level security;
alter table goals.records enable row level security;

create policy collections_all on goals.collections for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy collection_goals_all on goals.collection_goals for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy records_all on goals.records for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.collections, goals.collection_goals, goals.records from anon, public;
grant select, insert, update, delete
  on goals.collections, goals.collection_goals, goals.records
  to authenticated, service_role;

notify pgrst, 'reload schema';
