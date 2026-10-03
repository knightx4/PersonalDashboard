-- A ref to a row keyed by the account itself is the account's own (plan #1468).
--
-- A thread can sit under a row of any table with a page (migration 0165), and
-- whether the writer owns that row is core.ref_owned's answer (0156). That
-- answer needed a uuid user_id column, and one table with a page has none:
-- job_search.profiles, whose id is the account's id, a foreign key to
-- auth.users. So ref_owned now also accepts a row whose id is the owner's
-- when the table's id column references auth.users(id). Every other case is
-- as 0156 left it.

set search_path = core, public, extensions;

create or replace function core.ref_owned(ref text, owner uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  colon integer;
  target text;
  row_id text;
  target_schema text;
  target_name text;
  target_oid oid;
  id_attnum smallint;
  id_type regtype;
  found boolean;
begin
  if ref is null or owner is null then
    return false;
  end if;

  colon := strpos(ref, ':');
  if colon = 0 then
    return false;
  end if;
  target := left(ref, colon - 1);
  row_id := btrim(substr(ref, colon + 1));
  if target !~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$' or row_id = '' then
    return false;
  end if;
  target_schema := split_part(target, '.', 1);
  target_name := split_part(target, '.', 2);

  -- An ordinary table with an id.
  select c.oid, a.attnum, a.atttypid::regtype into target_oid, id_attnum, id_type
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = target_schema and c.relname = target_name
    and c.relkind in ('r', 'p') and a.attname = 'id';
  if id_type is null then
    return false;
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = target_oid and a.attname = 'user_id' and a.atttypid = 'uuid'::regtype
  ) then
    execute format(
      'select exists (select 1 from %I.%I where id = $1::%s and user_id = $2)',
      target_schema, target_name, id_type
    ) into found using row_id, owner;
    return found;
  end if;

  -- No owner column: the row is the account's own only when its id is the
  -- account's id, which the table declares by keying id to auth.users.
  if exists (
    select 1 from pg_catalog.pg_constraint k
    where k.conrelid = target_oid and k.contype = 'f'
      and k.conkey = array[id_attnum]
      and k.confrelid = 'auth.users'::regclass
  ) then
    execute format(
      'select exists (select 1 from %I.%I where id = $1::%s and id = $2)',
      target_schema, target_name, id_type
    ) into found using row_id, owner;
    return found;
  end if;

  return false;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    -- The id is not of the column's type, so no row has it.
    return false;
end;
$$;

revoke all on function core.ref_owned(text, uuid) from public, anon, authenticated;
grant execute on function core.ref_owned(text, uuid) to service_role;
