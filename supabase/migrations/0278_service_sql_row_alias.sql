-- Name service_sql's row so a column cannot take its place (0242).
--
-- 0242 wraps a read as `select jsonb_agg(to_jsonb(q)) from (<query>) q`. When
-- the query has a column named q, `to_jsonb(q)` reads that column rather than
-- the row, so scripts/sql.ts printed the column's text spread into one key per
-- character and dropped every other column. A Dash quality session hit it on
-- 21 October 2026 with `select r->>'question' q, ...`. The row is now named
-- service_sql_row, which no query here names a column.

create or replace function public.service_sql(p_query text, p_returns boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_row record;
  v_rows jsonb[] := '{}';
  v_out jsonb;
begin
  if not p_returns then
    execute p_query;
    return '[]'::jsonb;
  end if;
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(service_sql_row)), ''[]''::jsonb) from (%s) service_sql_row', p_query)
      into v_out;
    return v_out;
  exception
    when syntax_error then
      null;
  end;
  for v_row in execute p_query loop
    v_rows := array_append(v_rows, to_jsonb(v_row));
  end loop;
  return coalesce(to_jsonb(v_rows), '[]'::jsonb);
end;
$$;

revoke all on function public.service_sql(text, boolean) from public, anon, authenticated;
grant execute on function public.service_sql(text, boolean) to service_role;
