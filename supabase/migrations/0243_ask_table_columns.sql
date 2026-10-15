-- The columns of the tables Dash can read, and the keys between them (plan #2109.3).
--
-- Dash's table_info lookup (lib/ask/table-info.ts) tells it what it may read
-- so it stops guessing column names. The sources catalogue names only a few
-- columns of each table, so the full list comes from the database.
--
-- p_tables holds "schema.table" names, which the app takes from the catalogue.
-- The function is security invoker and keeps only tables the caller holds
-- select on, so a name outside what the person's session may read returns
-- nothing. It returns one object: "columns" (table, column, type, nullable,
-- in table order) and "links" (a foreign key from one listed table to another,
-- with the column on each side).

create or replace function public.ask_table_columns(p_tables text[])
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  with listed as (
    select c.oid, n.nspname || '.' || c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname || '.' || c.relname = any (p_tables)
      and c.relkind in ('r', 'p')
      and has_table_privilege(c.oid, 'select')
  ),
  cols as (
    select l.name as "table", a.attname::text as "column",
           format_type(a.atttypid, a.atttypmod) as type,
           not a.attnotnull as nullable
    from listed l
    join pg_attribute a on a.attrelid = l.oid and a.attnum > 0 and not a.attisdropped
    order by l.name, a.attnum
  ),
  links as (
    select l.name as "table", a.attname::text as "column",
           r.name as ref_table, ra.attname::text as ref_column
    from pg_constraint k
    join listed l on l.oid = k.conrelid
    join listed r on r.oid = k.confrelid
    cross join lateral unnest(k.conkey, k.confkey) as u(attnum, refnum)
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum
    join pg_attribute ra on ra.attrelid = k.confrelid and ra.attnum = u.refnum
    where k.contype = 'f'
    order by l.name, a.attname
  )
  select jsonb_build_object(
    'columns', coalesce((select jsonb_agg(to_jsonb(cols)) from cols), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(to_jsonb(links)) from links), '[]'::jsonb)
  );
$$;

revoke all on function public.ask_table_columns(text[]) from public, anon;
grant execute on function public.ask_table_columns(text[]) to authenticated, service_role;

comment on function public.ask_table_columns(text[]) is
  'Columns and foreign keys between the listed tables the caller may select from, for Dash''s table_info lookup.';
