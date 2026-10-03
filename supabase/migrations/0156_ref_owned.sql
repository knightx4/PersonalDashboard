-- A ref may only name a row of the account's own (plan #1450).
--
-- docs/CORE-AND-DASH-SPEC.md, Part 1: a ref is `schema.table:id` and carries
-- no foreign key, so nothing in the table that stores it stops one account's
-- row naming another account's row by its id. This adds the check the spec
-- asks for, the rule goals.links already enforces for its four kinds
-- (migrations-goals/0005, links_check), made generic.
--
-- core.ref_owned(ref, owner) is true when the ref is `schema.table:id`, the
-- table has an `id` and a uuid `user_id` column, and a row with that id
-- belongs to the owner. Anything else is false: a malformed ref, a table that
-- does not exist or keeps no owner, an id that is not of the column's type, a
-- row that is gone. It reads the target with the definer's rights and tests
-- user_id itself, so the answer does not depend on which role is writing.
-- Only the service role may call it directly; otherwise a signed-in person
-- could pass another account's user id and learn which rows exist.
--
-- The tables that store refs today, and so check them on write:
--
--   core.files.origin            where a file came from (0105)
--   core.observations.evidence   the rows behind an observation (0111)
--   core.week_reviews            each observation's evidence (0126)
--   core.year_reviews            each paragraph's evidence (0112)
--
-- Every value these hold on the live database already has the
-- `schema.table:id` form, keyed by the row's uuid. Other columns that name
-- rows are not refs yet and are left alone: core.conversations.subject_ref
-- holds a feed card's id or, for Ask Dash, the conversation's own id, until
-- Part 2 gives it a kind for a thread under any ref; goals.context and
-- goals.records keep a source table and a ref in separate columns, and the
-- ref there may be a note's path.
--
-- The check runs when a ref is written. On an update only the refs the row
-- did not hold before are checked, so a row whose evidence has since been
-- removed can still have its verdict or its other columns changed.

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

  -- An ordinary table with an id, and an owner to test.
  select a.atttypid::regtype into id_type
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = target_schema and c.relname = target_name
    and c.relkind in ('r', 'p') and a.attname = 'id';
  if id_type is null then
    return false;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = target_schema and c.relname = target_name
      and a.attname = 'user_id' and a.atttypid = 'uuid'::regtype
  ) then
    return false;
  end if;

  execute format(
    'select exists (select 1 from %I.%I where id = $1::%s and user_id = $2)',
    target_schema, target_name, id_type
  ) into found using row_id, owner;
  return found;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    -- The id is not of the column's type, so no row has it.
    return false;
end;
$$;

revoke all on function core.ref_owned(text, uuid) from public, anon, authenticated;
grant execute on function core.ref_owned(text, uuid) to service_role;

-- The refs held in a list of objects that each carry an `evidence` array:
-- core.week_reviews.observations and core.year_reviews.paragraphs.
create or replace function core.evidence_refs(items jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(e.value), '{}'::text[])
  from jsonb_array_elements(
         case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end
       ) as item(value)
  cross join lateral jsonb_array_elements_text(
         case when jsonb_typeof(item.value -> 'evidence') = 'array'
              then item.value -> 'evidence' else '[]'::jsonb end
       ) as e(value);
$$;

-- The trigger behind all four tables. It reads the refs of the row being
-- written, leaves out those the row already held, and refuses the write when
-- any of the rest does not name a row of the writer's own. Definer's rights,
-- so it may call core.ref_owned whoever is writing; it reads only the row in
-- hand and asks only about new.user_id, which row level security has already
-- held to the signed-in person.
create or replace function core.refs_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_refs text[];
  old_refs text[] := '{}';
  ref text;
begin
  if tg_table_name = 'files' then
    new_refs := array_remove(array[new.origin], null);
    if tg_op = 'UPDATE' then old_refs := array_remove(array[old.origin], null); end if;
  elsif tg_table_name = 'observations' then
    new_refs := coalesce(new.evidence, '{}');
    if tg_op = 'UPDATE' then old_refs := coalesce(old.evidence, '{}'); end if;
  elsif tg_table_name = 'week_reviews' then
    new_refs := core.evidence_refs(new.observations);
    if tg_op = 'UPDATE' then old_refs := core.evidence_refs(old.observations); end if;
  elsif tg_table_name = 'year_reviews' then
    new_refs := core.evidence_refs(new.paragraphs);
    if tg_op = 'UPDATE' then old_refs := core.evidence_refs(old.paragraphs); end if;
  else
    return new;
  end if;

  -- A row moved to another account keeps nothing it held before.
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    old_refs := '{}';
  end if;

  foreach ref in array new_refs loop
    continue when ref = any (old_refs);
    if not core.ref_owned(ref, new.user_id) then
      raise exception 'refs: % is not a row of yours', ref
        using errcode = 'check_violation', constraint = 'refs_owned';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function core.refs_check() from public, anon, authenticated;

create or replace trigger files_refs_check
  before insert or update of origin, user_id on core.files
  for each row execute function core.refs_check();

create or replace trigger observations_refs_check
  before insert or update of evidence, user_id on core.observations
  for each row execute function core.refs_check();

create or replace trigger week_reviews_refs_check
  before insert or update of observations, user_id on core.week_reviews
  for each row execute function core.refs_check();

create or replace trigger year_reviews_refs_check
  before insert or update of paragraphs, user_id on core.year_reviews
  for each row execute function core.refs_check();
