-- Local-only bootstrap. NEVER applied to Supabase.
--
-- Supabase provides the auth schema, the anon/authenticated/service_role roles
-- and auth.uid(). A plain Postgres instance does not, so this recreates just
-- enough of that surface for `npm run db:reset` and the RLS isolation test to
-- run against a local database. It is a faithful copy of the pieces the
-- migrations actually depend on, not a full reimplementation of GoTrue.

create schema if not exists extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- matches Supabase: bypasses RLS entirely, which is why every background
    -- job must filter by user_id explicitly
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant anon, authenticated, service_role to postgres;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Identical semantics to Supabase's auth.uid(): reads the sub claim that
-- PostgREST sets per request. Tests set it with
--   set local request.jwt.claims = '{"sub":"<uuid>"}'
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )::text;
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Supabase Vault, stood up locally so its schema name is taken here too.
--
-- Every Supabase project ships Supabase Vault -- an encrypted secrets store --
-- in a schema called `vault`, and `vault.secrets` deliberately carries no RLS
-- because nothing is supposed to reach it through PostgREST. A plain Postgres
-- has none of that, so the name looks free locally and is not free in
-- production.
--
-- That gap nearly shipped: the notes workspace was written against a schema
-- called `vault`, whose grants say "all tables in schema", which would have
-- granted every authenticated user select on vault.secrets and then exposed
-- the schema to PostgREST. It passed every local test, because locally there
-- was nothing to collide with.
--
-- So the collision exists here now. tests/coexistence.test.ts asserts that no
-- application table has been created in it.
-- ---------------------------------------------------------------------------
create schema if not exists vault;

create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text,
  secret text not null,
  created_at timestamptz not null default now()
);
