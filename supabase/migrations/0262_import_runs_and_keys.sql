-- What each import of an outside export wrote, so a rerun adds nothing twice
-- and keeps what the person edited (plan #2432.2).
--
-- core.import_runs is one row per applied import (a dry run writes none):
--
--   source        where the export came from, such as 'linkedin'.
--   archive_date  the day the export was made, when it says.
--   storage_path  where the uploaded file is kept, null for a local run.
--   status        'running' while it writes, then 'applied' or 'failed'.
--   counts        per kind of record, { added, updated, unchanged, kept,
--                 skipped }: kept is a row the person changed or removed since
--                 the import wrote it, which the import left alone.
--   error         why it failed, when it did.
--
-- core.import_keys maps each record an import wrote to the row it became:
--
--   source, kind, external_key  the record, as the export names it.
--   target_table  the row's table, as schema.table.
--   row_id        the row's id.
--   values_hash   a hash of the values the import last wrote to that row, so
--                 a later run can tell whether the person has changed it.
--   run_id        the run that last wrote it.
--
-- core.import_apply(run, writes) writes a batch of rows and their keys in one
-- transaction, so a row is never left without the key that says the import
-- made it. It runs as the caller: row level security on the target tables and
-- on import_keys still applies to a signed-in caller, and every row it writes
-- or updates carries the run's own user_id.
--
-- Schema only: no rows are changed.

set search_path = core, public, extensions;

create table core.import_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  source text not null,
  archive_date date,
  storage_path text,
  status text not null default 'running',
  counts jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint import_runs_status_ck check (status in ('running', 'applied', 'failed')),
  constraint import_runs_counts_ck check (jsonb_typeof(counts) = 'object'),
  constraint import_runs_source_ck check (source ~ '^[a-z][a-z0-9_]*$')
);

create index import_runs_user_source_idx on core.import_runs (user_id, source, created_at desc);

alter table core.import_runs enable row level security;

create policy import_runs_all on core.import_runs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.import_runs from anon;
grant select, insert, update, delete on core.import_runs to authenticated, service_role;

comment on table core.import_runs is
  'One row per applied import of an outside export, with its counts per kind of record (plan #2432.2).';

create table core.import_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  source text not null,
  kind text not null,
  external_key text not null,
  target_table text not null,
  row_id uuid not null,
  values_hash text not null,
  run_id uuid references core.import_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint import_keys_record_uq unique (user_id, source, kind, external_key)
);

create index import_keys_row_idx on core.import_keys (user_id, target_table, row_id);

alter table core.import_keys enable row level security;

create policy import_keys_all on core.import_keys for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.import_keys from anon;
grant select, insert, update, delete on core.import_keys to authenticated, service_role;

comment on table core.import_keys is
  'Each record an import wrote, the row it became and a hash of the values last written there (plan #2432.2).';

-- p_writes is a jsonb array of
--   { op: 'insert' | 'update', kind, key, table, row_id, values: {...}, hash }
-- An insert makes the row with the given id; an update sets only the columns
-- in values (none, to record the key alone) on a row of the run's user. An
-- update whose row has gone writes nothing. Returns how many keys it wrote.
create function core.import_apply(p_run uuid, p_writes jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid;
  v_source text;
  w jsonb;
  v_rel regclass;
  v_values jsonb;
  v_cols text;
  v_found uuid;
  v_written integer := 0;
begin
  select r.user_id, r.source into v_user, v_source
  from core.import_runs r
  where r.id = p_run and r.status = 'running';
  if v_user is null then
    raise exception 'import run % is not running', p_run;
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'import run % belongs to another account', p_run;
  end if;
  if jsonb_typeof(p_writes) <> 'array' then
    raise exception 'writes must be an array';
  end if;

  for w in select * from jsonb_array_elements(p_writes) loop
    v_rel := to_regclass(w->>'table');
    if v_rel is null then
      raise exception 'no table %', w->>'table';
    end if;
    v_values := coalesce(w->'values', '{}'::jsonb) - 'id' - 'user_id';
    select string_agg(quote_ident(k), ', ' order by k) into v_cols
    from jsonb_object_keys(v_values) k;

    if w->>'op' = 'insert' then
      execute format(
        'insert into %s (id, user_id%s) select $1, $2%s from pg_catalog.jsonb_populate_record(null::%s, $3) returning id',
        v_rel,
        case when v_cols is null then '' else ', ' || v_cols end,
        case when v_cols is null then '' else ', ' || v_cols end,
        v_rel
      ) using (w->>'row_id')::uuid, v_user, v_values into v_found;
    elsif w->>'op' = 'update' then
      if v_cols is null then
        execute format('select id from %s where id = $1 and user_id = $2', v_rel)
          using (w->>'row_id')::uuid, v_user into v_found;
      else
        execute format(
          'update %s t set (%s) = (select %s from pg_catalog.jsonb_populate_record(null::%s, $3)) where t.id = $1 and t.user_id = $2 returning t.id',
          v_rel, v_cols, v_cols, v_rel
        ) using (w->>'row_id')::uuid, v_user, v_values into v_found;
      end if;
    else
      raise exception 'unknown op %', w->>'op';
    end if;

    continue when v_found is null;

    insert into core.import_keys
      (user_id, source, kind, external_key, target_table, row_id, values_hash, run_id)
    values
      (v_user, v_source, w->>'kind', w->>'key', w->>'table', v_found, w->>'hash', p_run)
    on conflict (user_id, source, kind, external_key) do update
      set target_table = excluded.target_table,
          row_id = excluded.row_id,
          values_hash = excluded.values_hash,
          run_id = excluded.run_id,
          updated_at = now();
    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

revoke all on function core.import_apply(uuid, jsonb) from public, anon;
grant execute on function core.import_apply(uuid, jsonb) to authenticated, service_role;

comment on function core.import_apply(uuid, jsonb) is
  'Writes a batch of an import''s rows and their import_keys in one transaction, as the caller (plan #2432.2).';
