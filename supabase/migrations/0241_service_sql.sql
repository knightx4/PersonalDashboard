-- Run one statement for scripts/plan.ts over HTTPS (lib/db/https-sql.ts).
--
-- A cloud session cannot open a Postgres connection: its proxy carries HTTPS
-- on port 443 and nothing else (see 0240). So scripts/plan.ts could not run
-- there, and every plan session fell back to writing plan rows by hand
-- through the Supabase connector, where a write whose wording the connector
-- holds for a confirmation sits for 60 seconds and times out. With the
-- service-role key in the environment, plan.ts now sends each statement here
-- through the REST API instead, and the CLI works the same in the cloud as
-- it does locally.
--
-- p_query is one statement with its values already written in as literals.
-- p_returns says whether it gives back rows: a select, or a write with
-- returning. The rows come back as a JSON array of objects.
--
-- Security invoker and granted to the service role alone, so a statement
-- runs with the service role's own grants. Anyone holding that key can
-- already read and write every table through the REST API; this lets them
-- send the same reads and writes as SQL, and nothing the role cannot do.

create or replace function public.service_sql(p_query text, p_returns boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_row record;
  v_rows jsonb := '[]'::jsonb;
begin
  if not p_returns then
    execute p_query;
    return v_rows;
  end if;
  for v_row in execute p_query loop
    v_rows := v_rows || jsonb_build_array(to_jsonb(v_row));
  end loop;
  return v_rows;
end;
$$;

revoke all on function public.service_sql(text, boolean) from public, anon, authenticated;
grant execute on function public.service_sql(text, boolean) to service_role;

comment on function public.service_sql(text, boolean) is
  'One statement from scripts/plan.ts sent over HTTPS, run with the service role''s grants.';
