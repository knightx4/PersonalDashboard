-- Run one statement over HTTPS with a run's settings in place, for
-- scripts/sql.ts.
--
-- service_sql (0241) runs one statement per request, and each request is its
-- own transaction. The goals routine labels every write with
-- `set local goals.actor` and `set local goals.run_id`, which the history
-- trigger reads, so the settings have to be made in the same transaction as
-- the write. This makes them first and then runs the statement, so a routine
-- can send its writes through scripts/sql.ts instead of the Supabase
-- connector, whose confirmations never reach a cloud session.
--
-- Only custom settings, named with a dot (goals.actor), are taken: nothing
-- here can change the role, the search path or any setting Postgres itself
-- reads. Security invoker and granted to the service role alone, as 0241 is.

create or replace function public.service_sql_with(p_settings jsonb, p_query text, p_returns boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_setting record;
begin
  for v_setting in select key, value from jsonb_each_text(coalesce(p_settings, '{}'::jsonb)) loop
    if v_setting.key !~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$' then
      raise exception 'service_sql_with takes custom settings only, such as goals.actor; % is not one', v_setting.key;
    end if;
    perform set_config(v_setting.key, v_setting.value, true);
  end loop;
  return public.service_sql(p_query, p_returns);
end;
$$;

revoke all on function public.service_sql_with(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.service_sql_with(jsonb, text, boolean) to service_role;

comment on function public.service_sql_with(jsonb, text, boolean) is
  'One statement from scripts/sql.ts sent over HTTPS with custom settings made first, run with the service role''s grants.';
