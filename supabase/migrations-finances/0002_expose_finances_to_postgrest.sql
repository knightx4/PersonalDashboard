-- Expose `finances` to PostgREST, as migrations-news/0002 did for news: read
-- the list configured now, add `finances` if it is missing, leave the rest.
-- Running it twice changes nothing.
do $$
declare
  current_schemas text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    -- The local test database has no PostgREST in front of it.
    raise notice 'no authenticator role; skipping PostgREST schema exposure';
    return;
  end if;

  select split_part(config, '=', 2)
    into current_schemas
    from pg_db_role_setting,
         lateral unnest(setconfig) as config
   where setrole = 'authenticator'::regrole
     and setdatabase = 0
     and config like 'pgrst.db_schemas=%';

  if current_schemas is null then
    current_schemas := 'public, graphql_public, core, job_search, obsidian, todo, learn, news, goals, you';
  end if;

  if exists (
    select 1
      from unnest(string_to_array(current_schemas, ',')) as s
     where btrim(s) = 'finances'
  ) then
    raise notice 'finances is already exposed (%)', current_schemas;
    return;
  end if;

  execute format('alter role authenticator set pgrst.db_schemas = %L', current_schemas || ', finances');
end
$$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
