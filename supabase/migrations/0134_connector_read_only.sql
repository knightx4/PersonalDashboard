-- A connected Claude app's token can read, and cannot change anything
-- (plan #1257).
--
-- Feature #1244 lets Claude call Ask Dash's lookups with a token from
-- Supabase's OAuth server. That token is an ordinary user JWT (role
-- authenticated) plus a client_id claim, and the database API's key is
-- public, so anyone holding it could insert, update or delete the person's
-- rows straight through the REST API, outside the app. This takes that power
-- away in the database, where it holds wherever the token is used.
--
-- How:
--
--   1. public.connector_read_only() runs before every database API request, as
--      PostgREST's pre-request function. When the request's claims carry a
--      client_id it makes the request's transaction read-only. Every write in
--      that transaction then fails with "cannot execute ... in a read-only
--      transaction": inserts, updates and deletes on any table in any exposed
--      schema, and any function called over /rpc that would write, whatever
--      its security. Postgres refuses switching a transaction back to
--      read-write once it has run a query, so nothing called later in the
--      request can undo it. Tables added later are covered without anything
--      being done for them.
--
--      A request without client_id -- an ordinary sign-in session, the anon
--      key, the service role -- returns from the function untouched, so what
--      those can do does not change.
--
--   2. Storage does not go through PostgREST, so storage.objects gets
--      restrictive policies refusing insert, update and delete to a token
--      carrying client_id. Restrictive policies only ever narrow what the
--      permissive ones allow, so sign-in sessions keep exactly what they had.
--
-- The pre-request function is set on the authenticator role, where the
-- project's other PostgREST settings (pgrst.db_schemas) already live, and
-- PostgREST is told to reload. The local test database has neither
-- authenticator nor a storage schema, so both steps are skipped there; the
-- function itself is created everywhere, so tests can call it.
--
-- Not covered here, because it is not the database: Supabase Auth's own
-- endpoints (for example updating the user at /auth/v1/user).

set search_path = public, extensions;

create or replace function public.connector_read_only()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- request.jwt.claims is set by PostgREST (and by Storage) for every
  -- request: {"role":"anon"} without a token, the token's claims with one.
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '') <> '' then
    perform pg_catalog.set_config('transaction_read_only', 'on', true);
  end if;
end;
$$;

comment on function public.connector_read_only() is
  'PostgREST pre-request (plan #1257): makes the transaction read-only for a token carrying a client_id claim, so a connected app''s OAuth token cannot write.';

-- PostgREST calls it as whichever role the request switched to, anon
-- included, and a role that could not call it would have every request
-- refused. That is why it lives in public, which every API role can use,
-- rather than in core, which anon cannot; and why execute stays granted to
-- public as well. Calling it over /rpc does nothing but make that one
-- request read-only.
grant execute on function public.connector_read_only() to anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    raise notice 'no authenticator role; skipping the PostgREST pre-request setting. Expected on the local test database.';
    return;
  end if;
  alter role authenticator set pgrst.db_pre_request = 'public.connector_read_only';
  notify pgrst, 'reload config';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the storage policies. Expected on the local test database.';
    return;
  end if;

  execute $p$
    create policy connector_no_insert on storage.objects
      as restrictive for insert to authenticated
      with check (coalesce((select auth.jwt()) ->> 'client_id', '') = '')
  $p$;

  execute $p$
    create policy connector_no_update on storage.objects
      as restrictive for update to authenticated
      using (coalesce((select auth.jwt()) ->> 'client_id', '') = '')
      with check (coalesce((select auth.jwt()) ->> 'client_id', '') = '')
  $p$;

  execute $p$
    create policy connector_no_delete on storage.objects
      as restrictive for delete to authenticated
      using (coalesce((select auth.jwt()) ->> 'client_id', '') = '')
  $p$;
end;
$$;
