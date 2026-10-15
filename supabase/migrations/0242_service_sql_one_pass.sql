-- Build service_sql's answer in one pass (migration 0241).
--
-- 0241 appended each row to a jsonb array, which copies the array every
-- time. Loading the plan reads all 2,068 plan_items rows, about 2.8 MB, so
-- every plan.ts command ran past the 8-second statement timeout the REST API
-- sets. Tested from a cloud session on 15 October 2026.
--
-- A read now goes through jsonb_agg in one statement. A write with returning
-- cannot sit inside a subquery, which Postgres refuses as a syntax error, so
-- that case collects its rows into an array as it goes and turns them into
-- JSON once at the end.

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
    execute format('select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (%s) q', p_query)
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
