-- Expose `news` to PostgREST, in a migration rather than by hand.
--
-- 0001 created the schema and left a note saying to add `news` to Settings →
-- API → Exposed schemas in the dashboard. Nobody did, so every read from
-- /news came back `PGRST106 Invalid schema: news` and the page rendered as
-- "A server error occurred". The tables were there the whole time; PostgREST
-- simply refused to look at the schema.
--
-- PostgREST is configured from the database as well as from its own file
-- (`db-config`), and the in-database value wins. So the setting that was a
-- dashboard checkbox becomes a row in `pg_db_role_setting`, which a migration
-- can write and version control can keep.
--
-- Written as an append rather than an assignment on purpose. The list is a
-- single string, so spelling it out here would mean this file silently
-- deciding what the other five modules get -- and going stale the day a
-- seventh schema is added. Instead: read whatever is configured now, add
-- `news` if it is missing, leave everything else alone. Running it twice
-- changes nothing.
--
-- The fallback list is only reached when nothing has been set in the database
-- yet, which is the state this project was in when the migration was written;
-- it is the list PostgREST reported as exposed at that moment, plus `news`.
do $$
declare
  current_schemas text;
  wanted text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    -- A bare Postgres with no Supabase roles: the local test database. There
    -- is no PostgREST in front of it, so there is nothing to expose.
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
    current_schemas := 'public, graphql_public, core, job_search, obsidian, todo, learn';
  end if;

  -- Match on the trimmed elements, so `newsroom` or a schema ending in `news`
  -- cannot pass for `news`.
  if exists (
    select 1
      from unnest(string_to_array(current_schemas, ',')) as s
     where btrim(s) = 'news'
  ) then
    raise notice 'news is already exposed (%)' , current_schemas;
    return;
  end if;

  wanted := current_schemas || ', news';
  execute format('alter role authenticator set pgrst.db_schemas = %L', wanted);
  raise notice 'exposed schemas are now %', wanted;
end
$$;

-- Tell PostgREST to pick the change up now rather than at its next restart.
-- Both are needed: the first re-reads the setting, the second rebuilds the
-- cache of tables it will serve from the schemas the first one added.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
