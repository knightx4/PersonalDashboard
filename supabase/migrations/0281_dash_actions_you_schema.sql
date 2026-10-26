-- Let core.record_dash_action and core.dash_before name rows in the you schema
-- (plan #2540.2).
--
-- 0163 listed the schemas a ref may name and left out you, which the app's own
-- undo already accepts (lib/core/dash-actions.ts, SCHEMAS). The insights and
-- board skills record their writes to you.* tables, and the call raised
-- "Dash does not record changes in the you schema" and rolled the write back.
-- Only the list changes; the rest of the function is 0163's.

set search_path = core, public, extensions;

create or replace function core.dash_subject_row(p_subject_ref text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  parts text[];
  target regclass;
  id_type text;
  found jsonb;
begin
  parts := regexp_match(p_subject_ref, '^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*):(\S+)$');
  if parts is null then
    raise exception 'not a ref: % (write schema.table:id)', p_subject_ref
      using errcode = 'invalid_parameter_value';
  end if;
  if parts[1] not in ('public', 'core', 'job_search', 'obsidian', 'todo', 'learn', 'news', 'goals', 'you') then
    raise exception 'Dash does not record changes in the % schema', parts[1]
      using errcode = 'invalid_parameter_value';
  end if;
  target := to_regclass(format('%I.%I', parts[1], parts[2]));
  if target is null then
    raise exception 'no table %.%', parts[1], parts[2] using errcode = 'undefined_table';
  end if;
  select format_type(a.atttypid, a.atttypmod) into id_type
  from pg_catalog.pg_attribute a
  where a.attrelid = target and a.attname = 'id' and not a.attisdropped;
  if id_type is null then
    raise exception '%.% has no id column', parts[1], parts[2] using errcode = 'undefined_column';
  end if;
  execute format('select to_jsonb(t) from %s t where t.id = $1::%s', target, id_type)
    into found using parts[3];
  return found;
end;
$$;
